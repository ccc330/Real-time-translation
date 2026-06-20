import { TranslationMessage } from '@/types';
import { cn } from '@/lib/utils';

interface TranslationPanelProps {
  lang: 'en' | 'zh';
  messages: TranslationMessage[];
  placeholder: string;
  // Where the newest (largest) line sits. The active line hugs the centre mic;
  // older lines shrink and fade toward the outer edge.
  anchor: 'top' | 'bottom';
}

const textForLang = (m: TranslationMessage, lang: 'en' | 'zh') =>
  m.originalLang === lang ? m.originalText : m.translatedText;

const MAX_CAPTION_LINE_CHARS = 48;

const splitLongToken = (token: string, maxChars: number): string[] => {
  const chars = Array.from(token);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    chunks.push(chars.slice(i, i + maxChars).join(''));
  }
  return chunks;
};

const formatCaptionText = (text: string): string => {
  if (!text) return text;

  const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
  if (hasCjk) {
    const chars = Array.from(text);
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += MAX_CAPTION_LINE_CHARS) {
      lines.push(chars.slice(i, i + MAX_CAPTION_LINE_CHARS).join(''));
    }
    return lines.join('\n');
  }

  const lines: string[] = [];
  let line = '';

  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token.length > MAX_CAPTION_LINE_CHARS) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(...splitLongToken(token, MAX_CAPTION_LINE_CHARS));
      continue;
    }

    const next = line ? `${line} ${token}` : token;
    if (next.length > MAX_CAPTION_LINE_CHARS) {
      if (line) lines.push(line);
      line = token;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines.join('\n');
};

export function TranslationPanel({ lang, messages, placeholder, anchor }: TranslationPanelProps) {
  const recent = messages.slice(-3);
  const newestIdx = recent.length - 1;
  const ordered = anchor === 'bottom' ? recent : [...recent].reverse();

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col px-6 md:px-12',
        anchor === 'bottom' ? 'justify-end pb-12' : 'justify-start pt-12',
      )}
    >
      <span className="absolute left-6 top-4 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/55 md:left-12">
        {lang === 'en' ? 'English' : '中文'}
      </span>

      {recent.length === 0 ? (
        <p className="text-center text-lg font-light text-muted-foreground/40 md:text-2xl">
          {placeholder}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          {ordered.map((m) => {
            const realIdx = recent.indexOf(m);
            const depth = newestIdx - realIdx; // 0 = newest / largest
            const isActive = depth === 0 && !m.completed;
            const text = formatCaptionText(textForLang(m, lang));
            return (
              <p
                key={m.id}
                className={cn(
                  'max-w-3xl whitespace-pre-line break-words leading-tight tracking-tight transition-[font-size,color,opacity] duration-200',
                  depth === 0 && 'text-3xl font-medium text-foreground md:text-5xl',
                  depth === 1 && 'text-xl text-muted-foreground/70 md:text-2xl',
                  depth >= 2 && 'text-base text-muted-foreground/35 md:text-lg',
                )}
              >
                {text || ' '}
                {isActive && (
                  <span className="ml-1 inline-block h-[0.85em] w-[3px] translate-y-[2px] animate-pulse bg-foreground/70" />
                )}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
