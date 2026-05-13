import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface KarazWordmarkImageProps extends HTMLAttributes<HTMLImageElement> {
  /** Use the bronze "etched ground" variant. */
  bronze?: boolean;
  /** Width in pixels. Height scales automatically (aspect-ratio of asset). */
  width?: number;
  /** Loading strategy. Default 'eager' for header, 'lazy' for footer. */
  loading?: 'eager' | 'lazy';
}

/**
 * Karaz Lists wordmark lockup as a generated raster asset.
 * Combines the heraldic sigil tablet + the "Karaz Lists" inscription
 * in a single image. See public/img/karaz-wordmark.png.
 *
 * For tinted / inline use (footer mini, sigillum reveal animation),
 * use the SVG-based KarazSigil component instead.
 */
export const KarazWordmarkImage = forwardRef<HTMLImageElement, KarazWordmarkImageProps>(
  ({ className, bronze = false, width, loading = 'eager', style, ...rest }, ref) => {
    const base = bronze ? '/img/karaz-wordmark-bronze' : '/img/karaz-wordmark';
    return (
      <picture>
        <source srcSet={`${base}.avif`} type="image/avif" />
        <source srcSet={`${base}.webp`} type="image/webp" />
        <img
          ref={ref}
          src={`${base}.png`}
          alt="Karaz Lists"
          loading={loading}
          decoding="async"
          width={width}
          className={cn('h-auto select-none', className)}
          style={{ ...style, ...(width ? { width: `${width}px` } : undefined) }}
          {...rest}
        />
      </picture>
    );
  },
);
KarazWordmarkImage.displayName = 'KarazWordmarkImage';
