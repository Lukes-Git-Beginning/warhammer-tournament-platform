/**
 * Backfill-next-seed pool selection (semis-drop replacement).
 *
 * A Balanced Liechtenstein division pool borrows the best of the levels below and merges a short
 * trailing level (formDivisionPools), so a pool spans several bands. The backfill must draw the
 * replacement from the SURVIVOR'S OWN POOL walked in seed order — NOT from a plain "same band"
 * filter, which would miss the legitimately-borrowed lower-band members and fail to find any seed.
 *
 * This locks the mechanism the route uses (routes/matches.ts backfill-next-seed): rebuild the pools
 * exactly as startBalancedPlayoffs, find the survivor's pool, take the first not-yet-placed member.
 */
import { describe, it, expect } from 'vitest';
import {
  formDivisionPools,
  targetPoolSizeFromFormat,
  type RankedPlayer,
} from '../src/lib/balanced-liechtenstein.js';

// One lone top band (b5) + a full lower band (b4) + a lower one (b3). With target size 4 (TOP2),
// the b5 pool borrows down to 4 → it spans bands 5/4/3. b4/b3 pools then merge (trailing < min).
const FIELD: RankedPlayer[] = [
  { userId: 'Von', band: 5, rank: 1, rawScore: 4 }, // lone top-band survivor
  { userId: 'One', band: 4, rank: 2, rawScore: 3 },
  { userId: 'Riz', band: 3, rank: 3, rawScore: 2 },
  { userId: 'And', band: 3, rank: 4, rawScore: 1 },
  { userId: 'Sar', band: 2, rank: 5, rawScore: 1 },
  { userId: 'Hyp', band: 2, rank: 6, rawScore: 0 },
];

describe('backfill — the survivor pool spans bands, so same-band selection is wrong', () => {
  it('the b5 survivor pool borrows lower bands; its 3rd seed is NOT band 5', () => {
    const pools = formDivisionPools(FIELD, 4, targetPoolSizeFromFormat('TOP2'));
    const survivorPool = pools.find((p) => p.seeds.includes('Von'))!;
    expect(survivorPool).toBeDefined();
    // Borrowed down (and the short trailing level merged up) → the pool spans multiple bands.
    expect(survivorPool.seeds.length).toBeGreaterThanOrEqual(4);
    const bandOf = new Map(FIELD.map((p) => [p.userId, p.band]));
    const bands = new Set(survivorPool.seeds.map((u) => bandOf.get(u)));
    expect(bands.size).toBeGreaterThan(1); // NOT a single-band pool

    // Simulate a semis drop: seeds 1 & 2 are the finalists; seed 2 dropped → backfill the open slot.
    // The next replacement is the first pool member below the top two — a lower band than the b5 survivor.
    const placed = new Set([survivorPool.seeds[0], survivorPool.seeds[1]]);
    const nextSeed = survivorPool.seeds.find((u) => !placed.has(u))!;
    expect(nextSeed).toBeDefined();
    expect(bandOf.get(nextSeed)).not.toBe(5); // a plain same-band(=5) filter finds nothing here
  });
});
