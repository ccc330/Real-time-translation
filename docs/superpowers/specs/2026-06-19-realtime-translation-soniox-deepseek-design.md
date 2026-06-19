# 实时中英翻译字幕 · 翻译后端重做设计（Soniox + DeepSeek V4 Flash）

- 日期：2026-06-19
- 状态：待评审 → 待用户确认
- 适用项目：`chinese-english-live-translator`

## 1. 背景与动机

当前应用是浏览器端的中英↔实时字幕翻译器：两人面对面说话，上面板显示英文、下面板显示中文，均为实时字幕。前端（React 19 + Vite + Tailwind v4 + shadcn/ui）与后端（Express + `ws` + Gemini Live）跑在**单一 Node 进程**中。

现有翻译引擎 `startLiveSession` 为每个连接开**两个** Gemini Live Translate 会话（目标分别为 `en` 和 `zh-CN`），同一路音频喂入，谁吐出译文谁即为当前方向。

### 核心问题

1. **模型类别用错**：`gemini-3.5-live-translate-preview` 是"语音→语音翻译"模型，译文以**音频**返回，`outputTranscription`（译文文本）几乎恒为空。而本应用是**纯字幕**应用，最需要的恰是译文文本。这是架构性缺陷，非可调 bug。
2. **方向判定脆弱**：靠 `detectLang()` 的 CJK/Latin 字符统计猜测语言方向，不稳。
3. **进程韧性不足**（已先行修复）：依赖出错曾导致整进程崩溃；已加 `uncaughtException` / `unhandledRejection` 守卫与 `server.listen` 的 `EADDRINUSE` 友好处理。

### 目标与约束（已与用户确认）

| 约束 | 决定 |
|---|---|
| 部署形态 | 云 API |
| 成本 | ≤ **$0.10 / 小时**，在此预算内追求最高翻译质量 |
| 语言 | zh ↔ en 双向，需支持中英混说自动识别 |
| 优先级 | 翻译质量精准 + 速度迅速并重 |
| Key 管理 | 两个 key 均放服务端 `.env`，移除 KeyDialog |

### 选型结论（基于 2026-06 调研）

- **STT：Soniox 实时多语种**。原生中英混说自动识别（无需手动选语言、token 自带语言标签），实测 WER 1.25%（业界最低），价格约 $0.10–0.12/小时且套餐"全功能含翻译"。英语为中心的 Deepgram/AssemblyAI 实时中文支持弱，出局。
- **翻译：DeepSeek V4 Flash**（`deepseek-v4-flash`）。DeepSeek 系在 zh↔en 为实测最高质量档；Flash 变体更新、更快、更省，适配实时低延迟。对话量级下成本近乎免费（约 $0.01/小时）。
- **成本洞察**：成本瓶颈在 STT（按音频时长计费），翻译环近乎免费。卡进 $0.10/小时的关键杠杆是**客户端 VAD**（静音不发包，省 30–50% 计费时长，同时避免静音/噪声幻觉）。

> 来源：Soniox 定价与中文能力、各 STT 实时多语种覆盖、LLM zh↔en 翻译质量对比（DeepSeek V4 COMET 0.901）均见 2026-06 网络调研，记录于设计讨论。

## 2. 设计原则

- **原文优先、译文尽力、进程不死、预算可控。**
- 面向浏览器的 WS 协议**保持不变**，前端改动最小。
- 唯一接缝 `Session` 接口不变，mock/live 引擎可互换。
- 按职责拆分服务端模块，单元边界清晰、可独立理解与测试。

## 3. 总体架构与数据流

保留"单进程 Express + ws + Vite"骨架。仅将翻译引擎从 Gemini 双会话替换为 **Soniox 单会话 STT + DeepSeek 翻译层**的级联。

