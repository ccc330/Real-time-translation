/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { TranslationMessage, ConnectionStatus } from './types';
import { AudioRecorder } from './utils/recorder';
import { Header } from './components/Header';
import { TranslationPanel } from './components/TranslationPanel';
import { MicButton } from './components/MicButton';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, RefreshCw, Sparkles, MicOff, Settings, BookOpen } from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [mockMode, setMockMode] = useState<boolean>(false);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Audio permission/access state errors
  const [micError, setMicError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  // Auto-connect on mount, and handle cleanup safely
  useEffect(() => {
    connectWS();
    return () => {
      disconnectWS();
      if (recorderRef.current) {
        recorderRef.current.stop();
      }
    };
  }, []);

  const disconnectWS = () => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const connectWS = () => {
    setStatus('connecting');
    setMicError(null);
    disconnectWS();

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live`;
      console.log('Connecting WebSocket to live translator:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket handshake success');
        setStatus('connected');
        // Let user know we are finalizing model setups on backend
        setStatus('initializing_gemini');
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'ready') {
            setStatus('ready');
          } else if (payload.type === 'mockInfo') {
            setMockMode(true);
            setStatus('ready'); // Ready under high fidelity mock mode
          } else if (payload.type === 'error') {
            console.error('WebSocket engine error:', payload.message);
            setStatus('error');
          } else if (payload.type === 'transcription') {
            const { id, originalLang, targetLang, originalText, translatedText } = payload;
            
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === id);
              const updatedMsg: TranslationMessage = {
                id,
                originalText,
                translatedText,
                originalLang,
                targetLang,
                completed: false,
                timestamp: prev[idx]?.timestamp || Date.now(),
              };

              if (idx !== -1) {
                const next = [...prev];
                next[idx] = updatedMsg;
                return next;
              } else {
                return [...prev, updatedMsg];
              }
            });
            setActiveId(id);
          } else if (payload.type === 'complete') {
            const { id } = payload;
            setMessages((prev) => 
              prev.map((m) => m.id === id ? { ...m, completed: true } : m)
            );
            setActiveId(null);
          }
        } catch (err) {
          console.error('Error parsing inbound frames:', err);
        }
      };

      ws.onclose = (e) => {
        console.warn('Socket closed:', e.reason || 'No specific reason given');
        setStatus('disconnected');
        setIsRecording(false);
        if (recorderRef.current) {
          recorderRef.current.stop();
        }
      };

      ws.onerror = (err) => {
        console.error('Socket error occurred:', err);
        setStatus('error');
      };

    } catch (e) {
      console.error('WebSocket connection invocation failed:', e);
      setStatus('error');
    }
  };

  const handleMicToggle = async () => {
    if (isRecording) {
      // Stop recording
      if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
      }
      setIsRecording(false);
    } else {
      // Ensure socket is available
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWS();
        return;
      }

      setMicError(null);
      
      // Initialize fresh audio recorder
      const recorder = new AudioRecorder(
        // onAudio data callback
        (base64PCM) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'audio',
              data: base64PCM
            }));
          }
        },
        // onError callback
        (err) => {
          setMicError(err?.message || 'Failed to acquire microphone access.');
          setIsRecording(false);
        }
      );

      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
    }
  };

  const handleClearFeed = () => {
    setMessages([]);
    setActiveId(null);
  };

  return (
    <div className="w-full h-screen bg-[#060606] flex justify-center overflow-hidden transition-colors duration-300">
      <div className="w-full max-w-7xl h-full flex flex-col bg-[#0a0a0a] md:border-x border-white/5 overflow-hidden relative">
        
        {/* Dynamic header status bar */}
        <Header 
          status={status} 
          mockMode={mockMode} 
          onClear={handleClearFeed}
          hasMessages={messages.length > 0} 
        />

        {/* Core Speech View Grid */}
        <div className="flex-1 flex flex-col min-h-0 relative select-none">
          
          {/* Top Panel - ENGLISH */}
          <TranslationPanel
            lang="en"
            messages={messages}
            activeId={activeId}
            hoveredId={hoveredId}
            onHoverId={setHoveredId}
            isTranslating={isRecording}
            panelTitle="ENGLISH PANELS (英文)"
            panelSub="SPOKEN English results / Chinese translations mirror here"
          />

          {/* Division hairline seam */}
          <div className="h-[1px] bg-white/5 relative" />

          {/* Bottom Panel - CHINESE */}
          <TranslationPanel
            lang="zh"
            messages={messages}
            activeId={activeId}
            hoveredId={hoveredId}
            onHoverId={setHoveredId}
            isTranslating={isRecording}
            panelTitle="中文面板 (CHINESE)"
            panelSub="中文语音识别结果 / 英文译文在此处镜像显示"
          />

          {/* Floating Central Mic Controls (Apple Elegant Aesthetic) */}
          <MicButton 
            isRecording={isRecording} 
            status={status} 
            onClick={handleMicToggle} 
          />
        </div>

        {/* Global Warnings / Guides overlay overlay panel absolute */}
        <AnimatePresence>
          {micError && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.95 }}
              className="absolute bottom-6 left-6 right-6 z-50 p-4 rounded-2xl bg-rose-950/40 border border-rose-900/30 flex items-start space-x-3 shadow-xl backdrop-blur-md"
            >
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-rose-200 uppercase tracking-wider">
                  麦克风权限受限 / Recorder Access Denied
                </h4>
                <p className="text-xs text-rose-350 mt-1 leading-relaxed">
                  {micError}. 请在浏览器地址栏检查或重设麦克风受信任，重新赋予此应用录音权限。
                </p>
              </div>
              <button
                onClick={() => setMicError(null)}
                className="text-rose-400 hover:text-rose-200 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-white/5 shrink-0 active:scale-95 cursor-pointer"
              >
                忽略 / Dismiss
              </button>
            </motion.div>
          )}

          {/* Server Connection Error Alert Overlays */}
          {(status === 'disconnected' || status === 'error') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-[#0a0a0a]/98 backdrop-blur-md flex flex-col items-center justify-center text-center p-8 select-none"
            >
              <div className="p-4 rounded-full bg-white/[0.02] border border-white/5 text-neutral-500 mb-6 animate-pulse">
                <RefreshCw className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white font-sans tracking-[0.1em] uppercase">
                {status === 'disconnected' ? '断开对讲连接 / Connection Lost' : '服务器初始化失败 / Session Error'}
              </h3>
              <p className="text-xs text-neutral-400 mt-2 max-w-sm leading-relaxed">
                {status === 'disconnected' 
                  ? '与翻译背部服务器断开。这可能是本地网络闪断。' 
                  : '初始化 Gemini 实时双会话失败，请验证您的 API 凭证。'}
              </p>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={connectWS}
                className="mt-8 px-6 py-3 rounded-full bg-white text-black text-xs font-bold tracking-widest uppercase hover:bg-neutral-100 transition-colors cursor-pointer shadow-lg flex items-center space-x-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重新连接翻译服务 / Retry Connection</span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
