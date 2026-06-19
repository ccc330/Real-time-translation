import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import type { Session } from './src/server/types';
import { startMockInterval } from './src/server/mock';
import { startSonioxSession } from './src/server/sonioxSession';
import { createDeepSeekTranslator, Translator } from './src/server/translator';

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
const IDLE_COMPLETE_MS = Number(process.env.IDLE_COMPLETE_MS) || 750;
const IDLE_PENDING_TRANSLATION_MS = Number(process.env.IDLE_PENDING_TRANSLATION_MS) || 2000;
const TRANSLATE_FIRST_TOKEN_MS = Number(process.env.TRANSLATE_FIRST_TOKEN_MS) || 1200;
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS) || 2500;
const SONIOX_MAX_RECONNECT = Number(process.env.SONIOX_MAX_RECONNECT) || 3;
const MAX_SESSION_AUDIO_SEC = process.env.MAX_SESSION_AUDIO_SEC
  ? Number(process.env.MAX_SESSION_AUDIO_SEC)
  : undefined;
const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || 'deepseek-v4-flash';

const sonioxKey = () => (process.env.SONIOX_API_KEY || '').trim();
const deepseekKey = () => (process.env.DEEPSEEK_API_KEY || '').trim();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Reports engine status so the client can show a "demo mode" badge. Keys live
// only on the server now; there is no per-user key entry.
app.get('/api/config', (req, res) => {
  res.json({
    mock: !sonioxKey(),
    sttModel: sonioxKey() ? 'stt-rt-v5' : null,
    translateModel: deepseekKey() ? TRANSLATE_MODEL : (sonioxKey() ? 'soniox-builtin' : null),
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

  ws.on('message', (raw) => {
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

      const dKey = deepseekKey();
      const translator: Translator | null = dKey
        ? createDeepSeekTranslator({
            apiKey: dKey,
            model: TRANSLATE_MODEL,
            firstTokenMs: TRANSLATE_FIRST_TOKEN_MS,
            timeoutMs: TRANSLATE_TIMEOUT_MS,
          })
        : null;
      if (!dKey) console.log('No DEEPSEEK_API_KEY. Using Soniox built-in translation only.');

      session = startSonioxSession(ws, {
        sonioxKey: sKey,
        translator,
        idleCompleteMs: IDLE_COMPLETE_MS,
        idlePendingMs: IDLE_PENDING_TRANSLATION_MS,
        maxReconnect: SONIOX_MAX_RECONNECT,
        maxSessionAudioSec: MAX_SESSION_AUDIO_SEC,
      });
      return;
    }

    if (msg.type === 'audio' && msg.data && session) {
      session.onAudio(msg.data);
    }

    if (msg.type === 'audio_end' && session?.onAudioEnd) {
      session.onAudioEnd();
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
