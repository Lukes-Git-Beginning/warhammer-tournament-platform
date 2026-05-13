import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { KarazSigil } from './KarazSigil';

export interface KarazSigilWordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Size of the sigil. Wordmark size scales accordingly. */
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { sigil: 'size-6', word: 'text-base' },
  md: { sigil: 'size-8', word: 'text-lg' },
  lg: { sigil: 'size-12', word: 'text-3xl' },
};

export const KarazSigilWordmark = forwardRef<HTMLSpanElement, KarazSigilWordmarkProps>(
  ({ className, size = 'md', ...rest }, ref) => {
    const cls = sizeMap[size];
    return (
      <span
        ref={ref}
        className={cn('inline-flex items-center gap-2.5', className)}
        aria-label="Karaz Lists"
        {...rest}
      >
        <KarazSigil className={cn(cls.sigil, 'text-karaz-gold-500')} aria-hidden="true" />
        <span
          className={cn(
            'font-display font-semibold tracking-[0.16em] uppercase text-karaz-gold-500',
            cls.word,
          )}
        >
          Karaz Lists
        </span>
      </span>
    );
  },
);
KarazSigilWordmark.displayName = 'KarazSigilWordmark';
