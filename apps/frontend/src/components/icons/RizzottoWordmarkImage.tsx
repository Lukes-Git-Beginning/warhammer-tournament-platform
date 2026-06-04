import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface RizzottoWordmarkImageProps extends HTMLAttributes<HTMLImageElement> {
  /** Use the bronze "etched ground" variant. */
  bronze?: boolean;
  /**
   * Width in pixels. Height scales automatically (aspect-ratio of asset).
   * Do NOT combine with `h-*` Tailwind classes — that forces both dimensions
   * and breaks the natural aspect ratio (~2.6:1 for the wordmark asset).
   */
  width?: number;
  /** Loading strategy. Default 'eager' for header, 'lazy' for footer. */
  loading?: 'eager' | 'lazy';
}

/**
 * Rizzotto wordmark lockup as a generated raster asset.
 * Combines the heraldic sigil tablet + the "Rizzotto" inscription
 * in a single image. See public/img/rizzotto-wordmark.png.
 *
 * For tinted / inline use (footer mini, sigillum reveal animation),
 * use the SVG-based RizzottoSigil component instead.
 */
export const RizzottoWordmarkImage = forwardRef<HTMLImageElement, RizzottoWordmarkImageProps>(
  ({ className, bronze = false, width, loading = 'eager', style, ...rest }, ref) => {
    const base = bronze ? '/img/rizzotto-wordmark-bronze' : '/img/rizzotto-wordmark';
    return (
      <picture>
        <source srcSet={`${base}.avif`} type="image/avif" />
        <source srcSet={`${base}.webp`} type="image/webp" />
        <img
          ref={ref}
          src={`${base}.png`}
          alt="RizzOtto's Arena"
          loading={loading}
          fetchPriority={loading === 'eager' ? 'high' : undefined}
          decoding="async"
          width={width}
          className={cn('h-auto select-none wordmark-contrast', className)}
          style={{ ...style, ...(width ? { width: `${width}px` } : undefined) }}
          {...rest}
        />
      </picture>
    );
  },
);
RizzottoWordmarkImage.displayName = 'RizzottoWordmarkImage';
