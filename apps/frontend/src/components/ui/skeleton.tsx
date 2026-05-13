import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'animate-pulse rounded-sm bg-karaz-iron-800 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';
