import { type ReactNode, useRef } from 'react';
import { cn, hasCjk } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'default' | 'compact';
}

/**
 * Liquid sliding segmented control. A single white pill glides between options
 * with a subtle spring overshoot (transform-only, interruptible, reduced-motion
 * safe). Accessible as a radiogroup with arrow-key navigation + roving tabindex.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  size = 'default',
}: SegmentedProps<T>) {
  const count = options.length;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isCompact = size === 'compact';

  const move = (dir: 1 | -1) => {
    const next = (selectedIndex + dir + count) % count;
    onChange(options[next].value);
    btnRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative isolate grid bg-muted p-1',
        isCompact ? 'h-8 w-fit rounded-full' : 'w-full rounded-2xl',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {/* Sliding "liquid" pill */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-1 z-0 bg-card shadow-soft dark:bg-muted-foreground/70 dark:shadow-none',
          isCompact ? 'rounded-full' : 'rounded-xl',
          'transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] motion-reduce:transition-none',
        )}
        style={{
          left: '0.25rem',
          width: `calc((100% - 0.5rem) / ${count})`,
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />

      {options.map((opt, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={opt.value}
            ref={(el) => { btnRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            }}
            className={cn(
              'relative z-10 flex items-center justify-center text-center outline-none transition-colors duration-200',
              'focus-visible:ring-2 focus-visible:ring-brand/40',
              isCompact ? 'h-6 min-w-8 rounded-full px-2' : 'min-h-11 flex-col rounded-xl px-3 py-2',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
            )}
          >
            {opt.icon && (
              <span className={cn('grid place-items-center', isCompact ? '[&_svg]:size-3.5' : 'mb-1 [&_svg]:size-4')}>
                {opt.icon}
              </span>
            )}
            <span
              lang={hasCjk(opt.label) ? 'zh-CN' : undefined}
              className={cn(
                'truncate',
                isCompact ? 'sr-only' : 'text-[13px]',
                selected ? 'font-semibold' : 'font-medium',
              )}
            >
              {opt.label}
            </span>
            {!isCompact && opt.sublabel && (
              <span
                lang={hasCjk(opt.sublabel) ? 'zh-CN' : undefined}
                className="mt-0.5 truncate text-[11px] font-normal text-muted-foreground/70"
              >
                {opt.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
