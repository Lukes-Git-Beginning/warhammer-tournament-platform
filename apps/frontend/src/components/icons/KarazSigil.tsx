import { forwardRef, type SVGProps } from 'react';
import { cn } from '@/lib/utils';

export interface KarazSigilProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Stroke thickness for the line variant. Defaults to 1.25. */
  strokeWidth?: number;
  /**
   * If true, the strokeDasharray will be applied to allow a draw-in animation
   * via the `--karaz-draw-length` CSS variable + `animate-karaz-draw` utility.
   */
  drawable?: boolean;
}

/**
 * Karaz Lists brand sigil — SVG-based, color-inheritable via `currentColor`.
 *
 * Used for tinted / inline placements where we want the sigil to take on a
 * Tailwind text-color (footer mini, sigillum-section reveal animation,
 * decorative inline icons).
 *
 * For the photographically-rendered logo lockup (header, hero, OG),
 * use `KarazWordmarkImage` instead — that one consumes the AI-generated
 * raster asset.
 */
export const KarazSigil = forwardRef<SVGSVGElement, KarazSigilProps>(
  ({ className, strokeWidth = 1.25, drawable = false, style, ...rest }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={cn('text-karaz-gold-400', className)}
      style={drawable ? ({ '--karaz-draw-length': 600 } as React.CSSProperties) : style}
      role="img"
      aria-label="Karaz Lists sigil"
      {...rest}
    >
      {/* outer carved tablet */}
      <path
        d="M8 6 L56 6 L60 12 L60 52 L56 58 L8 58 L4 52 L4 12 Z"
        strokeDasharray={drawable ? '600' : undefined}
        className={drawable ? 'animate-karaz-draw' : undefined}
      />
      {/* inner double-frame (engraving) */}
      <path
        d="M11 10 L53 10 L56 14 L56 50 L53 54 L11 54 L8 50 L8 14 Z"
        opacity="0.55"
      />
      {/* karaz rune — abstract K + dwarf-rune mark */}
      <g>
        <path d="M20 18 L20 46" />
        <path d="M20 32 L34 18" />
        <path d="M20 32 L34 46" />
        <path d="M40 18 L46 18 L46 26 L40 26 Z" />
        <path d="M40 30 L46 30 L46 38 L40 38 Z" />
      </g>
      {/* crossed hammers below the rune */}
      <g opacity="0.85">
        <path d="M18 50 L46 50" />
        <path d="M26 47 L28 50 L26 53" />
        <path d="M38 47 L36 50 L38 53" />
      </g>
    </svg>
  ),
);
KarazSigil.displayName = 'KarazSigil';
