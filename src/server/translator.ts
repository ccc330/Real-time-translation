import { other, type Lang } from './types';

export interface TranslateInput {
  /** Committed original clause/utterance so far. */
  text: string;
  originalLang: Lang;
  /** Recent finalized turns (original text) for cross-sentence coherence. */
  context: string[];
  /** Cancels this translation when a newer one supersedes it. */
  signal: AbortSignal;
}

export interface Translator {
  /** Streams the full translated text via onDelta; resolves when complete. */
  translate(input: TranslateInput, onDelta: (fullTranslatedText: string) => void): Promise<void>;
}

/** Error thrown when translation could not be produced (timeout / HTTP / network). */
export class TranslationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationFailed';
  }
}

/** Error thrown when translation was cancelled because a newer one started. */
export class TranslationAborted extends Error {
  constructor() {
    super('translation superseded');
    this.name = 'TranslationAborted';
  }
}

export interface TranslatorOptions {
  apiKey: string;
  model: string;
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com or https://api.xiaomimimo.com/v1 */
  baseUrl: string;
  /** Soft deadline: fall back to Soniox if no first token arrives in time. */
  firstTokenMs: number;
  /** Inactivity deadline: abort + fail if the stream stalls (reset on each token). */
  timeoutMs: number;
}

// Kept short and stable: fewer prefix tokens = faster first token, and a stable
// prefix is automatically prompt-cached by DeepSeek across requests.
const SYSTEM_PROMPT =
  'Real-time zh<->en interpreter. Output ONLY the natural translation of the user text — ' +
  'no quotes, notes, or original.';

/**
 * Streaming translator over any OpenAI-compatible chat API (DeepSeek, Xiaomi MiMo, …).
 *
 * Primary translator. On timeout/HTTP/network failure it throws TranslationFailed so
 * the caller can fall back to Soniox's built-in translation. When aborted via the
 * caller's signal (hard cleanup) it throws TranslationAborted.
 */
export function createTranslator(opts: TranslatorOptions): Translator {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');

  return {
    async translate(input, onDelta) {
      const target: Lang = other(input.originalLang);
      const targetName = target === 'zh' ? 'Simplified Chinese' : 'English';

      // Keep the prompt lean for low first-token latency: at most the last 2 lines
      // of context, length-capped.
      const userParts: string[] = [];
      if (input.context.length) {
        const ctx = input.context.slice(-2).join('\n').slice(-400);
        userParts.push(`Context (do not translate):\n${ctx}\n`);
      }
      userParts.push(`Translate into ${targetName}:\n${input.text}`);

      const ac = new AbortController();
      let abortedByCaller = false;
      let timedOut = false;
      let gotFirstToken = false;

      const onExternalAbort = () => {
        abortedByCaller = true;
        ac.abort();
      };
      if (input.signal.aborted) onExternalAbort();
      else input.signal.addEventListener('abort', onExternalAbort, { once: true });

      const firstTokenTimer = setTimeout(() => {
        if (!gotFirstToken) {
          timedOut = true;
          ac.abort();
        }
      }, opts.firstTokenMs);
      // Inactivity (stall) timeout — reset on every token so a long but actively
      // streaming translation is never cut off mid-output (that would drop text);
      // only a genuinely stalled stream aborts.
      let stallTimer: NodeJS.Timeout;
      const resetStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          timedOut = true;
          ac.abort();
        }, opts.timeoutMs);
      };
      resetStall();

      const cleanup = () => {
        clearTimeout(firstTokenTimer);
        clearTimeout(stallTimer);
        input.signal.removeEventListener('abort', onExternalAbort);
      };

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            temperature: 0.2,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userParts.join('\n') },
            ],
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '');
          throw new TranslationFailed(`DeepSeek HTTP ${res.status} ${detail.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break;
            try {
              const json = JSON.parse(data);
              const delta: string = json.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                if (!gotFirstToken) {
                  gotFirstToken = true;
                  clearTimeout(firstTokenTimer);
                }
                resetStall();
                full += delta;
                onDelta(full);
              }
            } catch {
              // ignore malformed SSE keep-alive lines
            }
          }
        }
      } catch (err: any) {
        if (abortedByCaller) throw new TranslationAborted();
        if (timedOut) throw new TranslationFailed('DeepSeek translation timed out');
        if (err instanceof TranslationFailed) throw err;
        throw new TranslationFailed(`DeepSeek request error: ${err?.message ?? err}`);
      } finally {
        cleanup();
      }
    },
  };
}
