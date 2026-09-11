import { useState } from 'react';

// Marks for a tournament's two new axes. Team size → a small "2v2" chip on the status row.
// Battle type → a faint full-tile watermark behind the content (Card `watermark` slot), using
// the OFFICIAL symbol image supplied at /battle-types/<type>.png (see public/battle-types/).

/** A bold "2v2" chip for the tile's status row. */
export function Team2v2Badge() {
  return (
    <span className="inline-flex items-center rounded border border-violet-500/50 bg-violet-900/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-200">
      2v2
    </span>
  );
}

const BATTLE_TYPES = new Set(['DOMINATION', 'CONQUEST', 'SIEGE']);
// Tried in order; whatever format the official asset ships as just works. Hidden if none exist.
const EXTS = ['png', 'svg', 'webp'];

/**
 * A faint, centred battle-type symbol for a tile's background (pass to Card's `watermark` slot).
 * Renders the official image from `/battle-types/<type>.<ext>` (dropped into public/battle-types/);
 * until such a file exists it fails to load and renders nothing. Sits behind the content, so an
 * opaque poster at the top naturally leaves it visible only below.
 */
export function BattleTypeWatermark({ battleType }: { battleType?: string | null }) {
  const [attempt, setAttempt] = useState(0);
  if (!battleType || !BATTLE_TYPES.has(battleType) || attempt >= EXTS.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
      <img
        src={`/battle-types/${battleType.toLowerCase()}.${EXTS[attempt]}`}
        alt=""
        className="h-4/5 w-4/5 max-w-[240px] object-contain opacity-[0.08]"
        onError={() => setAttempt((a) => a + 1)}
      />
    </div>
  );
}
