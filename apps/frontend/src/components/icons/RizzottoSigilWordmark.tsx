import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { RizzottoSigil } from './RizzottoSigil';

export interface RizzottoSigilWordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Size of the sigil. Wordmark size scales accordingly. */
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { sigil: 'size-6', word: 'text-base' },
  md: { sigil: 'size-8', word: 'text-lg' },
  lg: { sigil: 'size-12', word: 'text-3xl' },
};

export const RizzottoSigilWordmark = forwardRef<HTMLSpanElement, RizzottoSigilWordmarkProps>(
  ({ className, size = 'md', ...rest }, ref) => {
    const cls = sizeMap[size];
    return (
      <span
        ref={ref}
        className={cn('inline-flex items-center gap-2.5', className)}
        aria-label="Rizzotto"
        {...rest}
      >
        <RizzottoSigil className={cn(cls.sigil, 'text-rizzotto-gold-500')} aria-hidden="true" />
        <span
          className={cn(
            'font-display font-semibold tracking-[0.16em] uppercase text-rizzotto-gold-500',
            cls.word,
          )}
        >
          Rizzotto
        </span>
      </span>
    );
  },
);
RizzottoSigilWordmark.displayName = 'RizzottoSigilWordmark';
