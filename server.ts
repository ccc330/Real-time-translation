import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT) || 3000;
const IDLE_COMPLETE_MS = Number(process.env.IDLE_COMPLETE_MS || process.env.IDLE_FINALIZE_MS) || 750;
const IDLE_PENDING_TRANSLATION_MS = Number(process.env.IDLE_PENDING_TRANSLATION_MS) || 2200;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Reports whether the SERVER has a default key. The client may still supply
// its own per-user key over the WebSocket, which takes precedence.
app.get('/api/config', (req, res) => {
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  const hasServerKey = !!envKey && envKey !== 'MY_GEMINI_API_KEY';
  res.json({
    hasServerKey,
    modelName: process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview',
  });
});

// Upgrade HTTP connection to standard WebSocket under /live
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

type Lang = 'en' | 'zh';
type Session = { onAudio: (data: string) => void; onAudioEnd?: () => void; cleanup: () => void };
type LiveTurn = {
  id: string;
  originalLang: Lang;
  targetLang: Lang;
  originalText: string;
  translatedText: string;
  inputByTarget: Record<Lang, string>;
  canonicalInputTarget: Lang | null;
  activeTarget: Lang | null;
};

const other = (l: Lang): Lang => (l === 'en' ? 'zh' : 'en');
const targetLanguageCode = (l: Lang): string => (l === 'en' ? 'en' : 'zh-CN');

// Detect the dominant language of a transcript by character class.
function detectLang(text: string): Lang {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cjk > latin ? 'zh' : 'en';
}

// Mock simulation engine for when no key is present.
// Streams scripted bilingual dialogue with typist-like updates to simulate latency.
function startMockInterval(ws: WebSocket): Session {
  let count = 0;
  const mockPhrases = [
    { originalText: 'Hello there, welcome to Beijing. How can I help you?', translatedText: '你好，欢迎来到北京。有什么我可以帮您的吗？', originalLang: 'en', targetLang: 'zh' },
    { originalText: '谢谢！我想请问去附近的地铁站怎么走？', translatedText: 'Thank you! Could you please tell me how to get to the nearby subway station?', originalLang: 'zh', targetLang: 'en' },
    { originalText: "Go straight down this street, turn left at the second intersection, and you'll see the entrance.", translatedText: '沿着这条街直走，在第二个路口向左转，您就会看到入口了。', originalLang: 'en', targetLang: 'zh' },
    { originalText: '好的，太感谢了！祝你今天过得愉快！', translatedText: 'Understood, thank you so much! Have a wonderful day!', originalLang: 'zh', targetLang: 'en' },
    { originalText: 'You are welcome. Enjoy your stay here!', translatedText: '别客气。祝您在这里玩得开心！', originalLang: 'en', targetLang: 'zh' },
  ];

  let phraseTimer: NodeJS.Timeout | null = null;
  let incrementTimer: NodeJS.Timeout | null = null;
  let isProcessingSpeech = false;

  const onAudio = () => {
    if (isProcessingSpeech) return;
    isProcessingSpeech = true;

    phraseTimer = setTimeout(() => {
      const phrase = mockPhrases[count % mockPhrases.length];
      count++;

      const turnId = `mock-${Date.now()}`;
      const originalText = phrase.originalText;
      const translatedText = phrase.translatedText;

      let step = 0;
      const originalParts = originalText.length > 25 ? originalText.split(' ') : originalText.split('');
      const translatedParts = translatedText.length > 25 ? translatedText.split(' ') : translatedText.split('');
      const stepsCount = 6;

      incrementTimer = setInterval(() => {
        step++;
        const oJoin = originalText.length > 25 ? ' ' : '';
        const tJoin = translatedText.length > 25 ? ' ' : '';
        const oSlice = originalParts.slice(0, Math.ceil(originalParts.length * (step / stepsCount))).join(oJoin);
        const tSlice = translatedParts.slice(0, Math.ceil(translatedParts.length * (step / stepsCount))).join(tJoin);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transcription',
            id: turnId,
            originalLang: phrase.originalLang,
            targetLang: phrase.targetLang,
            originalText: oSlice,
            translatedText: tSlice,
          }));
        }

        if (step >= stepsCount) {
          if (incrementTimer) clearInterval(incrementTimer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'complete', id: turnId }));
          }
          isProcessingSpeech = false;
        }
      }, 400);
    }, 1500);
  };

  return {
    onAudio,
    cleanup: () => {
      if (phraseTimer) clearTimeout(phraseTimer);
      if (incrementTimer) clearInterval(incrementTimer);
    },
  };
}

