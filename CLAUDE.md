# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser-based Chinese↔English live-caption translator. Two people speak face-to-face; the
top panel shows English, the bottom panel shows Chinese, each as live captions. Frontend (React 19 +
Vite + Tailwind v4 + shadcn/ui) and backend (Express + `ws` + Gemini Live) run in a **single Node
process** — there is no separate client/server build or proxy.

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

- `GEMINI_API_KEY` — server-default key. If empty/`MY_GEMINI_API_KEY`, the server runs MOCK mode.
- `GEMINI_LIVE_MODEL` — default `gemini-3.5-live-translate-preview` (must be a Live API model the
  key is provisioned for; needs `bidiGenerateContent` access).
- `PORT` — default `3000`.
- `IDLE_COMPLETE_MS` (750) / `IDLE_PENDING_TRANSLATION_MS` (2200) — utterance-endpointing timers
  (see "Utterance completion" below).

Note: `dotenv.config()` reads **`.env`**, not `.env.local` (the README says `.env.local` — the code
does not). Put the key in `.env`. `.env*` is gitignored.

## Architecture

### Single-process request flow
`server.ts` creates one HTTP server hosting: Express routes (`/api/health`, `/api/config`), a
`WebSocketServer` on path `/live` (manual `upgrade` handling), and Vite (dev middleware) or static
`dist/` (prod). The browser connects to `ws(s)://<same-host>/live`, so no proxy is needed.

### Per-connection lifecycle and key handling
A WS connection does **nothing** until the client sends `{type:'init', apiKey}` as the first message.
`init` decides the engine: a non-empty client key (from the browser's localStorage) wins; otherwise
the server `.env` key; otherwise MOCK. This is how each user supplies their **own** key from the UI
(`KeyDialog`) — it is sent over the socket and used to construct that connection's `GoogleGenAI`.

### WebSocket protocol
- client → server: `init {apiKey}`, `audio {data}` (base64 PCM16 mono 16 kHz), `audio_end`.
- server → client: `ready {model}`, `mockInfo {message}`, `error {message}`,
  `transcription {id, originalLang, targetLang, originalText, translatedText}`, `complete {id}`.
  `transcription` frames are upserted by `id`; `originalText`/`translatedText` grow as they stream.

### Translation engine (`startLiveSession`) — the non-obvious core
Per connection it opens **two** Gemini Live Translate sessions, one with `targetLanguageCode: 'en'`
and one with `'zh-CN'`, both fed the *same* audio, both with `echoTargetLanguage:false`. Direction is
not assumed: the session that actually emits translated `outputTranscription` becomes the utterance's
`activeTarget`, and `detectLang()` (CJK-vs-Latin char count) classifies the original. `mergeTranscript`
stitches overlapping streaming deltas. This dual-session design exists because a single session can't
know which way to translate until the model starts producing output.

### Utterance completion
The Live Translate model does not reliably emit `turnComplete`, so a turn is finalized by **idle
timers**: `IDLE_COMPLETE_MS` once a translation already exists, the longer `IDLE_PENDING_TRANSLATION_MS`
while still waiting for one. The client also sends `audio_end` when the mic stops. On finalize the
server sends `complete {id}`.

### Mock mode
`startMockInterval` streams a scripted bilingual dialogue with a typewriter effect — lets the full
client pipeline be exercised with no key/network.

### Client rendering
`App.tsx` owns the WS, recorder, key dialog, and `messages` list. `AudioRecorder`
(`src/utils/recorder.ts`) uses a `ScriptProcessorNode` at 16 kHz to emit base64 PCM16 chunks.
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
