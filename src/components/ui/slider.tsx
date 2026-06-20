import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const value = props.value?.[0] ?? props.defaultValue?.[0] ?? props.min ?? 0;
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 25;
  const progress = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const stepCount = step > 0 ? Math.round((max - min) / step) : 4;
  const tickValues =
    stepCount > 0 && stepCount <= 12
      ? Array.from({ length: stepCount + 1 }, (_, index) => min + index * step)
      : [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max];

  // While dragging, the thumb must track the finger 1:1 (no easing). On
  // click/keyboard changes it glides with the same spring as the segmented
  // control below, so the two controls feel like one motion language.
  const [dragging, setDragging] = React.useState(false);
  const endDrag = () => setDragging(false);

  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-6 w-full touch-none select-none items-center px-0.5', className)}
      onPointerDown={() => setDragging(true)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-5 w-full grow overflow-hidden rounded-[7px] bg-[#dededb]">
        <SliderPrimitive.Range className="absolute h-full rounded-[7px] bg-[#dededb]" />
        <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-between">
          {tickValues.map((tick) => {
            const tickProgress =
              max === min ? 0 : Math.min(100, Math.max(0, ((tick - min) / (max - min)) * 100));

            return (
            <span
              key={tick}
              className={cn(
                'size-0.5 rounded-full transition-colors',
                Math.abs(progress - tickProgress) <= 4 ? 'bg-brand' : 'bg-muted-foreground/35',
              )}
            />
            );
          })}
        </div>
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block h-[19px] w-4 rounded-[7px] border border-black/5 bg-white shadow-[0_1px_4px_oklch(0_0_0_/_0.12)] outline-none',
          dragging
            ? 'transition-none'
            : 'transition-all duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] motion-reduce:transition-none',
          'hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand/35 active:scale-100',
        )}
      />
    </SliderPrimitive.Root>
  );
}
