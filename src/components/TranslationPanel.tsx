import { TranslationMessage } from '@/types';
import { cn } from '@/lib/utils';

interface TranslationPanelProps {
  lang: 'en' | 'zh';
  messages: TranslationMessage[];
  placeholder: string;
  // Where the newest (largest) line sits — toward the centre rule.
  anchor: 'top' | 'bottom';
  // Müller-Brockmann numbered field label (e.g. "01").
  index: string;
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

export function TranslationPanel({ lang, messages, placeholder, anchor, index, role }: TranslationPanelProps) {
  const recent = messages.slice(-3);
  const newestIdx = recent.length - 1;
  const ordered = anchor === 'bottom' ? recent : [...recent].reverse();
  const langLabel = lang === 'en' ? 'English' : '中文';

  return (
    <section
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        anchor === 'bottom' ? 'justify-end pb-8' : 'justify-start pt-8',
      )}
    >
      <div className="mx-auto w-full max-w-[var(--mbk-maxw)] px-[var(--mbk-margin)]">
        {/* Numbered field label — flush-left, grotesque, single accent on the index */}
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-brand tabular-nums">{index}</span>
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

        {recent.length === 0 ? (
          <p className="text-2xl font-light tracking-tight text-muted-foreground/35 md:text-3xl">
            {placeholder}
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2.5 text-left">
            {ordered.map((m) => {
              const realIdx = recent.indexOf(m);
              const depth = newestIdx - realIdx; // 0 = newest / largest
              const isActive = depth === 0 && !m.completed;
              const text = formatCaptionText(textForLang(m, lang));
              return (
                <p
                  key={m.id}
                  className={cn(
                    'max-w-[min(100%,22ch)] whitespace-pre-line break-words tracking-tight transition-all duration-200 md:max-w-[34ch]',
                    depth === 0 &&
                      'text-[clamp(2.25rem,5vw,3.75rem)] font-medium leading-[1.05] text-foreground',
                    depth === 1 && 'text-[clamp(1.125rem,2.2vw,1.625rem)] leading-[1.2] text-muted-foreground/70',
                    depth >= 2 && 'text-[clamp(0.9rem,1.4vw,1.0625rem)] leading-[1.3] text-muted-foreground/35',
                  )}
                >
                  {text || ' '}
                  {isActive && (
                    <span className="ml-1 inline-block h-[0.8em] w-[3px] translate-y-[2px] animate-pulse bg-brand align-middle" />
                  )}
                </p>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
