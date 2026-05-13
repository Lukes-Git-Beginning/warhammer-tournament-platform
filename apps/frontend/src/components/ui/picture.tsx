import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface PictureProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading' | 'width' | 'height'> {
  /** Asset path WITHOUT extension, e.g. "/img/hero-knight". */
  src: string;
  /** Alt text. Empty string for purely decorative images. */
  alt: string;
  /** Intrinsic width of the source PNG in px (used for CLS prevention). */
  width: number;
  /** Intrinsic height of the source PNG in px. */
  height: number;
  /** Above-the-fold? Sets loading=eager + fetchpriority=high. */
  priority?: boolean;
  /** object-position passthrough (also accepts full style override). */
  objectPosition?: string;
  /** className applied to the <img> child. */
  className?: string;
  /** style applied to the <img> child. */
  style?: CSSProperties;
}

/**
 * Karaz Lists picture wrapper.
 * Renders AVIF → WebP → PNG via <picture><source> negotiation.
 *
 * The build step `pnpm images:optimize` generates the .avif/.webp siblings
 * next to each source .png. In dev (no optimize step) the browser falls
 * back to the PNG and everything still works.
 */
export const Picture = forwardRef<HTMLImageElement, PictureProps>(
  ({ src, alt, width, height, priority, objectPosition, className, style, ...rest }, ref) => {
    const merged: CSSProperties = objectPosition ? { ...style, objectPosition } : (style ?? {});
    return (
      <picture>
        <source srcSet={`${src}.avif`} type="image/avif" />
        <source srcSet={`${src}.webp`} type="image/webp" />
        <img
          ref={ref}
          src={`${src}.png`}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className={cn(className)}
          style={merged}
          {...rest}
        />
      </picture>
    );
  },
);
Picture.displayName = 'Picture';
