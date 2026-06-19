import { useCallback, useEffect, useRef, useState } from 'react';
import { TranslationMessage, ConnectionStatus } from '@/types';
import { AudioRecorder } from '@/utils/recorder';
import { Topbar } from '@/components/Topbar';
import { TranslationPanel } from '@/components/TranslationPanel';
import { MicButton } from '@/components/MicButton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [mockMode, setMockMode] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const disconnectWS = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      wsRef.current = null;
    }
  }, []);

  const connectWS = useCallback(() => {
    disconnectWS();
    setStatus('connecting');
    setMockMode(false);
    setModel(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('initializing_gemini');
      ws.send(JSON.stringify({ type: 'init' }));
    };

    ws.onmessage = (event) => {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (payload.type) {
        case 'ready':
          setStatus('ready');
          setMockMode(false);
          setModel(payload.model ?? null);
          break;
        case 'mockInfo':
          setMockMode(true);
          setStatus('ready');
          break;
        case 'error':
          setStatus('error');
          toast.error(payload.message || '翻译服务出错');
          break;
        case 'transcription': {
          const { id, originalLang, targetLang, originalText, translatedText } = payload;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === id);
            const next: TranslationMessage = {
              id,
              originalText,
              translatedText,
              originalLang,
              targetLang,
              completed: false,
              timestamp: prev[idx]?.timestamp ?? Date.now(),
            };
            if (idx !== -1) {
              const copy = [...prev];
              copy[idx] = next;
              return copy;
            }
            return [...prev, next];
          });
          break;
        }
        case 'complete':
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.id ? { ...m, completed: true } : m)),
          );
          break;
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setIsRecording(false);
      recorderRef.current?.stop();
      recorderRef.current = null;
    };

    ws.onerror = () => setStatus('error');
  }, [disconnectWS]);

  useEffect(() => {
    connectWS();
    return () => {
      disconnectWS();
      recorderRef.current?.stop();
    };
  }, [connectWS, disconnectWS]);

  const handleMicToggle = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'audio_end' }));
      }
      setIsRecording(false);
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWS();
      return;
    }
    const recorder = new AudioRecorder(
      (base64PCM) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'audio', data: base64PCM }));
        }
      },
      (err: any) => {
        toast.error(err?.message ? `麦克风：${err.message}` : '无法访问麦克风');
        setIsRecording(false);
      },
    );
    recorderRef.current = recorder;
    await recorder.start();
    setIsRecording(true);
  };

  const footerText = mockMode
    ? '演示模式 · 服务器未配置语音识别 Key'
    : isRecording
      ? '正在聆听…'
      : status === 'ready'
        ? '轻点麦克风开始'
        : '连接中…';

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Topbar
        status={status}
        mockMode={mockMode}
        model={model}
        hasMessages={messages.length > 0}
        onClear={() => setMessages([])}
      />

      <main className="relative flex min-h-0 flex-1 flex-col">
        <TranslationPanel
          lang="en"
          messages={messages}
          anchor="bottom"
          placeholder="Tap the mic and speak…"
        />

        <div className="mx-6 h-px bg-border md:mx-12" />

        <TranslationPanel
          lang="zh"
          messages={messages}
          anchor="top"
          placeholder="点麦克风，开口即译…"
        />

        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <MicButton isRecording={isRecording} status={status} onClick={handleMicToggle} />
        </div>
      </main>

      <footer className="flex h-9 shrink-0 items-center justify-center px-4 text-[11px] text-muted-foreground/60">
        {footerText}
      </footer>

      <Toaster position="top-center" richColors />
    </div>
  );
}
