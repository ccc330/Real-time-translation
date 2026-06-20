import { useCallback, useEffect, useRef, useState } from 'react';
import { TranslationMessage, ConnectionStatus, TranslationProvider, TranslationProviderOption } from '@/types';
import { AudioRecorder } from '@/utils/recorder';
import { Topbar } from '@/components/Topbar';
import { TranslationPanel } from '@/components/TranslationPanel';
import { MicButton } from '@/components/MicButton';
import { SettingsPanel } from '@/components/SettingsPanel';
import { Toaster } from '@/components/ui/sonner';
import { DEFAULT_SEGMENT_DELAY_MS, normalizeSegmentDelayMs, segmentDelayToConfig } from '@/segment';
import { toast } from 'sonner';

const SEGMENT_STORAGE = 'segment_granularity';
const TRANSLATE_PROVIDER_STORAGE = 'translate_provider';

const isTranslationProvider = (value: unknown): value is TranslationProvider =>
  value === 'deepseek' || value === 'mimo';

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [mockMode, setMockMode] = useState(false);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [translateProvider, setTranslateProvider] = useState<TranslationProvider | null>(() => {
    const stored = localStorage.getItem(TRANSLATE_PROVIDER_STORAGE);
    return isTranslationProvider(stored) ? stored : null;
  });
  const [engine, setEngine] = useState<{
    sttModel: string | null;
    translateModel: string | null;
    translateProvider: TranslationProvider | null;
    translateProviders: TranslationProviderOption[];
    mock: boolean;
  }>({
    sttModel: null,
    translateModel: null,
    translateProvider: null,
    translateProviders: [],
    mock: false,
  });
  const [segment, setSegment] = useState(() => {
    const v = Number(localStorage.getItem(SEGMENT_STORAGE));
    return Number.isFinite(v) ? normalizeSegmentDelayMs(v) : DEFAULT_SEGMENT_DELAY_MS;
  });

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const segmentRef = useRef(segment);
  const sessionStartedRef = useRef(false);
  const pendingRecordingStartRef = useRef(false);

  const disconnectWS = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      wsRef.current = null;
    }
    sessionStartedRef.current = false;
    pendingRecordingStartRef.current = false;
  }, []);

  const startRecorder = useCallback(async () => {
    if (recorderRef.current) return;

    let recorder: AudioRecorder;
    recorder = new AudioRecorder(
      (pcm) => {
        // Send raw PCM16 as a binary WS frame (no base64 / JSON overhead).
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcm);
        }
      },
      (err: any) => {
        toast.error(err?.message ? `麦克风：${err.message}` : '无法访问麦克风');
        if (recorderRef.current === recorder) recorderRef.current = null;
        setIsRecording(false);
      },
    );
    recorderRef.current = recorder;
    await recorder.start();
    if (recorderRef.current === recorder) setIsRecording(true);
  }, []);

  const requestSessionStart = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || sessionStartedRef.current) return false;
    sessionStartedRef.current = true;
    setStatus('initializing_gemini');
    ws.send(JSON.stringify({ type: 'init', translateProvider }));
    ws.send(JSON.stringify({ type: 'config', ...segmentDelayToConfig(segmentRef.current) }));
    return true;
  }, [translateProvider]);

  const connectWS = useCallback(() => {
    disconnectWS();
    setStatus('connecting');
    setMockMode(false);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('ready');
      if (pendingRecordingStartRef.current) requestSessionStart();
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
          if (pendingRecordingStartRef.current) {
            pendingRecordingStartRef.current = false;
            void startRecorder();
          }
          break;
        case 'mockInfo':
          setMockMode(true);
          setStatus('ready');
          if (pendingRecordingStartRef.current) {
            pendingRecordingStartRef.current = false;
            void startRecorder();
          }
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
  }, [disconnectWS, requestSessionStart, startRecorder]);

  useEffect(() => {
    if (!configLoaded || !translateProvider) return;
    connectWS();
    return () => {
      disconnectWS();
      recorderRef.current?.stop();
      recorderRef.current = null;
    };
  }, [configLoaded, connectWS, disconnectWS, translateProvider]);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        const serverProvider = isTranslationProvider(c.translateProvider) ? c.translateProvider : 'mimo';
        const providers = Array.isArray(c.translateProviders)
          ? c.translateProviders.filter((p: TranslationProviderOption) => isTranslationProvider(p?.id))
          : [];
        setEngine({
          sttModel: c.sttModel ?? null,
          translateModel: c.translateModel ?? null,
          translateProvider: serverProvider,
          translateProviders: providers,
          mock: !!c.mock,
        });
        setTranslateProvider((current) => current ?? serverProvider);
      })
      .catch(() => {
        setTranslateProvider((current) => current ?? 'mimo');
      })
      .finally(() => setConfigLoaded(true));
  }, []);

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
      pendingRecordingStartRef.current = true;
      connectWS();
      return;
    }
    if (!sessionStartedRef.current) {
      pendingRecordingStartRef.current = true;
      requestSessionStart();
      return;
    }
    await startRecorder();
  };

  const handleSegmentChange = (value: number) => {
    const normalizedValue = normalizeSegmentDelayMs(value);
    setSegment(normalizedValue);
    segmentRef.current = normalizedValue;
    localStorage.setItem(SEGMENT_STORAGE, String(normalizedValue));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'config', ...segmentDelayToConfig(normalizedValue) }));
    }
  };

  const handleTranslateProviderChange = (value: TranslationProvider) => {
    if (value === translateProvider) return;
    if (isRecording) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'audio_end' }));
      }
      recorderRef.current?.stop();
      recorderRef.current = null;
      setIsRecording(false);
    }
    sessionStartedRef.current = false;
    pendingRecordingStartRef.current = false;
    localStorage.setItem(TRANSLATE_PROVIDER_STORAGE, value);
    setTranslateProvider(value);
    setEngine((prev) => ({ ...prev, translateProvider: value }));
    toast.info('翻译引擎已切换，正在重新连接');
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
        hasMessages={messages.length > 0}
        onOpenSettings={() => setSettingsOpen(true)}
        onClear={() => setMessages([])}
      />

      <main className="relative flex min-h-0 flex-1 flex-col">
        <TranslationPanel
          lang="en"
          messages={messages}
          anchor="bottom"
          placeholder="Tap the mic and speak…"
        />

          <div className="mx-6 h-px bg-border/70 md:mx-12" />

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

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        segment={segment}
        onSegmentChange={handleSegmentChange}
        translateProvider={translateProvider ?? engine.translateProvider ?? 'mimo'}
        translateProviders={engine.translateProviders}
        onTranslateProviderChange={handleTranslateProviderChange}
        sttModel={engine.sttModel}
        translateModel={engine.translateModel}
        mock={engine.mock}
      />

      <Toaster position="top-center" richColors />
    </div>
  );
}
