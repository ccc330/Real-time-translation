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
 * Resolve a Lang from a provider language tag (e.g. Soniox token.language),
 * falling back to character-class detection when the tag is missing/unknown.
 * Single home for all language resolution.
 */
export function resolveLang(code: string | undefined, fallbackText: string): Lang {
  if (!code) return detectLang(fallbackText);
  if (code.startsWith('zh') || code === 'cmn' || code === 'yue') return 'zh';
  if (code.startsWith('en')) return 'en';
  return detectLang(fallbackText);
}

/**
 * Stitch a streaming delta onto an existing transcript, collapsing the
 * overlap that streaming ASR/MT often re-sends at chunk boundaries. The overlap
 * search is bounded so it stays cheap as the committed transcript grows.
 */
const MAX_MERGE_OVERLAP = 200;
export function mergeTranscript(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.endsWith(incoming)) return existing;

  const maxOverlap = Math.min(existing.length, incoming.length, MAX_MERGE_OVERLAP);
  for (let len = maxOverlap; len > 0; len--) {
    if (existing.endsWith(incoming.slice(0, len))) {
      return existing + incoming.slice(len);
    }
  }
  return existing + incoming;
}
