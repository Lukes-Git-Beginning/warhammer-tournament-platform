import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface RizzottoSigilProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * @deprecated Kept for legacy SVG API. The sigil is now a raster asset,
   * so stroke-width is a no-op. Will be removed once all call sites are
   * migrated.
   */
  strokeWidth?: number;
  /**
   * @deprecated Used by the legacy SVG sigil for the stroke-draw animation.
   * No effect on the raster asset.
   */
  drawable?: boolean;
}

const SIGIL_URL = '/img/rizzotto-sigil.png';

export const RizzottoSigil = forwardRef<HTMLSpanElement, RizzottoSigilProps>(
  ({ className, strokeWidth: _strokeWidth, drawable: _drawable, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        role="img"
        aria-label="Rizzotto sigil"
        className={cn('inline-flex items-center justify-center', className)}
        {...rest}
      >
        <img
          src={SIGIL_URL}
          alt=""
          className="size-full select-none object-contain"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </span>
    );
  },
);
RizzottoSigil.displayName = 'RizzottoSigil';
