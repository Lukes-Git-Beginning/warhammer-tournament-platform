import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  label?: string;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, max = 100, label, className, ...props }, ref) => {
    const clamped = Math.max(0, Math.min(value, max));
    const ratio = max === 0 ? 0 : clamped / max;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-label={label}
        className={cn(
          'relative h-[3px] w-full overflow-hidden rounded-sm bg-karaz-iron-800',
          className,
        )}
        {...props}
      >
        <div
          className="h-full origin-left bg-gradient-to-r from-karaz-gold-500 via-karaz-gold-400 to-karaz-forge-500 transition-transform duration-base ease-burn motion-reduce:transition-none"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';