```
麦克风
  │  客户端 VAD：仅在检测到说话时发音频（省 STT 计费时长）
  ▼
浏览器 ──ws audio(PCM16 16k)──▶ 服务器 /live
                                   │
                                   ▼
                          Soniox 实时 WS（单会话，自动中英混说识别）
                                   │  原文 token（带语言标签）partial/final
                                   │  +（兜底用）Soniox 内置译文
                                   ▼
                      ┌──── 组装 utterance（原文即时出字幕）
                      │            │ 子句边界 final
                      │            ▼
                      │     DeepSeek V4 Flash 翻译（带滚动上下文，流式，短超时）
                      │            │ 译文 token 流式增长
                      ▼            ▼
              transcription 帧（原文+译文，按 id upsert）──ws──▶ 浏览器双面板
                      │
                  endpoint / audio_end → complete 帧
```

### 数据流要点

1. **原文即时、译文防抖**：Soniox partial 一来即推原文字幕（亚秒级体感快）；译文在子句 final 时才调 DeepSeek，流式回填。
2. **方向判定来自 Soniox**：`originalLang` 取自 token 语言标签，`targetLang = other(originalLang)`；标签缺失时回退 `detectLang()`。
3. **客户端 VAD**：在 `recorder.ts` 的 PCM 链路上加能量门控 + hangover 拖尾，静音不发包。
4. **Mock 模式保留**：无 key 时自动启用，零成本调试全链路。

## 4. 端点判定（思考停顿处理）—— 核心机制

不依赖单一静音计时。分三层信号、三种动作，且**"触发翻译"与"判定说完"用不同阈值**。

### ① Token 定稿（Soniox `final` 标记）— 决定"哪些字可翻译"
- `non-final`（临时假设，可能改写）→ 仅更新原文字幕显示，不翻译。
- `final`（已提交，不再变）→ 进入可翻译缓冲区。

### ② 子句边界 — 决定"翻一版临时译文"
满足任一即触发一次翻译（**不**代表说完）：
- 已提交文本出现句末/子句标点（Soniox 输出标点：。！？，. ! ? ,），或
- 已提交 token 后出现**短停顿**（`IDLE_COMPLETE_MS`，默认 ~700ms）。

**翻译是临时且可重算的**：若停顿后继续说，将同一句**扩展后重新翻译**（上下文更全、质量更高），用同一 `id` upsert 覆盖。思考停顿因此不会被误判为结束，猜错代价仅为一次廉价重译。

### ③ 真正 endpoint — 决定"定稿 + complete"
满足任一即发 `complete` 帧、开新 `id`：
- **Soniox 内置 endpoint / turn 检测**（ML 判断说话轮结束，主判据）；
- 或**长停顿兜底**（`IDLE_PENDING_TRANSLATION_MS`，默认 ~1.5–2s）；
- 或客户端 `audio_end`（用户松开麦克风）。

| 场景 | 行为 |
|---|---|
| 说半句停下想 | 短停顿触发临时译文，不 complete，缓冲区保留 |
| 想完接着说 | 新 token 进缓冲，整句重译覆盖，仍同一条字幕 |
| 真说完了 | Soniox endpoint 或长停顿 → 定稿 + complete，换新句 |

## 5. 组件拆分与接口

### 5.1 模块地图

| 文件 | 职责 | 依赖 |
|---|---|---|
| `server.ts`（瘦身） | HTTP/WS 接线、引擎选择、全局异常兜底（已加）、`server.listen` 错误处理（已加） | 下列模块 |
| `src/server/types.ts` | 共享类型：`Session` `Lang` `LiveTurn`、客户端帧定义 | — |
| `src/server/sonioxSession.ts` | 核心：开 Soniox WS、喂音频、解析 token、跑 turn 状态机（§4）、调翻译、推帧、重连 | translator, types |
| `src/server/translator.ts` | DeepSeek V4 Flash 流式翻译封装：prompt、上下文窗口、超时、取消、Soniox 兜底协同 | types |
| `src/server/mock.ts` | 迁移现有 `startMockInterval` | types |
| `src/utils/vad.ts`（客户端） | 能量门控 + hangover 拖尾，静音不发包 | — |

> 服务端模块用**相对 import**（不走 `@/*` 别名），避免 esbuild/tsx 别名解析问题；`@/*` 仍只用于客户端。

