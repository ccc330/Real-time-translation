# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser-based Chinese↔English live-caption translator. Two people speak face-to-face; the
top panel shows English, the bottom panel shows Chinese, each as live captions. Frontend (React 19 +
Vite + Tailwind v4 + shadcn/ui) and backend (Express + `ws` + Soniox STT + LLM MT) run in a
**single Node process** — there is no separate client/server build or proxy.

Translation pipeline: **Soniox** real-time multilingual STT (one session, two-way zh↔en
translation enabled) produces the original captions; the text is translated by a streaming LLM
(**Xiaomi MiMo UltraSpeed** by default, ~1000 tok/s; DeepSeek selectable via `TRANSLATE_PROVIDER`),
with Soniox's built-in translation shown instantly as the first pass.

## Commands

```bash
npm install
npm run dev      # tsx server.ts — Express + WebSocket + Vite middleware, all on :3000
npm run build    # vite build (-> dist/) AND esbuild bundles server.ts -> dist/server.cjs
npm start        # NODE_ENV=production node dist/server.cjs (serves dist/ statically)
npm run lint     # tsc --noEmit  (this is the only check — there are no tests)
```

There is **no test framework**. `npm run lint` (typecheck) is the validation step; run it after edits.

shadcn/ui components: `npx shadcn@latest add <name>` — installs into `src/components/ui/` (configured
for Tailwind v4 / radix-nova / neutral in `components.json`).

### Dev-loop gotcha
`npm run dev` runs `tsx server.ts` directly (NOT `vite`), with Vite embedded in middleware mode.
Client edits under `src/` hot-reload, but **changes to `server.ts` require a manual restart** — the
server process does not watch itself.

## Environment (`.env`, loaded via `dotenv.config()`)

Keys live **only on the server** (no per-user key entry / KeyDialog). See `.env.example`.

- `SONIOX_API_KEY` — real-time STT. If empty, the server runs MOCK mode.
- `TRANSLATE_PROVIDER` — `mimo` (default) | `deepseek` (OpenAI-compatible). Selects the translation
  backend. Falls back to Soniox built-in translation if the chosen provider's key is empty.
- `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` (`deepseek-v4-flash`).
- `MIMO_API_KEY` / `MIMO_MODEL` (`mimo-v2.5-pro-ultraspeed`, `https://api.xiaomimimo.com/v1`, ~1000 tok/s).
- `TRANSLATE_FIRST_TOKEN_MS` (1200) — soft first-token deadline (→ Soniox fallback).
  `TRANSLATE_TIMEOUT_MS` (2500) — inactivity/stall deadline, reset on each streamed token.
- `IDLE_PENDING_TRANSLATION_MS` (2000) — turn-complete idle timeout. Translation runs via a
  single-flight worker (no debounce): it re-translates the full text-so-far whenever the model is
  free, so captions stay complete without re-translation thrash.
- `SONIOX_MAX_ENDPOINT_DELAY_MS` (1500) — Soniox endpoint delay; lower finalizes turns sooner.
- `SEGMENT_MAX_CHARS` (120) — force a sentence break at this length (caps caption size for fast,
  pauseless speech like news). The client "断句" slider overrides this + the idle timeout live
  (`{type:'config'}` WS message → `Session.configure`).
- `SONIOX_MAX_RECONNECT` (3) — reconnect attempts on a dropped Soniox session.
- `MAX_SESSION_AUDIO_SEC` — optional per-connection audio-seconds cap (budget guard).
- `PORT` — default `3000`.

Note: `dotenv.config()` reads **`.env`**. `.env*` is gitignored.

## Architecture

### Single-process request flow
`server.ts` creates one HTTP server hosting: Express routes (`/api/health`, `/api/config`), a
`WebSocketServer` on path `/live` (manual `upgrade` handling), and Vite (dev middleware) or static
`dist/` (prod). The browser connects to `ws(s)://<same-host>/live`, so no proxy is needed.

### Per-connection lifecycle and engine selection
A WS connection does **nothing** until the client sends `{type:'init'}` as the first message
(no key — keys are server-side). `init` picks the engine: if `SONIOX_API_KEY` is set →
`startSonioxSession` (with a DeepSeek `Translator` if `DEEPSEEK_API_KEY` is set, else Soniox-only
translation); otherwise → MOCK.

