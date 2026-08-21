import { describe, it, expect } from 'vitest';
import {
  formDivisionPools,
  targetPoolSizeFromFormat,
  type RankedPlayer,
} from '../src/lib/balanced-liechtenstein.js';

// Regression for the anderland-over-ponti mis-seed (enticitys-thursday-…-free-pick-3, 2026-08-20).
//
// RizzOtto (band 3, raw 3 → adjusted 1.4) was correctly seeded #4 in the Top-Division semis (vs Pasha).
// He dropped from the semi; the backfill/reseed should have handed the vacated slot to the next
// eligible earner in the survivor's division by HANDICAP-adjusted order — ponti (band 5, raw 1 →
// adjusted 1.0) — NOT anderland (band 3, raw 2 → adjusted 0.4 at the real 4 rounds). anderland only
// wins the slot if the cross-band handicap is run at a collapsed round count (rounds ≤ 2), which the
// backfill's old `rounds_count ?? 1` fallback produced whenever rounds_count was null.
//
// The field below excludes the withdrawn RizzOtto (findNextDivisionSeed filters WITHDREW before pooling).
const field: RankedPlayer[] = [
  { userId: 'Pasha', band: 5, rank: 1, rawScore: 4 },
  { userId: 'YaS', band: 3, rank: 2, rawScore: 3 },
  { userId: 'Dniper', band: 2, rank: 3, rawScore: 3 },
  { userId: 'M4n1ek', band: 2, rank: 4, rawScore: 2 },
  { userId: 'anderland', band: 3, rank: 5, rawScore: 2 },
  { userId: 'GeneralJar', band: 2, rank: 6, rawScore: 2 },
  { userId: 'Byrd', band: 5, rank: 7, rawScore: 2 },
  { userId: 'ponti', band: 5, rank: 8, rawScore: 1 },
  { userId: 'Kite', band: 3, rank: 9, rawScore: 1 },
  { userId: 'Martinius', band: 5, rank: 10, rawScore: 1 },
  { userId: 'Marstuy', band: 2, rank: 11, rawScore: 1 },
  { userId: 'Reck', band: 4, rank: 12, rawScore: 1 },
];

// Mirror findNextDivisionSeed's pick: walk the survivor's division pool in (adjusted) seed order and
// take the first live, unplaced earner. The three surviving semifinalists are already in the bracket.
function reseedPick(rounds: number): string | undefined {
  const pools = formDivisionPools(field, rounds, targetPoolSizeFromFormat('TOP4'));
  const survivorPool = pools.find((p) => p.seeds.includes('Pasha'));
  const inPlayoffs = new Set(['Pasha', 'Byrd', 'YaS']);
  return survivorPool?.seeds.find((uid) => {
    if (inPlayoffs.has(uid)) return false;
    const p = field.find((f) => f.userId === uid);
    return !!p && p.rawScore > 0;
  });
}

describe('BaLi Top-Division reseed cross-band handicap', () => {
  it('at the real round count (4) the SF backfill picks ponti (band 5), not anderland (band 3)', () => {
    expect(reseedPick(4)).toBe('ponti');
  });

  it('the robust floor keeps ponti even for 3 rounds', () => {
    expect(reseedPick(3)).toBe('ponti');
  });

  it('documents the collapsed-handicap bug the fix prevents: rounds=1 mis-picks anderland', () => {
    expect(reseedPick(1)).toBe('anderland');
  });
});
