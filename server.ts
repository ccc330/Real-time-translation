import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import type { Session } from './src/server/types';
import { isTranslationProvider, type TranslationProvider } from './src/types';
import { startMockInterval } from './src/server/mock';
import { startSonioxSession } from './src/server/sonioxSession';
import { createTranslator, Translator } from './src/server/translator';

// Load environment variables
dotenv.config();

// Keep the process alive through failures inside per-connection sessions. The
// upstream STT/MT sockets can surface an 'error' with no listener (or an
// unhandled rejection), which would otherwise take down the whole HTTP + WS
// server. We log and carry on; the affected client gets an `error` frame.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] kept server alive:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] kept server alive:', reason);
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT) || 3000;
const IDLE_PENDING_TRANSLATION_MS = Number(process.env.IDLE_PENDING_TRANSLATION_MS) || 2000;
const SONIOX_MAX_ENDPOINT_DELAY_MS = Number(process.env.SONIOX_MAX_ENDPOINT_DELAY_MS) || 1500;
const SEGMENT_MAX_CHARS = Number(process.env.SEGMENT_MAX_CHARS) || 120;
const TRANSLATE_FIRST_TOKEN_MS = Number(process.env.TRANSLATE_FIRST_TOKEN_MS) || 1200;
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS) || 2500;
const SONIOX_MAX_RECONNECT = Number(process.env.SONIOX_MAX_RECONNECT) || 3;
const MAX_SESSION_AUDIO_SEC = process.env.MAX_SESSION_AUDIO_SEC
  ? Number(process.env.MAX_SESSION_AUDIO_SEC)
  : undefined;

const sonioxKey = () => (process.env.SONIOX_API_KEY || '').trim();

// Translation provider — OpenAI-compatible. Can be selected per WebSocket session.
type ProviderName = TranslationProvider;
type ProviderConfig = {
  label: string;
  baseUrl: string;
  model: string;
  key: () => string;
  extraBody?: Record<string, unknown>;
};

function normalizeProvider(value: unknown, fallback: ProviderName = 'mimo'): ProviderName {
  const providerName = String(value || '').toLowerCase();
  return isTranslationProvider(providerName) ? providerName : fallback;
}

const DEFAULT_TRANSLATE_PROVIDER = normalizeProvider(process.env.TRANSLATE_PROVIDER);
const PROVIDERS: Record<
  ProviderName,
  ProviderConfig
> = {
  deepseek: {
    label: 'DeepSeek V4 Flash',
    baseUrl: 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    key: () => (process.env.DEEPSEEK_API_KEY || '').trim(),
  },
  mimo: {
    label: '小米 MiMo UltraSpeed',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: process.env.MIMO_MODEL || 'mimo-v2.5-pro-ultraspeed',
    key: () => (process.env.MIMO_API_KEY || '').trim(),
    // MiMo is a reasoning model (thinking on by default → slow first token + wasted
    // tokens). Disable it for low-latency direct translation.
    extraBody: { thinking: { type: 'disabled' } },
  },
};

const provider = (name: ProviderName = DEFAULT_TRANSLATE_PROVIDER) => PROVIDERS[name];
const providerOptions = () =>
  (Object.entries(PROVIDERS) as [ProviderName, ProviderConfig][]).map(([id, p]) => ({
    id,
    label: p.label,
    model: p.model,
    configured: !!p.key(),
  }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Reports engine status so the client can show a "demo mode" badge. Keys live
// only on the server now; there is no per-user key entry.
app.get('/api/config', (req, res) => {
  const p = provider();
  res.json({
    mock: !sonioxKey(),
    sttModel: sonioxKey() ? 'stt-rt-v5' : null,
    translateProvider: DEFAULT_TRANSLATE_PROVIDER,
    translateProviders: providerOptions(),
    translateModel: p.key() ? p.model : (sonioxKey() ? 'soniox-builtin' : null),
  });
});

// Upgrade HTTP connection to a WebSocket under /live
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('Client WebSocket connected.');
  let session: Session | null = null;
  let started = false;

  ws.on('message', (raw, isBinary) => {
    // Binary frames are raw PCM16 audio; text frames are JSON control messages.
    if (isBinary) {
      if (session) session.onAudio(raw as Buffer);
      return;
    }

    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'init') {
      if (started) return;
      started = true;

      const sKey = sonioxKey();
      if (!sKey) {
        console.log('No SONIOX_API_KEY. Starting MOCK engine.');
        ws.send(JSON.stringify({ type: 'mockInfo', message: '未配置语音识别 Key，正在使用演示翻译引擎。' }));
        session = startMockInterval(ws);
        return;
      }

      const requestedProvider = normalizeProvider(msg.translateProvider, DEFAULT_TRANSLATE_PROVIDER);
      const p = provider(requestedProvider);
      const tKey = p.key();
      const translator: Translator | null = tKey
        ? createTranslator({
            apiKey: tKey,
            model: p.model,
            baseUrl: p.baseUrl,
            firstTokenMs: TRANSLATE_FIRST_TOKEN_MS,
            timeoutMs: TRANSLATE_TIMEOUT_MS,
            extraBody: p.extraBody,
          })
        : null;
      console.log(tKey
        ? `Translation provider: ${requestedProvider} (${p.model})`
        : `No key for provider "${requestedProvider}". Using Soniox built-in translation only.`);

      session = startSonioxSession(ws, {
        sonioxKey: sKey,
        translator,
        idlePendingMs: IDLE_PENDING_TRANSLATION_MS,
        maxEndpointDelayMs: SONIOX_MAX_ENDPOINT_DELAY_MS,
        maxTurnChars: SEGMENT_MAX_CHARS,
        maxReconnect: SONIOX_MAX_RECONNECT,
        maxSessionAudioSec: MAX_SESSION_AUDIO_SEC,
      });
      return;
    }

    if (msg.type === 'audio_end' && session?.onAudioEnd) {
      session.onAudioEnd();
    }

    if (msg.type === 'config' && session?.configure) {
      session.configure({ maxTurnChars: msg.maxTurnChars, idlePendingMs: msg.idlePendingMs });
    }
  });

  ws.on('close', () => { session?.cleanup(); console.log('Client disconnected.'); });
  ws.on('error', () => { session?.cleanup(); });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n[fatal] Port ${PORT} is already in use — likely a previous instance that did not exit cleanly.\n` +
        `        Free it with:  lsof -ti :${PORT} | xargs kill -9\n` +
        `        or start on another port:  PORT=3001 npm run dev\n`
      );
    } else {
      console.error('[fatal] HTTP server error:', err);
    }
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Live translator service available on http://0.0.0.0:${PORT}`);
  });
}

startServer();