/**
 * Real translation bridge for a single client connection.
 *
 * The Gemini Live Translate model streams input ASR and translated output
 * transcription. We keep one target-English and one target-Chinese session open
 * with echoTargetLanguage disabled; whichever session emits translated output
 * becomes the active target for the current utterance.
 */
function startLiveSession(ws: WebSocket, apiKey: string, liveModel: string): Session {
  console.log('Establishing Gemini Live Translate sessions...');

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const sessions: Record<Lang, any | null> = { en: null, zh: null };
  let isClosed = false;
  let turn: LiveTurn | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  const sendToClient = (data: any) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  const mergeTranscript = (existing: string, incoming: string): string => {
    if (!incoming) return existing;
    if (!existing) return incoming;
    if (incoming.startsWith(existing)) return incoming;
    if (existing.endsWith(incoming)) return existing;

    const maxOverlap = Math.min(existing.length, incoming.length);
    for (let len = maxOverlap; len > 0; len--) {
      if (existing.endsWith(incoming.slice(0, len))) {
        return existing + incoming.slice(len);
      }
    }
    return existing + incoming;
  };

  const ensureTurn = (sourceTarget: Lang): LiveTurn => {
    if (turn) return turn;
    turn = {
      id: `turn-${Date.now()}`,
      originalLang: other(sourceTarget),
      targetLang: sourceTarget,
      originalText: '',
      translatedText: '',
      inputByTarget: { en: '', zh: '' },
      canonicalInputTarget: null,
      activeTarget: null,
    };
    return turn;
  };

  const emitTurn = () => {
    if (!turn) return;
    sendToClient({
      type: 'transcription',
      id: turn.id,
      originalLang: turn.originalLang,
      targetLang: turn.targetLang,
      originalText: turn.originalText,
      translatedText: turn.translatedText,
    });
  };

  const completeTurn = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!turn) return;
    const id = turn.id;
    if (turn.originalText.trim() || turn.translatedText.trim()) emitTurn();
    turn = null;
    sendToClient({ type: 'complete', id });
  };

  const scheduleIdleComplete = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const delay = turn?.translatedText.trim() ? IDLE_COMPLETE_MS : IDLE_PENDING_TRANSLATION_MS;
    idleTimer = setTimeout(completeTurn, delay);
  };

  const handleMessage = (sourceTarget: Lang, message: any) => {
    if (isClosed) return;
    const sc = message.serverContent;
    if (!sc) return;

    const inputDelta: string = sc.inputTranscription?.text || '';
    if (inputDelta) {
      const t = ensureTurn(sourceTarget);
      t.inputByTarget[sourceTarget] = mergeTranscript(t.inputByTarget[sourceTarget], inputDelta);

      if (!t.activeTarget) {
        if (!t.canonicalInputTarget) t.canonicalInputTarget = sourceTarget;
        if (t.canonicalInputTarget === sourceTarget) {
          t.originalText = t.inputByTarget[sourceTarget];
          t.originalLang = detectLang(t.originalText);
          t.targetLang = other(t.originalLang);
          emitTurn();
        }
      } else if (t.activeTarget === sourceTarget) {
        t.originalText = t.inputByTarget[sourceTarget];
        t.originalLang = other(sourceTarget);
        t.targetLang = sourceTarget;
        emitTurn();
      }
      scheduleIdleComplete();
    }

    const outputDelta: string = sc.outputTranscription?.text || '';
    if (outputDelta) {
      const t = ensureTurn(sourceTarget);
      const sourceInput = t.inputByTarget[sourceTarget];
      const detectedOriginalLang = sourceInput ? detectLang(sourceInput) : null;

      if (detectedOriginalLang === sourceTarget) {
        scheduleIdleComplete();
        return;
      }

      if (!t.activeTarget) {
        t.activeTarget = sourceTarget;
        t.targetLang = sourceTarget;
        t.originalLang = detectedOriginalLang ?? other(sourceTarget);
      }
      if (t.activeTarget === sourceTarget) {
        if (sourceInput) {
          t.originalText = sourceInput;
          t.originalLang = detectedOriginalLang ?? t.originalLang;
        }
        t.translatedText = mergeTranscript(t.translatedText, outputDelta);
        emitTurn();
      }
      scheduleIdleComplete();
    }

    if (
      (sc.turnComplete || sc.generationComplete) &&
      (!turn || turn.activeTarget === sourceTarget || (!turn.activeTarget && turn.targetLang === sourceTarget))
    ) {
      completeTurn();
    }
  };

  const connectTarget = async (target: Lang) => {
    console.log(`Connecting Gemini Live Translate target=${targetLanguageCode(target)}...`);
    sessions[target] = await ai.live.connect({
      model: liveModel,
      config: {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: targetLanguageCode(target),
          echoTargetLanguage: false,
        },
      } as any,
      callbacks: {
        onmessage: (msg) => handleMessage(target, msg),
        onclose: () => console.log(`Gemini Translate target=${target} session closed.`),
        onerror: (err: any) => {
          console.error(`Gemini Translate target=${target} error:`, err);
          sendToClient({ type: 'error', message: `语音会话出错：${err?.message ?? err}` });
        },
      },
    });
  };

  const connect = async () => {
    try {
      await Promise.all([connectTarget('en'), connectTarget('zh')]);
      console.log('Gemini Live Translate pipeline ready.');
      sendToClient({ type: 'ready', model: liveModel });
    } catch (err: any) {
      console.error('Gemini Live initialization error:', err);
      sendToClient({ type: 'error', message: `初始化失败：${err?.message || err}。请检查 API Key 是否已开通 Live API。` });
    }
  };

  void connect();

  return {
    onAudio: (data: string) => {
      if (isClosed) return;
      try {
        const audio = { audio: { data, mimeType: 'audio/pcm;rate=16000' } };
        sessions.en?.sendRealtimeInput(audio);
        sessions.zh?.sendRealtimeInput(audio);
      } catch {}
    },
    onAudioEnd: () => {
      if (isClosed) return;
      try {
        sessions.en?.sendRealtimeInput({ audioStreamEnd: true });
        sessions.zh?.sendRealtimeInput({ audioStreamEnd: true });
      } catch {}
    },
    cleanup: () => {
      isClosed = true;
      if (idleTimer) clearTimeout(idleTimer);
      try { sessions.en?.close(); } catch {}
      try { sessions.zh?.close(); } catch {}
    },
  };
}

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
      const clientKey = (msg.apiKey || '').trim();
      const envKey = (process.env.GEMINI_API_KEY || '').trim();
      const apiKey = clientKey || (envKey && envKey !== 'MY_GEMINI_API_KEY' ? envKey : '');

      if (!apiKey) {
        console.log('No API key provided. Starting MOCK engine.');
        ws.send(JSON.stringify({ type: 'mockInfo', message: '未配置 API Key，正在使用演示翻译引擎。' }));
        session = startMockInterval(ws);
      } else {
        const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview';
        session = startLiveSession(ws, apiKey, liveModel);
      }
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Live translator service available on http://0.0.0.0:${PORT}`);
  });
}

startServer();
