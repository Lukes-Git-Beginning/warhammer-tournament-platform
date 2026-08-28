import { describe, it, expect } from 'vitest';
import {
  formDivisionPools,
  targetPoolSizeFromFormat,
  type RankedPlayer,
} from '../src/lib/balanced-liechtenstein.js';

// Reseed cross-band handicap in a MERGED single division (small field).
//
// Since Fix A (v1.44.0), a field too small for two full divisions forms ONE division: here 12 players,
// TOP4 → target 8, so the band-2 tail (4 players) merges up into the band-5-anchored division instead of
// standing as a downgraded second bracket. The backfill/reseed then walks that one division's seed order
// (handicap-adjusted) and takes the first live, unplaced earner. Because the cross-band handicap SCALES
// with the round count (0.2 × rounds per band below the anchor), which player wins the vacated slot
// depends on the round count — and the rounds floor (Math.max(rounds_count, playedGroupRounds) in
// findNextDivisionSeed) keeps it from collapsing to rounds=1. This locks that ordering down.
//
// The field excludes the withdrawn survivor (findNextDivisionSeed filters WITHDREW before pooling).
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

describe('BaLi reseed cross-band handicap in a merged single division', () => {
  it('at 4 rounds the large band-gap handicap lets ponti (band 5, 1 win) hold the slot over Dniper (band 2, 3-0)', () => {
    // Dniper adjusted = 3 − 0.2×4×3 = 0.6 < ponti 1.0.
    expect(reseedPick(4)).toBe('ponti');
  });

  it('at 3 rounds the smaller handicap lets Dniper (band 2, 3-0 → adjusted 1.2) edge ponti (1.0)', () => {
    expect(reseedPick(3)).toBe('Dniper');
  });

  it('at a collapsed round count (1) the low band wins clearly — Dniper (adjusted 2.4)', () => {
    expect(reseedPick(1)).toBe('Dniper');
  });
});
