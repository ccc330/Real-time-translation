import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage } from '@google/genai';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = 3000;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Settings & Config status for frontend
app.get('/api/config', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' && process.env.GEMINI_API_KEY.trim() !== '';
  res.json({
    hasKey,
    mockMode: !hasKey,
    modelName: process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview'
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

// Mock simulation engine for when no key is present.
// It will stream in dynamic, contextual speech segments with typist-like updates to simulate standard latency.
function startMockInterval(ws: WebSocket) {
  let count = 0;
  const mockPhrases = [
    {
      originalText: "Hello there, welcome to Beijing. How can I help you?",
      translatedText: "你好，欢迎来到北京。有什么我可以帮您的吗？",
      originalLang: "en",
      targetLang: "zh"
    },
    {
      originalText: "谢谢！我想请问去附近的地铁站怎么走？",
      translatedText: "Thank you! Could you please tell me how to get to the nearby subway station?",
      originalLang: "zh",
      targetLang: "en"
    },
    {
      originalText: "Go straight down this street, turn left at the second intersection, and you'll see the entrance.",
      translatedText: "沿着这条街直走，在第二个路口向左转，您就会看到入口了。",
      originalLang: "en",
      targetLang: "zh"
    },
    {
      originalText: "好的，太感谢了！祝你今天过得愉快！",
      translatedText: "Understood, thank you so much! Have a wonderful day!",
      originalLang: "zh",
      targetLang: "en"
    },
    {
      originalText: "You are welcome. Enjoy your stay here!",
      translatedText: "别客气。祝您在这里玩得开心！",
      originalLang: "en",
      targetLang: "zh"
    }
  ];

  let phraseTimer: NodeJS.Timeout | null = null;
  let isProcessingSpeech = false;

  const onAudioReceived = () => {
    if (isProcessingSpeech) return;
    isProcessingSpeech = true;

    // Simulate speaker stopping after 1.5 seconds of voice input received
    phraseTimer = setTimeout(() => {
      const phrase = mockPhrases[count % mockPhrases.length];
      count++;

      const turnId = `mock-${Date.now()}`;
      const originalText = phrase.originalText;
      const translatedText = phrase.translatedText;

      // Stream words or characters progress
      let step = 0;
      const originalParts = originalText.length > 25 ? originalText.split(' ') : originalText.split('');
      const translatedParts = translatedText.length > 25 ? translatedText.split(' ') : translatedText.split('');
      
      const partsCount = Math.max(originalParts.length, translatedParts.length);
      const stepsCount = 6;

      const incrementTimer = setInterval(() => {
        step++;
        
        let oSlice = '';
        let tSlice = '';

        if (originalText.length > 25) {
          const wordsNum = Math.ceil(originalParts.length * (step / stepsCount));
          oSlice = originalParts.slice(0, wordsNum).join(' ');
        } else {
          const charsNum = Math.ceil(originalParts.length * (step / stepsCount));
          oSlice = originalParts.slice(0, charsNum).join('');
        }

        if (translatedText.length > 25) {
          const wordsNum = Math.ceil(translatedParts.length * (step / stepsCount));
          tSlice = translatedParts.slice(0, wordsNum).join(' ');
        } else {
          const charsNum = Math.ceil(translatedParts.length * (step / stepsCount));
          tSlice = translatedParts.slice(0, charsNum).join('');
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transcription',
            id: turnId,
            originalLang: phrase.originalLang,
            targetLang: phrase.targetLang,
            originalText: oSlice,
            translatedText: tSlice
          }));
        }

        if (step >= stepsCount) {
          clearInterval(incrementTimer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'complete',
              id: turnId
            }));
          }
          isProcessingSpeech = false;
        }
      }, 400);

    }, 1500);
  };

  return {
    onAudio: onAudioReceived,
    cleanup: () => {
      if (phraseTimer) clearTimeout(phraseTimer);
    }
  };
}

