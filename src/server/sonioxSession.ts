import { WebSocket } from 'ws';
import type { Lang, Session, ServerFrame } from './types';
import { other } from './types';
import { mergeTranscript, endsAtClauseBoundary, resolveLang } from './textUtils';
import { Translator, TranslationAborted } from './translator';

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = 'stt-rt-v5';
const END_TOKENS = new Set(['<end>', '<fin>']);

export interface SonioxOptions {
  sonioxKey: string;
  /** Primary translator (DeepSeek). If null, only Soniox built-in translation is used. */
  translator: Translator | null;
  /** Debounce: translate this long after the last token (catches micro-pauses). */
  translateDebounceMs: number;
  /** Force a (re)translation at least this often during continuous speech. */
  translateMaxIntervalMs: number;
  idlePendingMs: number;
  maxReconnect: number;
  /** Optional hard cap on audio seconds forwarded to Soniox (budget guard). */
  maxSessionAudioSec?: number;
}

interface SonioxToken {
  text: string;
  is_final?: boolean;
  language?: string;
  translation_status?: string;
}

interface LiveTurn {
  id: string;
  originalLang: Lang; // targetLang is always other(originalLang)
  committedOriginal: string;
  pendingOriginal: string;
  committedTranslation: string; // Soniox built-in (fallback source)
  pendingTranslation: string;
  translatedText: string; // what we actually show (DeepSeek, or fallback)
  translationSeq: number;
  translateAbort: AbortController | null;
  lastTranslateAt: number;
  lastTranslatedSource: string;
}

/**
 * Real translation bridge for a single client connection (Soniox STT + DeepSeek MT).
 *
 * One Soniox real-time WS session per client (two-way zh<->en translation enabled,
 * so Soniox's own translation is available as an instant fallback). Original tokens
 * drive captions immediately; committed clauses are translated by DeepSeek and
 * upserted. Endpointing follows the three-signal model in the design doc.
 */
