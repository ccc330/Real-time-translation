# 字幕延迟优化计划

- 日期：2026-06-19
- 目标：把字幕出现延迟压到"感知上接近即时"
- 配套：[设计](./2026-06-19-realtime-translation-soniox-deepseek-design.md) · [实现计划](./2026-06-19-realtime-translation-soniox-deepseek-plan.md)

## 现实目标（重要）

真正的"亚毫秒"在物理上不可达——到云端 STT/MT 的网络往返就有几十~几百 ms，音频成帧也有十几 ms。
本计划的可达成目标：

| | 当前 | 优化后 |
|---|---|---|
| 原文字幕 | ~250–500ms | **~150–300ms** |
| 译文字幕 | ~700–1500ms | **~300–500ms（与原文几乎同步）** |

## 延迟分解（从"说出口"到"字幕显示"）

| 环节 | 当前 | 目标 | 杠杆 |
|---|---|---|---|
| 麦克风缓冲 ScriptProcessorNode 1024 | 64ms/帧 | ~16–20ms | AudioWorklet + 小缓冲 (P2) |
| base64 + JSON over WS + 服务端解码 | ~5–15ms + CPU | ~1ms | 二进制 WS 帧 (P3) |
| client→server→Soniox 网络 | ~10–50ms | 物理下限 | — |
| Soniox 出原文 partial | ~150–400ms | ~150–300ms | Soniox 低延迟配置 (P5) |
| **DeepSeek 首 token（译文在等它）** | ~400ms–1s | **绕过** | Soniox 即显 (P1) |
| server→client + React 渲染 | ~20–40ms | ~16ms | 动画微调 (P6) |

## 关键发现

Soniox 的 `two_way` 内置译文**已经在实时接收**（`pendingTranslation`/`committedTranslation`），
但目前只在 DeepSeek 失败时用作兜底。也就是说译文字幕白白在等 DeepSeek 首 token。这是最大优化空间。

## 优化阶段（按收益排序）

### P1 ★ 译文"先 Soniox 即显、DeepSeek 再精修"——已选定
**策略（已与用户确认）：快然后好。** Soniox 译文 token 一到立即显示（与原文同速），DeepSeek 高质量
译文在一拍后用同一 `id` upsert 覆盖升级。
- 改动点 `sonioxSession.ts`：
  - 每次 token 更新时，若该 turn 的 DeepSeek 译文尚未产出，则用 Soniox 译文
    (`committedTranslation + pendingTranslation`) 即时填充 `translatedText` 并 `emitTurn`。
  - drain 工作器照常运行；DeepSeek 一旦产出 token 即覆盖显示（升级）。
  - 增加一个标记区分"当前显示的是 Soniox 还是 DeepSeek 译文"，避免 DeepSeek 流式输出被 Soniox
    更新反向覆盖。
- 缓解改写突兀：仅当 DeepSeek 首 token 到达后才切换来源；切换以整段替换。
- 预期：译文字幕延迟 ~0.7–1.5s → ~0.3–0.5s（与原文几乎同步）。

### P2 AudioWorklet 替换 ScriptProcessorNode
- 新增 `public/audio-worklet.js`（或内联 worklet）：在音频线程做 PCM16 转换，128 样本量子，
  聚合到 ~20ms 批量 postMessage 回主线程发送。
- `recorder.ts` 改用 `audioWorklet.addModule` + `AudioWorkletNode`；保留 VAD 门控（在 worklet 或
  主线程，二选一，优先 worklet 内做能量门控）。
- 回退：worklet 不可用时降级到现有 ScriptProcessorNode（缓冲降到 256=16ms）。
- 预期：输入延迟 64ms→~20ms，消除主线程卡顿抖动。

### P3 二进制 WS 音频传输
- 客户端：PCM `ArrayBuffer` 直接 `ws.send(buffer)`（二进制帧），不再 base64+JSON。
- 服务端：WS `message` 区分 `isBinary`——二进制即音频转发 Soniox；字符串走 JSON 控制路径。
- `init` / `audio_end` 仍走 JSON。
- 预期：去掉每帧 base64 编码、~33% 体积、JSON 解析；降 CPU 与微延迟。

### P4 DeepSeek 首 token 提速
- 精简 system prompt；限制注入上下文（`context` 取最近 1–2 条、并截断字符数）。
- 保持 `temperature` 低；调研并启用 DeepSeek prompt caching（若可用）。
- 预期：DeepSeek 升级来得更快，配合 P1 让"改写"更不易察觉。

### P5 Soniox 低延迟配置核查
- 核查 Soniox 实时参数是否有分段/最大延迟类可调项；确保 partial token 尽早 emit。
- 预期：原文 partial 与 Soniox 译文更快（强化 P1）。

### P6 渲染微调
- `transition-all duration-300` → 只对 transform/opacity 过渡、缩短至 ~150ms；确认 React 19 批处理
  在高频更新下不掉帧。
- 预期：去掉视觉"慢半拍"。

## 顺序与依赖

P1 独立、收益最大，先做。P2/P3 客户端+服务端音频路径，可一起做。P4/P5 调参，随后。P6 收尾。
每阶段 `npm run lint` + `npx tsx scripts/check-logic.ts`；P1/P2 用 preview 实测并对比延迟。

## 验证

- 主观：说话到原文/译文出现的体感延迟。
- 客观：在 `emitTurn` 打 `performance.now()` 时间戳日志，测"首个原文帧"与"首个译文帧"相对说话起点的延迟；
  对比优化前后。preview 录屏观察。
