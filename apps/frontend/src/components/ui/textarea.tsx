import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full min-w-0 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800',
        'px-3 py-2 text-sm text-rizzotto-stone-100',
        'placeholder:text-rizzotto-stone-500',
        'transition-colors duration-base ease-burn',
        'focus:outline-none focus:border-rizzotto-gold-500 focus:ring-1 focus:ring-rizzotto-gold-500/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