### 5.2 接口契约

**① `Session`（不变的接缝）**
```ts
type Session = {
  onAudio: (base64Pcm: string) => void;
  onAudioEnd?: () => void;
  cleanup: () => void;
};
```

**② `Translator`（DeepSeek 翻译层）**
```ts
interface Translator {
  // 流式回填译文；每次新翻译 abort 上一次，防止重译时旧结果乱序覆盖
  translate(
    input: { text: string; originalLang: Lang; context: string[]; signal: AbortSignal },
    onDelta: (fullTranslatedText: string) => void
  ): Promise<void>;
}
```
- `AbortSignal`：句子被扩展时取消上一版翻译。
- `context`：最近若干条已定稿原文/译文，提升连贯性。
- 实现：`createDeepSeekTranslator({ apiKey, model, timeoutMs, firstTokenMs })`，模型默认 `deepseek-v4-flash`。

**③ `startSonioxSession`（组装一切，返回 `Session`）**
```ts
function startSonioxSession(ws, opts: {
  sonioxKey: string;
  translator: Translator;
  sonioxModel: string;
  idleCompleteMs: number;
  idlePendingMs: number;
  maxSessionAudioSec?: number;
}): Session
```
内部每个 turn 维护：`committedOriginal`（final token 拼接）、`pendingOriginal`（partial，仅显示）、`originalLang`、`translatedText`、`sonioxTranslation`（兜底用）、翻译序号 `translationSeq`。状态机驱动推 `transcription` / `complete` 帧。

### 5.3 WS 协议（保持不变）

- client → server：`init {}`（仅作开始信号，不再带 apiKey）、`audio {data}`、`audio_end`。
- server → client：`ready {model}`、`mockInfo {message}`、`error {message}`、`transcription {id, originalLang, targetLang, originalText, translatedText}`、`complete {id}`。`transcription` 按 `id` upsert。

## 6. 错误处理与韧性

### 6.1 进程级（已就位）
`uncaughtException` / `unhandledRejection` 守卫 + `EADDRINUSE` 友好提示，任何依赖出错不杀进程。

### 6.2 Soniox 连接韧性
- 连接失败 → 推 `error` 帧，服务存活。
- 中途断开 → **指数退避自动重连**（上限 `SONIOX_MAX_RECONNECT`，默认 3），重连期间音频短暂缓冲，成功无缝续，彻底失败才提示用户。
- `audio_end` → 通知 Soniox 结束、强制 endpoint、定稿当前 turn。

### 6.3 翻译容错（DeepSeek 为主，Soniox 兜底）
- 流式翻译，关注**首 token 时延**：软阈值 `TRANSLATE_FIRST_TOKEN_MS`（默认 ~1.2s）、硬放弃 `TRANSLATE_TIMEOUT_MS`（默认 ~2.5s）。
- **失败/超时兜底链**：
  ```
  主：DeepSeek V4 Flash（流式，质量最高）
     │ 超时/报错
     ▼
  兜底：Soniox 内置译文（已在流中，瞬时、套餐内零增量成本）→ 显示
     │（可选）后台重试 DeepSeek，成功则 upsert 升级
     ▼
  极端：两者皆失败 → 保留原文 + 轻量"翻译重试中"占位，不阻塞 complete
  ```
- **策略（已确认）**：**DeepSeek 为主、Soniox 仅兜底**——正常只显示 DeepSeek 译文，字幕不抖动；仅 DeepSeek 失败时才回退 Soniox 译文。
- **乱序防护**：`AbortSignal` + 每 turn 的 `translationSeq`，仅最新序号结果可写入。

### 6.4 预算护栏
- 客户端 VAD 为第一道（静音不发包）。
- 可选硬上限 `MAX_SESSION_AUDIO_SEC`（默认宽松或关闭）：单连接累计发送 Soniox 的音频秒数超限即停推 + 提示。
- 日志记录每连接累计音频秒数，便于核对是否卡在 $0.10/小时内。

### 6.5 语言标签兜底
`originalLang` 优先取 Soniox token 语言标签；缺失/模糊时回退 `detectLang()` 对已提交原文做字符统计。

