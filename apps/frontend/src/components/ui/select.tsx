import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full min-w-0 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800',
        'px-3 py-2 text-sm text-rizzotto-stone-100',
        'transition-colors duration-base ease-burn',
        'focus:outline-none focus:border-rizzotto-gold-500 focus:ring-1 focus:ring-rizzotto-gold-500/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
