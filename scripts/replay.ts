/**
 * Offline-ish integration harness for the Soniox + DeepSeek pipeline.
 *
 *   npx tsx scripts/replay.ts <audio.wav>
 *
 * Reads a 16 kHz mono 16-bit PCM WAV, streams it through startSonioxSession with
 * a fake client WebSocket that prints every server frame. Requires SONIOX_API_KEY
 * (real STT). DEEPSEEK_API_KEY is optional — without it, translation comes from
 * Soniox's built-in two-way translation only.
 */
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { startSonioxSession } from '../src/server/sonioxSession';
import { createTranslator } from '../src/server/translator';

dotenv.config();

const file = process.argv[2];
const sonioxKey = (process.env.SONIOX_API_KEY || '').trim();

if (!file || !sonioxKey) {
  console.log('Usage: SONIOX_API_KEY=... [DEEPSEEK_API_KEY=...] npx tsx scripts/replay.ts <audio.wav>');
  console.log('  - audio.wav must be 16 kHz, mono, 16-bit PCM.');
  console.log(sonioxKey ? '' : '  - SONIOX_API_KEY is not set; nothing to do.');
  process.exit(0);
}

// Strip a standard 44-byte WAV header to get raw PCM16.
const wav = readFileSync(file);
const pcm = wav.subarray(44);

const fakeWs: any = {
  readyState: 1, // OPEN
  send: (data: string) => {
    try {
      const frame = JSON.parse(data);
      if (frame.type === 'transcription') {
        console.log(`[${frame.originalLang}->${frame.targetLang}] ${frame.originalText}  ||  ${frame.translatedText}`);
      } else {
        console.log(`<${frame.type}>`, frame.message ?? frame.model ?? frame.id ?? '');
      }
    } catch {}
  },
};

const useMimo = (process.env.TRANSLATE_PROVIDER || 'deepseek').toLowerCase() === 'mimo';
const tKey = (useMimo ? process.env.MIMO_API_KEY : process.env.DEEPSEEK_API_KEY || '')?.trim();
const translator = tKey
  ? createTranslator({
      apiKey: tKey,
      model: useMimo
        ? (process.env.MIMO_MODEL || 'mimo-v2.5-pro-ultraspeed')
        : (process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'),
      baseUrl: useMimo ? 'https://api.xiaomimimo.com/v1' : 'https://api.deepseek.com',
      firstTokenMs: 1200,
      timeoutMs: 2500,
      extraBody: useMimo ? { thinking: { type: 'disabled' } } : undefined,
    })
  : null;

const session = startSonioxSession(fakeWs, {
  sonioxKey,
  translator,
  idlePendingMs: 2000,
  maxEndpointDelayMs: 1500,
  maxTurnChars: 120,
  maxReconnect: 3,
});

// Feed PCM in ~100ms chunks (3200 bytes) at real-time pace.
const CHUNK = 3200;
let offset = 0;
const tick = () => {
  if (offset >= pcm.length) {
    session.onAudioEnd?.();
    setTimeout(() => { session.cleanup(); process.exit(0); }, 3000);
    return;
  }
  const chunk = pcm.subarray(offset, offset + CHUNK);
  offset += CHUNK;
  session.onAudio(chunk);
  setTimeout(tick, 100);
};
setTimeout(tick, 500);
