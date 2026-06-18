# Real-time Translation

Browser-based Chinese-English live caption translator.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to your Gemini API key.
3. Run the app:
   `npm run dev`

The app starts an Express/Vite server with a WebSocket endpoint at `/live`.
