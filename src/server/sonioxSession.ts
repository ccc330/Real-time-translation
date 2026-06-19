import { WebSocket } from 'ws';
import type { Lang, Session, ServerFrame } from './types';
import { other } from './types';
import { mergeTranscript, resolveLang } from './textUtils';
import { Translator, TranslationAborted } from './translator';

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = 'stt-rt-v5';
const END_TOKENS = new Set(['<end>', '<fin>']);

export interface SonioxOptions {
  sonioxKey: string;
  /** Primary translator (DeepSeek). If null, only Soniox built-in translation is used. */
  translator: Translator | null;
  /** Idle time after the last token before a turn is finalized. */
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
  translatedText: string; // what we actually show (DeepSeek, or Soniox until DeepSeek lands)
  translatedSource: string; // the original text the current translatedText was built from
  usingDeepSeek: boolean; // once DeepSeek emits, it owns translatedText (no flicker back to Soniox)
  draining: boolean; // a translation worker is running for this turn
  drainPromise: Promise<void> | null;
  completing: boolean;
  abort: AbortController; // aborted only on hard cleanup, never on supersede
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
      translatedSource: '',
      usingDeepSeek: false,
      draining: false,
      drainPromise: null,
      completing: false,
      abort: new AbortController(),
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

  // Single-flight translation worker: only one DeepSeek request runs per turn at
  // a time and it is NEVER aborted on supersede. It translates the full current
  // original; when it finishes it re-checks for newly-arrived text and continues.
  // This keeps captions complete (no thrash-induced word/segment drops) while
  // staying live, because each pass covers everything spoken so far.
  const drainTranslation = async (t: LiveTurn): Promise<void> => {
    if (!opts.translator) return;
    while (turn === t && !isClosed) {
      const source = (t.committedOriginal + t.pendingOriginal).trim();
      if (!source || source === t.translatedSource) break;
      t.translatedSource = source;
      try {
        await opts.translator.translate(
          { text: source, originalLang: t.originalLang, context: [...recentContext], signal: t.abort.signal },
          (full) => {
            // First DeepSeek token: take ownership of the caption (upgrades the
            // Soniox text that was shown instantly). It won't flicker back.
            if (turn === t) { t.usingDeepSeek = true; t.translatedText = full; emitTurn(); }
          },
        );
      } catch (err) {
        if (err instanceof TranslationAborted) break; // hard cleanup only
        // DeepSeek failed/stalled -> release the caption back to Soniox's live translation.
        if (turn === t) {
          t.usingDeepSeek = false;
          const fb = (t.committedTranslation + t.pendingTranslation).trim();
          if (fb) { t.translatedText = fb; emitTurn(); }
        }
        break; // avoid hot-looping on a persistent failure; next token re-kicks
      }
    }
  };

  const kickTranslation = () => {
    if (!turn || turn.draining) return;
    const t = turn;
    t.draining = true;
    t.drainPromise = drainTranslation(t).finally(() => { t.draining = false; });
  };

  const scheduleComplete = () => {
    if (completeTimer) clearTimeout(completeTimer);
    completeTimer = setTimeout(() => void completeTurn(), opts.idlePendingMs);
  };

  const completeTurn = async () => {
    if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
    if (!turn || turn.completing) return;
    const t = turn;
    t.completing = true;

    // Drain any in-flight + newly-arrived text so the final caption is complete.
    kickTranslation();
    if (t.drainPromise) { try { await t.drainPromise; } catch {} }

    if (turn !== t) return; // a fresh turn already took over

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

      // Show Soniox's built-in translation instantly (it streams at ASR speed) so the
      // translated caption appears with the original, instead of waiting for DeepSeek's
      // first token. DeepSeek upgrades it a beat later (see drainTranslation).
      if (!t.usingDeepSeek) {
        const sx = (t.committedTranslation + t.pendingTranslation).trim();
        if (sx) t.translatedText = sx;
      }

      emitTurn();
      scheduleComplete();
      kickTranslation(); // worker translates the full text-so-far, coalescing updates
    }

    if (endpoint) void completeTurn();
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
    onAudio: (buf: Buffer) => {
      if (isClosed || budgetTripped) return;
      if (!soniox || soniox.readyState !== WebSocket.OPEN) return;
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
      void completeTurn();
    },
    cleanup: () => {
      isClosed = true;
      if (completeTimer) clearTimeout(completeTimer);
      turn?.abort.abort();
      try { soniox?.close(); } catch {}
      const sec = (sentBytes / (2 * 16000)).toFixed(1);
      console.log(`Soniox session ended. Forwarded ~${sec}s of audio.`);
    },
  };
}
