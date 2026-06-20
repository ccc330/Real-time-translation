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

export type TranslationProvider = 'deepseek' | 'mimo';

export interface TranslationProviderOption {
  id: TranslationProvider;
  label: string;
  model: string;
  configured: boolean;
}
