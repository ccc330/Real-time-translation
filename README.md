# Real-time Translation

Browser-based Chinese↔English live-caption translator. Two people speak face-to-face;
the top panel shows English, the bottom panel shows Chinese, each as live captions.

Translation pipeline: **Soniox** real-time multilingual STT (auto zh/en, code-switching)
→ **DeepSeek V4 Flash** streaming translation, with Soniox's built-in translation as an
instant fallback. Client-side VAD only streams speech, keeping STT cost low.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set your keys:
   - `SONIOX_API_KEY` — required for live mode (else the app runs a no-key demo).
   - `DEEPSEEK_API_KEY` — optional; without it, translation uses Soniox's built-in
     two-way translation instead of DeepSeek.
3. Run the app:
   `npm run dev`

The app starts a single Express/Vite + WebSocket server (`/live`) on port 3000.
Open http://localhost:3000.

> Without `SONIOX_API_KEY` the server runs MOCK mode (scripted bilingual dialogue),
> letting you exercise the full UI with no key or network.