export function startSonioxSession(ws: WebSocket, opts: SonioxOptions): Session {
  let soniox: WebSocket | null = null;
  let isClosed = false;
  let reconnects = 0;
  let sentBytes = 0;
  let budgetTripped = false;

  let turn: LiveTurn | null = null;
  let translateTimer: NodeJS.Timeout | null = null;
  let completeTimer: NodeJS.Timeout | null = null;
  const recentContext: string[] = [];

  const send = (frame: ServerFrame) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };

  const ensureTurn = (): LiveTurn => {
    if (turn) return turn;
    turn = {
      id: `turn-${Date.now()}`,
      originalLang: 'en',
      committedOriginal: '',
      pendingOriginal: '',
      committedTranslation: '',
      pendingTranslation: '',
      translatedText: '',
      translationSeq: 0,
      translateAbort: null,
      lastTranslateAt: 0,
      lastTranslatedSource: '',
    };
    return turn;
  };

  const emitTurn = () => {
    if (!turn) return;
    send({
      type: 'transcription',
      id: turn.id,
      originalLang: turn.originalLang,
      targetLang: other(turn.originalLang),
      originalText: (turn.committedOriginal + turn.pendingOriginal).trim(),
      translatedText: turn.translatedText.trim(),
    });
  };

  const runTranslation = async () => {
    if (!turn || !opts.translator) return;
    // Translate the full *visible* original (committed + pending) so the caption
    // grows live as the person speaks, rather than only after a clause finalizes.
    const text = (turn.committedOriginal + turn.pendingOriginal).trim();
    if (!text) return;

    const t = turn;
    t.lastTranslateAt = Date.now();
    t.lastTranslatedSource = text;
    const seq = ++t.translationSeq;
    t.translateAbort?.abort();
    const ac = new AbortController();
    t.translateAbort = ac;

    // turn === t guarantees the captured turn is still active; seq guards staleness.
    const isCurrent = () => turn === t && seq === t.translationSeq;

    try {
      await opts.translator.translate(
        { text, originalLang: t.originalLang, context: [...recentContext], signal: ac.signal },
        (full) => {
          if (isCurrent()) {
            t.translatedText = full;
            emitTurn();
          }
        },
      );
    } catch (err) {
      if (err instanceof TranslationAborted) return; // superseded by a newer translation
      // DeepSeek failed -> fall back to Soniox's built-in translation if available.
      if (isCurrent()) {
        const fb = (t.committedTranslation + t.pendingTranslation).trim();
        if (fb) t.translatedText = fb;
        else if (!t.translatedText) t.translatedText = '⋯（翻译重试中）';
        emitTurn();
      }
    }
  };

  const scheduleTimers = () => {
    if (translateTimer) clearTimeout(translateTimer);
    if (completeTimer) clearTimeout(completeTimer);
    // Short debounce: translate shortly after a micro-pause in speech.
    translateTimer = setTimeout(() => void runTranslation(), opts.translateDebounceMs);
    completeTimer = setTimeout(() => completeTurn(), opts.idlePendingMs);
  };

  const completeTurn = () => {
    if (translateTimer) { clearTimeout(translateTimer); translateTimer = null; }
    if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
    if (!turn) return;
    const t = turn;

    // Ensure a translation is shown before finalizing.
    if (!t.translatedText.trim()) {
      const fb = (t.committedTranslation + t.pendingTranslation).trim();
      if (fb) t.translatedText = fb;
    }
    if (t.committedOriginal.trim() || t.translatedText.trim()) emitTurn();

    if (t.committedOriginal.trim()) {
      recentContext.push(t.committedOriginal.trim());
      if (recentContext.length > 6) recentContext.shift();
    }
    const id = t.id;
    t.translateAbort?.abort();
    turn = null;
    send({ type: 'complete', id });
  };

  const handleTokens = (tokens: SonioxToken[]) => {
    let endpoint = false;
    let newFinalOriginal = '';
    let curNonFinalOriginal = '';
    let newFinalTranslation = '';
    let curNonFinalTranslation = '';
    let lastOriginalLangCode: string | undefined;
    let sawOriginal = false;

    for (const tok of tokens) {
      if (!tok.text) continue;
      if (END_TOKENS.has(tok.text)) { endpoint = true; continue; }

      const isTranslation = tok.translation_status === 'translation';
      if (isTranslation) {
        if (tok.is_final) newFinalTranslation += tok.text;
        else curNonFinalTranslation += tok.text;
      } else {
        sawOriginal = true;
        if (tok.language) lastOriginalLangCode = tok.language;
        if (tok.is_final) newFinalOriginal += tok.text;
        else curNonFinalOriginal += tok.text;
      }
    }

    if (sawOriginal || newFinalTranslation || curNonFinalTranslation) {
      const t = ensureTurn();
      if (newFinalOriginal) t.committedOriginal = mergeTranscript(t.committedOriginal, newFinalOriginal);
      t.pendingOriginal = curNonFinalOriginal;
      if (newFinalTranslation) t.committedTranslation = mergeTranscript(t.committedTranslation, newFinalTranslation);
      t.pendingTranslation = curNonFinalTranslation;

      const visible = (t.committedOriginal + t.pendingOriginal).trim();
      t.originalLang = resolveLang(lastOriginalLangCode, visible);

      emitTurn();
      scheduleTimers();

      // Translate eagerly so captions keep up with live speech:
      //  - immediately at a natural clause boundary, or
      //  - at least every translateMaxIntervalMs during continuous speech, when
      //    the original has grown since the last translation.
      const grew = visible.length > t.lastTranslatedSource.length;
      if (newFinalOriginal && endsAtClauseBoundary(t.committedOriginal)) {
        void runTranslation();
      } else if (grew && Date.now() - t.lastTranslateAt >= opts.translateMaxIntervalMs) {
        void runTranslation();
      }
    }

    if (endpoint) completeTurn();
  };

  const openSoniox = () => {
    if (isClosed) return;
    const sx = new WebSocket(SONIOX_URL);
    soniox = sx;

    sx.on('open', () => {
      reconnects = 0;
      sx.send(JSON.stringify({
        api_key: opts.sonioxKey,
        model: SONIOX_MODEL,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: ['en', 'zh'],
        enable_language_identification: true,
        enable_endpoint_detection: true,
        translation: {
          type: 'two_way',
          language_a: 'en',
          language_b: 'zh',
        },
      }));
      send({ type: 'ready', model: `${SONIOX_MODEL} + deepseek` });
    });

    sx.on('message', (raw) => {
      if (isClosed) return;
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.error_code || msg.error_message) {
        console.error(`Soniox error: code=${msg.error_code} message=${msg.error_message}`);
        send({ type: 'error', message: `Soniox 出错：${msg.error_message ?? msg.error_code}` });
        return;
      }
      if (Array.isArray(msg.tokens) && msg.tokens.length) handleTokens(msg.tokens);
      if (msg.finished) completeTurn();
    });

    sx.on('error', (err: any) => {
      console.error('Soniox WS error:', err?.message ?? err);
    });

    sx.on('close', (code: number, reason: Buffer) => {
      if (isClosed) return;
      const why = reason?.toString() || '(no reason)';
      console.log(`Soniox closed: code=${code} reason=${why}`);
      if (reconnects < opts.maxReconnect) {
        const delay = Math.min(2000, 250 * 2 ** reconnects);
        reconnects++;
        console.log(`Soniox closed; reconnecting (#${reconnects}) in ${delay}ms...`);
        setTimeout(openSoniox, delay);
      } else {
        send({ type: 'error', message: '语音识别连接已断开，请重试。' });
      }
    });
  };

  openSoniox();

  return {
    onAudio: (base64: string) => {
      if (isClosed || budgetTripped) return;
      if (!soniox || soniox.readyState !== WebSocket.OPEN) return;
      const buf = Buffer.from(base64, 'base64');
      sentBytes += buf.length;
      if (opts.maxSessionAudioSec) {
        const sec = sentBytes / (2 * 16000); // pcm_s16le mono @16k
        if (sec > opts.maxSessionAudioSec) {
          budgetTripped = true;
          send({ type: 'error', message: '已达本次会话的音频时长上限。' });
          return;
        }
      }
      try { soniox.send(buf); } catch {}
    },
    onAudioEnd: () => {
      if (isClosed) return;
      try { soniox?.send(''); } catch {} // Soniox end-of-audio signal
      completeTurn();
    },
    cleanup: () => {
      isClosed = true;
      if (translateTimer) clearTimeout(translateTimer);
      if (completeTimer) clearTimeout(completeTimer);
      turn?.translateAbort?.abort();
      try { soniox?.close(); } catch {}
      const sec = (sentBytes / (2 * 16000)).toFixed(1);
      console.log(`Soniox session ended. Forwarded ~${sec}s of audio.`);
    },
  };
}