## 7. 配置（`.env`，经 `dotenv.config()`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `SONIOX_API_KEY` | — | Soniox 服务端 key；缺失则 MOCK |
| `DEEPSEEK_API_KEY` | — | DeepSeek 服务端 key；缺失则译文走 Soniox 兜底 |
| `SONIOX_MODEL` | （Soniox 实时多语种模型名） | STT 模型 |
| `TRANSLATE_MODEL` | `deepseek-v4-flash` | 翻译模型 |
| `TRANSLATE_FIRST_TOKEN_MS` | 1200 | 首 token 软阈值，超则触发兜底 |
| `TRANSLATE_TIMEOUT_MS` | 2500 | 翻译硬放弃上限 |
| `IDLE_COMPLETE_MS` | 750 | 子句边界短停顿阈值 |
| `IDLE_PENDING_TRANSLATION_MS` | 2000 | endpoint 长停顿兜底阈值 |
| `SONIOX_MAX_RECONNECT` | 3 | Soniox 重连上限 |
| `MAX_SESSION_AUDIO_SEC` | （宽松/关闭） | 单连接音频时长硬上限 |
| `PORT` | 3000 | 服务端口 |

> 移除原 `GEMINI_API_KEY` / `GEMINI_LIVE_MODEL`（不再使用 Gemini）。

## 8. 客户端改动（最小化）

- **移除 KeyDialog**：key 全在服务端；`init` 不再带 key。无 key 时服务端进 MOCK，前端显示一个轻量"演示模式"提示（复用现有 `mockInfo` 通道）。
- **新增 VAD**：`src/utils/vad.ts` 能量门控 + hangover，接入 `recorder.ts` 的 PCM 输出，仅说话时发包；停说时（拖尾后）触发 `audio_end`。
- `App.tsx` / `TranslationPanel`：因 WS 协议不变，渲染逻辑基本不动；仅移除 KeyDialog 相关状态与入口。

## 9. 测试与验证

仓库无测试框架，`npm run lint`（`tsc --noEmit`）为硬门禁。

1. **类型检查**：每次改后 `npm run lint`。
2. **Mock 模式**：无 key 自动启用，零成本跑通"客户端→WS→字幕"全链路。
3. **纯函数隔离验证**：`scripts/check-logic.ts`（`tsx` 跑的轻量 assert，不引框架）覆盖 `mergeTranscript`、子句边界判定、turn 状态机转移、语言标签兜底。
4. **离线回放 harness**：`scripts/replay.ts` 读 wav/PCM 文件切块喂 `startSonioxSession`（假 `ws` 收帧），翻译层可注入 stub，验证 token 解析 + 状态机 + 翻译。
5. **浏览器实测**：`npm run dev`，中英混说若干句，观察：原文即时、译文按句回填、思考停顿不断句、DeepSeek 失败时 Soniox 兜底。preview 工具截图留证。
6. **预算核对**：日志对比开/关 VAD 的累计音频秒数，验证 ≤ $0.10/小时。

## 10. 范围与非目标（YAGNI）

- **范围内**：替换翻译后端为 Soniox + DeepSeek 级联、客户端 VAD、双阈值端点判定、错误韧性与预算护栏、移除 KeyDialog、保留 Mock。
- **非目标**：多语种扩展（>zh/en）、TTS/语音输出、说话人分离 UI、历史记录持久化、用户账号/多租户计费、"快然后好"译文升级（已选 DeepSeek 为主、不做可见重写）。

## 11. 待落地的开放项（实现阶段确认，非阻塞）

- Soniox 实时多语种**模型名**与 WS 消息 schema 字段（`is_final`、语言标签、endpoint 标记、内置译文字段）以官方文档为准。
- DeepSeek `deepseek-v4-flash` 的确切 API 端点与模型 id 以官方文档为准。
- VAD 能量阈值与 hangover 时长的初值需实测微调。

> 以上为实现期需对照官方文档**确认的事实**，不影响架构与接口设计。
