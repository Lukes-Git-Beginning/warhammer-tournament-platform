import type { ReactElement, SVGProps } from 'react';

// Marks for a tournament's two new axes. Team size → a small "2v2" chip on the status line.
// Battle type → a faint full-tile watermark behind the content (Card `watermark` slot).
//
// The battle-type glyphs below are our OWN generic, thematic silhouettes (a laurel + blade for
// Domination, a laurel + hammer for Conquest, a fortress for Siege) — NOT reproductions of the
// game's official artwork. Drop licensed symbol assets in and swap these out if desired.

/** A bold "2v2" chip for the tile's status row. */
export function Team2v2Badge() {
  return (
    <span className="inline-flex items-center rounded border border-violet-500/50 bg-violet-900/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-200">
      2v2
    </span>
  );
}

function DominationGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden {...props}>
      <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M46 98 C22 82 22 46 44 30" />
        <path d="M74 98 C98 82 98 46 76 30" />
        <path d="M31 74 l-9 -3 M27 62 l-10 0 M29 49 l-9 3 M36 39 l-8 5" />
        <path d="M89 74 l9 -3 M93 62 l10 0 M91 49 l9 3 M84 39 l8 5" />
      </g>
      <g fill="currentColor">
        <path d="M60 18 l7 14 -4 42 h-6 l-4 -42 z" />
        <rect x="42" y="70" width="36" height="7" rx="2" />
        <rect x="56" y="77" width="8" height="16" rx="2" />
        <circle cx="60" cy="97" r="6" />
      </g>
    </svg>
  );
}

function ConquestGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden {...props}>
      <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M46 98 C22 82 22 46 44 30" />
        <path d="M74 98 C98 82 98 46 76 30" />
        <path d="M31 74 l-9 -3 M27 62 l-10 0 M29 49 l-9 3 M36 39 l-8 5" />
        <path d="M89 74 l9 -3 M93 62 l10 0 M91 49 l9 3 M84 39 l8 5" />
      </g>
      <g fill="currentColor">
        <rect x="40" y="26" width="40" height="16" rx="3" />
        <rect x="55" y="42" width="10" height="52" rx="3" />
      </g>
    </svg>
  );
}

function SiegeGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden {...props}>
      <g fill="currentColor">
        {/* wall with an arched gate cut out */}
        <path
          fillRule="evenodd"
          d="M26 98 V56 H94 V98 Z M52 98 V76 a8 8 0 0 1 16 0 V98 Z"
        />
        {/* wall battlements */}
        <rect x="26" y="48" width="10" height="10" />
        <rect x="44" y="48" width="10" height="10" />
        <rect x="66" y="48" width="10" height="10" />
        <rect x="84" y="48" width="10" height="10" />
        {/* towers */}
        <rect x="16" y="38" width="20" height="60" />
        <rect x="84" y="38" width="20" height="60" />
        {/* tower battlements */}
        <rect x="16" y="30" width="7" height="10" />
        <rect x="29" y="30" width="7" height="10" />
        <rect x="84" y="30" width="7" height="10" />
        <rect x="97" y="30" width="7" height="10" />
      </g>
    </svg>
  );
}

const GLYPHS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  DOMINATION: DominationGlyph,
  CONQUEST: ConquestGlyph,
  SIEGE: SiegeGlyph,
};

/**
 * A faint, centred battle-type glyph for a tile's background (pass to Card's `watermark` slot).
 * It sits behind the content; an opaque poster at the top naturally leaves it visible only below.
 */
export function BattleTypeWatermark({ battleType }: { battleType?: string | null }) {
  const Glyph = battleType ? GLYPHS[battleType] : undefined;
  if (!Glyph) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
      <Glyph className="h-4/5 w-4/5 max-w-[220px] text-rizzotto-gold-500 opacity-[0.07]" />
    </div>
  );
}
