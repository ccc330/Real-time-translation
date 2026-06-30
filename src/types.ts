export interface TranslationMessage {
  id: string;
  originalText: string;
  translatedText: string;
  originalLang: 'en' | 'zh';
  targetLang: 'en' | 'zh';
  completed?: boolean;
  timestamp: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'initializing_gemini' | 'ready' | 'error';

// The array is the single source of truth for valid provider ids; the type and
// the runtime guard both derive from it, so client + server never drift.
export const TRANSLATION_PROVIDERS = ['deepseek', 'mimo'] as const;
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number];

export const isTranslationProvider = (value: unknown): value is TranslationProvider =>
  typeof value === 'string' && (TRANSLATION_PROVIDERS as readonly string[]).includes(value);

export interface TranslationProviderOption {
  id: TranslationProvider;
  label: string;
  model: string;
  configured: boolean;
}
