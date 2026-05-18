import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, render the engraved-seam gradient style. */
  engraved?: boolean;
  orientation?: 'horizontal' | 'vertical';
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, engraved = false, orientation = 'horizontal', ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      className={cn(
        engraved
          ? 'rizzotto-seam'
          : orientation === 'horizontal'
            ? 'h-px w-full bg-rizzotto-iron-700'
            : 'h-full w-px bg-rizzotto-iron-700',
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = 'Separator';
