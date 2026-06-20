// Shared server-side types for the live-translation pipeline.
//
// Confirmed external-interface facts (2026-06, against official docs):
//   Soniox real-time STT
//     - endpoint:  wss://stt-rt.soniox.com/transcribe-websocket
//     - auth:      `api_key` field inside the first JSON config message
//     - model:     "stt-rt-v5" (real-time multilingual)
//     - audio:     audio_format "pcm_s16le", sample_rate 16000, num_channels 1
//     - flags:     enable_language_identification (token.language),
//                  enable_endpoint_detection (finalize tokens on pause)
//     - translate: { type: "two_way", language_a: "en", language_b: "zh" }
//                  -> translated tokens carry translation_status: "translation"
//     - response:  { tokens: [{ text, is_final, language, translation_status? }],
//                    finished: boolean }
//     - end audio: send the empty string "" to the socket
//   DeepSeek translation
//     - base:      https://api.deepseek.com (OpenAI-compatible /chat/completions)
//     - model:     "deepseek-v4-flash", supports stream: true

export type Lang = 'en' | 'zh';

export const other = (l: Lang): Lang => (l === 'en' ? 'zh' : 'en');

/**
 * The single seam between the WebSocket route handler and any engine
 * (mock or live). Engines are fully interchangeable behind this interface.
 */
export type SessionConfig = { maxTurnChars?: number; idlePendingMs?: number };

export type Session = {
  onAudio: (pcm: Buffer) => void; // raw PCM16 mono 16 kHz (binary WS frame)
  onAudioEnd?: () => void;
  configure?: (cfg: SessionConfig) => void; // live segmentation tuning from the client
  cleanup: () => void;
};

/** Frames the server sends to the browser. `transcription` is upserted by id. */
export type ServerFrame =
  | { type: 'ready'; model: string }
  | { type: 'mockInfo'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'transcription';
      id: string;
      originalLang: Lang;
      targetLang: Lang;
      originalText: string;
      translatedText: string;
    }
  | { type: 'complete'; id: string };
