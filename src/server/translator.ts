import type { Lang } from './types';

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

export interface DeepSeekOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Soft deadline: abort + fail if no first token arrives in time. */
  firstTokenMs: number;
  /** Hard deadline: abort + fail if the whole translation exceeds this. */
  timeoutMs: number;
}

const SYSTEM_PROMPT =
  'You are a professional real-time conversation interpreter between Chinese and English. ' +
  'Translate the user-provided utterance into the target language. ' +
  'Output ONLY the translation — no quotes, no notes, no original text, no explanations. ' +
  'Preserve tone and meaning; render natural, idiomatic speech suitable for live captions.';

/**
 * DeepSeek V4 Flash translator over the OpenAI-compatible streaming chat API.
 *
 * Quality-first primary translator. On timeout/HTTP/network failure it throws
 * TranslationFailed so the caller can fall back to Soniox's built-in translation.
 * When a newer translation supersedes this one (external signal), it throws
 * TranslationAborted so the caller can ignore it without triggering fallback.
 */
export function createDeepSeekTranslator(opts: DeepSeekOptions): Translator {
  const baseUrl = (opts.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');

  return {
    async translate(input, onDelta) {
      const target: Lang = input.originalLang === 'en' ? 'zh' : 'en';
      const targetName = target === 'zh' ? 'Simplified Chinese' : 'English';

      const userParts: string[] = [];
      if (input.context.length) {
        userParts.push(`Conversation so far (for context, do not translate):\n${input.context.slice(-4).join('\n')}\n`);
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
      const hardTimer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, opts.timeoutMs);

      const cleanup = () => {
        clearTimeout(firstTokenTimer);
        clearTimeout(hardTimer);
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
