import type { Lang } from './types';

/**
 * Detect the dominant language of a transcript by character class.
 * Used as a fallback when Soniox does not tag a token's language.
 */
export function detectLang(text: string): Lang {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cjk > latin ? 'zh' : 'en';
}

/**
 * Stitch a streaming delta onto an existing transcript, collapsing the
 * overlap that streaming ASR/MT often re-sends at chunk boundaries.
 */
export function mergeTranscript(existing: string, incoming: string): string {
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
}

/** True when committed text ends at a natural clause/sentence boundary. */
export function endsAtClauseBoundary(text: string): boolean {
  return /[。！？，、,.!?;；:：]\s*$/.test(text);
}
