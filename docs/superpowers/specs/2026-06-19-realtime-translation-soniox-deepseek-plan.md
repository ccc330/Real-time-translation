# 实现计划 · 翻译后端重做（Soniox + DeepSeek V4 Flash）

- 日期：2026-06-19
- 配套设计：[2026-06-19-realtime-translation-soniox-deepseek-design.md](./2026-06-19-realtime-translation-soniox-deepseek-design.md)
- 分支：`design/soniox-deepseek-translation`

> 每个阶段结束都跑 `npm run lint`（`tsc --noEmit`）。阶段按依赖排序，可独立验证后再进入下一阶段。

## 阶段 0 · 事实确认（先做，阻塞后续）

对照官方文档敲定 §11 的开放事实，写入一处常量/`.env`，避免返工：

- [ ] Soniox 实时多语种**模型名** + WebSocket 端点 URL + 鉴权方式。
- [ ] Soniox 流式消息 **schema**：token 的 `is_final` 字段、语言标签字段、endpoint/turn 结束标记、内置译文字段。
- [ ] DeepSeek `deepseek-v4-flash` 的 **API 端点 + 确切 model id**（OpenAI 兼容 chat completions 还是自有格式）。

**产出**：一份简短的"接口事实"记录（可直接写进 `src/server/types.ts` 注释）。
**验证**：用 `curl` 或最小脚本各打一次 Soniox / DeepSeek，确认能连通、返回结构与记录一致。

## 阶段 1 · 类型与纯函数地基

- [ ] 新建 `src/server/types.ts`：`Session`、`Lang`、`LiveTurn`、客户端帧类型（`transcription` / `complete` / `ready` / `error` / `mockInfo`）。
- [ ] 新建 `src/server/textUtils.ts`：从 `server.ts` 迁出 `detectLang`、`mergeTranscript`（保持行为不变）。
- [ ] 新建 `src/server/mock.ts`：迁入现有 `startMockInterval`，改为 import `types`。
- [ ] 新建 `scripts/check-logic.ts`：用 `tsx` 跑的 assert 脚本，覆盖 `mergeTranscript`、`detectLang` 的既有行为。

**验证**：`npm run lint` 通过；`npx tsx scripts/check-logic.ts` 全绿。此阶段**不改运行时行为**（server.ts 仍引用迁出的函数）。

## 阶段 2 · DeepSeek 翻译层

- [ ] 新建 `src/server/translator.ts`：`createDeepSeekTranslator({ apiKey, model, firstTokenMs, timeoutMs }): Translator`。
  - 实现 `translate(input, onDelta)`：流式请求，逐 token 调 `onDelta(累计译文)`。
  - 接入 `AbortSignal`：被取消则立即停止并 resolve。
  - 首 token 软阈值 / 硬超时：超时即 reject（由调用方走兜底）。
  - prompt：依据 `originalLang` 指明翻译方向，注入 `context` 提升连贯性。
- [ ] 扩展 `scripts/check-logic.ts` 或新增小脚本：用 stub/真 key 验证流式回调、取消、超时三条路径。

**验证**：`npm run lint`；翻译脚本对一段中文/英文各跑一次，确认流式增长 + 取消 + 超时表现符合预期。

## 阶段 3 · Soniox 会话与状态机（核心）

- [ ] 新建 `src/server/sonioxSession.ts`：`startSonioxSession(ws, opts): Session`。
  - 开 Soniox WS，`onAudio` 转发 PCM，`onAudioEnd` 通知结束 + 强制 endpoint。
  - 解析 token：维护 `committedOriginal` / `pendingOriginal` / `originalLang`（标签优先，回退 `detectLang`）/ `translatedText` / `sonioxTranslation` / `translationSeq`。
  - 状态机（设计 §4）：token 更新→推原文；子句边界（标点或 `IDLE_COMPLETE_MS`）→调 translator（先 abort 上一版，`translationSeq` 防乱序）；endpoint/长停顿（`IDLE_PENDING_TRANSLATION_MS`）/`audio_end`→`completeTurn`。
  - 翻译兜底链（设计 §6.3）：DeepSeek 失败/超时→显示 Soniox 内置译文；皆失败→原文 + "翻译重试中"占位。
  - 韧性：连接失败推 `error`；中途断开指数退避重连（`SONIOX_MAX_RECONNECT`）；`MAX_SESSION_AUDIO_SEC` 护栏 + 累计音频秒数日志。
- [ ] 新建 `scripts/replay.ts`：读 wav/PCM 切块喂 `startSonioxSession`（假 `ws` 收帧、translator stub），验证 token 解析 + 状态机 + 兜底。
- [ ] `scripts/check-logic.ts` 增补状态机转移用例（思考停顿不断句、扩展重译覆盖、endpoint 定稿）。

**验证**：`npm run lint`；`replay.ts` 跑通一段中英混说样本，帧序列符合预期（原文即时、译文按句、complete 时机正确）。

## 阶段 4 · 服务端接线

- [ ] 改 `server.ts`（瘦身）：引擎选择改为——有 `SONIOX_API_KEY` 走 `startSonioxSession`（translator 由 `DEEPSEEK_API_KEY` 构造，缺失则仅 Soniox 译文），否则走 `mock`。
- [ ] `init` 消息不再读 `apiKey`（仅作开始信号）。
- [ ] `/api/config` 重构为返回 `{ mock, sttModel, translateModel }`（或删除，二选一）。
- [ ] 移除 `GEMINI_API_KEY` / `GEMINI_LIVE_MODEL` 相关代码；更新 `.env.example` 与 `CLAUDE.md` 的环境变量段。

**验证**：`npm run lint`；无 key 时 `npm run dev` 进 MOCK，浏览器字幕正常；填入真 key 后 `ready` 帧带正确模型名。

## 阶段 5 · 客户端 VAD 与去 KeyDialog

- [ ] 新建 `src/utils/vad.ts`：能量门控 + hangover 拖尾。
- [ ] 改 `src/utils/recorder.ts`：接入 vad，仅说话时发包；停说拖尾后触发 `audio_end`。
- [ ] 改 `App.tsx`：移除 KeyDialog 状态/入口；无 key 时复用 `mockInfo` 显示"演示模式"徽标。`TranslationPanel` 因协议不变基本不动。

**验证**：`npm run lint`；preview 实测——静音不发包（看日志音频秒数）、说话即出字幕。

## 阶段 6 · 端到端验证与预算核对

- [ ] preview 实测：中英混说多句，确认原文即时、译文按句回填、思考停顿不断句、DeepSeek 失败时 Soniox 兜底；截图留证。
- [ ] 预算：对比开/关 VAD 的单连接累计音频秒数，估算 $/小时，确认 ≤ $0.10。
- [ ] 文档：README 更新启动说明与所需 key。

**验证**：全链路 preview 通过 + 预算达标 + `npm run lint` 通过。

## 依赖与顺序

```
阶段0（事实）──▶ 阶段1（类型/纯函数）──▶ 阶段2（翻译层）──┐
                          │                              ├──▶ 阶段3（Soniox 状态机）──▶ 阶段4（接线）──▶ 阶段5（客户端）──▶ 阶段6（验证）
                          └──────────────────────────────┘
```

阶段 0 必须最先；阶段 3 依赖 0/1/2；阶段 4 依赖 3；阶段 5 可与 4 并行但建议其后；阶段 6 收尾。
