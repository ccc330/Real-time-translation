import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  sublabel?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
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
}: SegmentedProps<T>) {
  const count = options.length;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (dir: 1 | -1) => {
    const next = (selectedIndex + dir + count) % count;
    onChange(options[next].value);
    btnRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('relative isolate grid w-full rounded-2xl bg-muted p-1', className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {/* Sliding "liquid" pill */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-1 z-0 rounded-xl bg-card shadow-soft',
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
              'relative z-10 flex min-h-11 flex-col items-center justify-center rounded-xl px-3 py-2 text-center outline-none transition-colors duration-200',
              'focus-visible:ring-2 focus-visible:ring-brand/40',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
            )}
          >
            <span className={cn('truncate text-[13px]', selected ? 'font-semibold' : 'font-medium')}>
              {opt.label}
            </span>
            {opt.sublabel && (
              <span className="mt-0.5 truncate text-[11px] font-normal text-muted-foreground/70">
                {opt.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
