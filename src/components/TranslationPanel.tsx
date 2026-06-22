import { TranslationMessage } from '@/types';
import { cn } from '@/lib/utils';

interface TranslationPanelProps {
  lang: 'en' | 'zh';
  messages: TranslationMessage[];
  placeholder: string;
  // Where the newest (largest) line sits — toward the centre rule.
  anchor: 'top' | 'bottom';
  // 'source' = this panel currently shows the spoken original (live input);
  // 'target' = it shows the translation; 'idle' = nothing being spoken.
  role: 'source' | 'target' | 'idle';
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

  const hasCjk = /[㐀-鿿豈-﫿]/.test(text);
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
      if (line) { lines.push(line); line = ''; }
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

export function TranslationPanel({ lang, messages, placeholder, anchor, role }: TranslationPanelProps) {
  const recent = messages.slice(-3);
  const newestIdx = recent.length - 1;
  const ordered = anchor === 'bottom' ? recent : [...recent].reverse();
  const langLabel = lang === 'en' ? 'English' : '中文';

  return (
    <section
      lang={lang === 'zh' ? 'zh-CN' : 'en'}
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        anchor === 'bottom' ? 'justify-end pb-16' : 'justify-start pt-16',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute left-0 right-0 z-10',
          anchor === 'bottom' ? 'bottom-5' : 'top-5',
        )}
      >
        <div className="mx-auto flex w-full max-w-[var(--mbk-maxw)] items-center px-[var(--mbk-margin)]">
          <span className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground/55">
            {langLabel}
          </span>
          {role !== 'idle' && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground/50">
              {role === 'source' ? (
                <>
                  <span className="size-1.5 rounded-full bg-brand" />
                  Live
                </>
              ) : (
                'Translation'
              )}
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[var(--mbk-maxw)] px-[var(--mbk-margin)]">
        {recent.length === 0 ? (
          <p className="max-w-[min(100%,20ch)] text-2xl font-light tracking-tight text-muted-foreground/35 md:text-3xl">
            {placeholder}
          </p>
        ) : (
          <div
            className={cn(
              'flex min-h-[clamp(10rem,22vh,17rem)] flex-col items-start gap-[calc(var(--mbk-bl)*3)] text-left',
              'md:gap-[calc(var(--mbk-bl)*5)]',
            )}
          >
            {ordered.map((m) => {
              const realIdx = recent.indexOf(m);
              const depth = newestIdx - realIdx; // 0 = newest / largest
              const isActive = depth === 0 && !m.completed;
              const text = formatCaptionText(textForLang(m, lang));
              return (
                <div
                  key={m.id}
                  className="flex min-w-0 items-end self-start"
                >
                  <p
                    className={cn(
                      'whitespace-pre-line break-words tracking-tight transition-all duration-200',
                      depth === 0 &&
                        'max-w-[min(100%,18ch)] text-[clamp(2.75rem,6vw,4.75rem)] font-medium leading-[0.98] text-foreground md:max-w-[22ch]',
                      depth === 1 &&
                        'max-w-[min(100%,24ch)] text-[clamp(1.2rem,2vw,1.65rem)] leading-[1.08] text-muted-foreground/70 md:max-w-[28ch]',
                      depth >= 2 &&
                        'max-w-[min(100%,30ch)] text-[clamp(0.92rem,1.25vw,1.05rem)] leading-[1.15] text-muted-foreground/35 md:max-w-[34ch]',
                    )}
                  >
                    {text || ' '}
                    {isActive && (
                      <span className="ml-1 inline-block h-[0.8em] w-[3px] translate-y-[2px] animate-pulse bg-brand align-middle" />
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