### Server module layout (`src/server/`)
- `types.ts` — `Session` (the engine seam), `Lang`, `ServerFrame`, confirmed external-API facts.
- `sonioxSession.ts` — the core: Soniox WS, token parsing, the endpoint state machine, translation
  orchestration, reconnect, budget guard.
- `translator.ts` — `createDeepSeekTranslator` (streaming, AbortSignal, first-token/hard timeouts).
- `textUtils.ts` — `detectLang`, `resolveLang`, `mergeTranscript` (pure, tested).
- `mock.ts` — `startMockInterval`.
Server modules use **relative imports** (not the `@/*` alias, which is client-only).

### WebSocket protocol
- client → server: **binary frames = raw PCM16 mono 16 kHz audio**; text JSON = `init {}`,
  `audio_end`, `config {maxTurnChars?, idlePendingMs?}` (live segmentation tuning from the slider).
- server → client: `ready {model}`, `mockInfo {message}`, `error {message}`,
  `transcription {id, originalLang, targetLang, originalText, translatedText}`, `complete {id}`.
  `transcription` frames are upserted by `id`; `originalText`/`translatedText` grow as they stream.

### Translation engine (`startSonioxSession`) — the non-obvious core
One Soniox real-time WS session per connection (`stt-rt-v5`, `translation: {type:"two_way"}` for
zh↔en). Original tokens drive captions immediately; `originalLang` comes from each token's language
tag (fallback `resolveLang`). The translator is provider-agnostic (`createTranslator`, any
OpenAI-compatible API; DeepSeek or MiMo via `TRANSLATE_PROVIDER`). It runs as a **single-flight drain
worker** (`drainTranslation` / `kickTranslation`): at most one request per turn, translating the full
original so-far, **never aborted on supersede** — when it finishes it re-checks for new text and
continues. This avoids re-translation thrash (which dropped words/segments) while staying live.
Soniox's built-in two-way translation is shown **instantly** (P1) until the model's first token takes
over (`usingDeepSeek`), and is also the fallback on model failure/stall.

Very fast pauseless speech (e.g. news) never triggers an endpoint, so `forceBreakIfTooLong` caps a
turn at `maxTurnChars`: it finalizes the committed text as its own caption and lets the non-final tail
continue in a fresh turn (Soniox resends non-final tokens, so nothing is lost or duplicated).

### Utterance completion (endpointing)
A turn finalizes on a real endpoint: a Soniox `<end>` token, `IDLE_PENDING_TRANSLATION_MS` of no
tokens, or client `audio_end`. `completeTurn` is **async**: it drains the translation worker (waiting
for the full text-so-far to be translated) *before* sending `complete {id}`, so a turn is never
finalized with a partial translation. Late tokens arriving during the drain are picked up too.

### Mock mode
`startMockInterval` streams a scripted bilingual dialogue with a typewriter effect — lets the full
client pipeline be exercised with no key/network.

### Client rendering
`App.tsx` owns the WS, recorder, and `messages` list (no key dialog). `AudioRecorder`
(`src/utils/recorder.ts`) uses a `ScriptProcessorNode` at 16 kHz to emit base64 PCM16 chunks,
gated by `SpeechGate` (`src/utils/vad.ts`) so only speech is streamed (cost control).
Both panels render from the *same* `messages` array: `TranslationPanel` picks `originalText` when
`originalLang === panelLang`, else `translatedText`. The newest message is largest and anchored toward
the centre mic divider (`anchor='bottom'` for the EN/top panel, `'top'` for the ZH/bottom panel),
older lines shrink and fade.

## Conventions

- `@/*` alias maps to `src/*` (set in both `vite.config.ts` and `tsconfig.json`).
- Tailwind v4 is CSS-first: theme tokens (oklch) live in `src/index.css`; there is no
  `tailwind.config.js`. Light mode only (no `.dark` class is applied).
- Hand-written components live in `src/components/`; generated shadcn primitives in
  `src/components/ui/` (don't hand-edit unless customizing intentionally).

## Sibling project

`../Real-time-translation` is a separate, earlier implementation of the same idea (npm-workspaces
split client/server, ports 8787/5173, dual Live sessions with `translationConfig`). It is **not** part
of this app — don't cross-wire them.
