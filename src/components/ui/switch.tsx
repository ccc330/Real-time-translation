import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Switch({
  className,
  thumbClassName,
  children,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  thumbClassName?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border border-border/70 bg-muted p-1 transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none grid size-6 place-items-center rounded-full bg-card text-foreground shadow-soft transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)]',
          'data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0 motion-reduce:transition-none',
          thumbClassName,
        )}
      >
        {children}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