wss.on('connection', async (ws) => {
  console.log('Client WebSocket connected.');

  const apiKey = process.env.GEMINI_API_KEY;
  const isMockMode = !apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '';

  if (isMockMode) {
    console.log('Gemini API key is not configured. Initializing MOCK speech engine.');
    
    // Notify client they are operating in Mock State
    ws.send(JSON.stringify({ type: 'mockInfo', message: 'No GEMINI_API_KEY is defined in secrets. Running in high-fidelity mock translation engine.' }));

    const mockStream = startMockInterval(ws);
    
    ws.on('message', (message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === 'audio') {
          mockStream.onAudio();
        }
      } catch (err) {}
    });

    ws.on('close', () => {
      mockStream.cleanup();
      console.log('Client disconnected (mock session cleaned).');
    });
    return;
  }

  // --- Proceed with Real-time Dual-Session Gemini Live Connections ---
  console.log('Establishing dual Gemini Live sessions...');
  const modelName = process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview';

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  let sessionEn: any = null;
  let sessionZh: any = null;
  let isClosed = false;

  // Track the active translation stream session
  let activeSession: 'en' | 'zh' | null = null;
  let turnEn = { id: '', original: '', translation: '' };
  let turnZh = { id: '', original: '', translation: '' };
  let bufferEn = '';
  let bufferZh = '';
  
  // Buffers for input transcriptions before a session is locked
  let prelockUserTextEn = '';
  let prelockUserTextZh = '';
  let prelockModelTextEn = '';
  let prelockModelTextZh = '';

  const sendToClient = (data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };

  const handleLiveMessage = (sessionLang: 'en' | 'zh', message: any) => {
    if (isClosed) return;

    const turnComplete = message.serverContent?.turnComplete;
    
    let userText = message.serverContent?.inputTranscription?.text || '';
    let modelText = message.serverContent?.outputTranscription?.text || '';

    const modelParts = message.serverContent?.modelTurn?.parts;

    let modelAudioStr = '';
    if (modelParts) {
      for (const part of modelParts) {
        if (part.text) {
          modelText += part.text;
        }
        if (part.inlineData && part.inlineData.data) {
          modelAudioStr = part.inlineData.data;
        }
      }
    }

    // Accumulate pre-lock transcription
    if (activeSession === null) {
      if (sessionLang === 'en') {
        if (userText) prelockUserTextEn += userText;
        if (modelText) prelockModelTextEn += modelText;
      }
      if (sessionLang === 'zh') {
        if (userText) prelockUserTextZh += userText;
        if (modelText) prelockModelTextZh += modelText;
      }
    }

    let newlyLocked = false;
    // Lock active session if model actually starts translating (identified by audio output)
    if (activeSession === null && modelAudioStr) {
      activeSession = sessionLang;
      newlyLocked = true;
      if (sessionLang === 'en') {
        turnEn.id = `turn-zh-en-${Date.now()}`;
        bufferEn = prelockUserTextEn;
        turnEn.original = bufferEn;
        turnEn.translation = prelockModelTextEn;
      } else {
        turnZh.id = `turn-en-zh-${Date.now()}`;
        bufferZh = prelockUserTextZh;
        turnZh.original = bufferZh;
        turnZh.translation = prelockModelTextZh;
      }
      prelockUserTextEn = '';
      prelockUserTextZh = '';
      prelockModelTextEn = '';
      prelockModelTextZh = '';
    }

    // Reject message if another session has already been locked as active
    if (activeSession !== null && activeSession !== sessionLang) {
      return;
    }

    // If it hasn't locked yet, don't broadcast to UI to prevent dual ghost bubbles
    if (activeSession === null) {
       if (turnComplete) {
         if (sessionLang === 'en') { prelockUserTextEn = ''; prelockModelTextEn = ''; }
         if (sessionLang === 'zh') { prelockUserTextZh = ''; prelockModelTextZh = ''; }
       }
       return;
    }

    // Now process within the locked session
    if (activeSession === 'en') {
      let changed = newlyLocked; // Always trigger a broadcast if we just newly locked
      if (!newlyLocked) {
        if (userText) {
          bufferEn += userText;
          turnEn.original = bufferEn;
          changed = true;
        }
        if (modelText) {
          turnEn.translation += modelText;
          changed = true;
        }
      }
      if (changed) {
        sendToClient({
          type: 'transcription',
          id: turnEn.id,
          originalLang: 'zh',
          targetLang: 'en',
          originalText: turnEn.original || '...',
          translatedText: turnEn.translation
        });
      }
      if (modelAudioStr) {
        sendToClient({
          type: 'audio',
          data: modelAudioStr
        });
      }
    } else if (activeSession === 'zh') {
      let changed = newlyLocked;
      if (!newlyLocked) {
        if (userText) {
          bufferZh += userText;
          turnZh.original = bufferZh;
          changed = true;
        }
        if (modelText) {
          turnZh.translation += modelText;
          changed = true;
        }
      }
      if (changed) {
        sendToClient({
          type: 'transcription',
          id: turnZh.id,
          originalLang: 'en',
          targetLang: 'zh',
          originalText: turnZh.original || '...',
          translatedText: turnZh.translation
        });
      }
      if (modelAudioStr) {
        sendToClient({
          type: 'audio',
          data: modelAudioStr
        });
      }
    }

    // Handle turn completion
    if (turnComplete && activeSession === sessionLang) {
      const finishedId = sessionLang === 'en' ? turnEn.id : turnZh.id;
      sendToClient({
        type: 'complete',
        id: finishedId
      });

      // Clear lock and local session structures
      activeSession = null;
      bufferEn = '';
      bufferZh = '';
      prelockUserTextEn = '';
      prelockUserTextZh = '';
      turnEn = { id: '', original: '', translation: '' };
      turnZh = { id: '', original: '', translation: '' };
    }
  };

  const connectToGeminiLive = async () => {
    try {
      const isLiveTranslateModel = modelName.includes('translate');

      const configEn: any = {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      };

      if (isLiveTranslateModel) {
        configEn.translationConfig = {
          targetLanguageCode: 'en',
          echoTargetLanguage: false
        };
      } else {
        configEn.systemInstruction = "You are a professional real-time speech translator. Your ONLY job is to translate whatever the user says into English. Do not engage in a conversation. Output ONLY the translated English speech, nothing else.";
      }

      console.log(`Connecting sessionEn to model ${modelName} target 'en'...`);
      sessionEn = await ai.live.connect({
        model: modelName,
        config: configEn,
        callbacks: {
          onmessage: (msg) => handleLiveMessage('en', msg),
          onclose: () => console.log('Gemini Session EN closed.'),
          onerror: (err) => {
            console.error('Gemini Session EN error:', err);
            sendToClient({ type: 'error', message: 'Gemini Session EN error' });
          }
        }
      });

      const configZh: any = {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      };

      if (isLiveTranslateModel) {
        configZh.translationConfig = {
          targetLanguageCode: 'zh',
          echoTargetLanguage: false
        };
      } else {
        configZh.systemInstruction = "You are a professional real-time speech translator. Your ONLY job is to translate whatever the user says into Chinese. Do not engage in a conversation. Output ONLY the translated Chinese speech, nothing else.";
      }

      console.log(`Connecting sessionZh to model ${modelName} target 'zh'...`);
      sessionZh = await ai.live.connect({
        model: modelName,
        config: configZh,
        callbacks: {
          onmessage: (msg) => handleLiveMessage('zh', msg),
          onclose: () => console.log('Gemini Session ZH closed.'),
          onerror: (err) => {
            console.error('Gemini Session ZH error:', err);
            sendToClient({ type: 'error', message: 'Gemini Session ZH error' });
          }
        }
      });

      console.log('All Gemini translate pipelines are green and ready!');
      sendToClient({ type: 'ready' });

    } catch (err: any) {
      console.error('Gemini Live initialization error:', err);
      // Attempt fallback to general Live Model if Live Translate is not provisioned or access is denied
      if (modelName === 'gemini-3.5-live-translate-preview') {
        console.warn('Live Translate failed. Attempting automatic recovery with gemini-3.1-flash-live-preview...');
        process.env.GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
        await connectToGeminiLive();
      } else {
        sendToClient({ type: 'error', message: `Initialization failed: ${err?.message || err}` });
      }
    }
  };

  await connectToGeminiLive();

  // Forward raw audio messages
  ws.on('message', (message) => {
    if (isClosed) return;

    try {
      const payload = JSON.parse(message.toString());
      if (payload.type === 'audio' && payload.data) {
        const audioInput = {
          audio: {
            data: payload.data, // base64 pcm 16k mono
            mimeType: 'audio/pcm;rate=16000'
          }
        };

        if (sessionEn) {
          sessionEn.sendRealtimeInput(audioInput).catch(() => {});
        }
        if (sessionZh) {
          sessionZh.sendRealtimeInput(audioInput).catch(() => {});
        }
      }
    } catch (err) {}
  });

  ws.on('close', () => {
    isClosed = true;
    console.log('WebSocket closed by browser. Cleaning Gemini channels.');
    if (sessionEn) { try { sessionEn.close(); } catch (e) {} }
    if (sessionZh) { try { sessionZh.close(); } catch (e) {} }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Live translator service available on http://0.0.0.0:${PORT}`);
  });
}

startServer();
