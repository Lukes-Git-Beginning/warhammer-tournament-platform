/**
 * BaLi 2.0 — unit tests for the pairing cost + playoff seeding handicap (both pure, no DB).
 * These lock the calibration decisions from the 2026-07-15 design review.
 */

import { describe, it, expect } from 'vitest';
import {
  bandGapCost,
  pairCost,
  EVENTUAL_REMATCH_COST,
  IMMEDIATE_REMATCH_COST,
} from '../src/lib/bali-pairing-cost.js';
import {
  playoffHandicap,
  adjustedSeedScore,
} from '../src/lib/bali-playoff-seeding.js';

describe('bandGapCost — progressive + asymmetric', () => {
  it('is 0 for the same band and symmetric', () => {
    expect(bandGapCost(3, 3)).toBe(0);
    expect(bandGapCost(2, 4)).toBe(bandGapCost(4, 2));
  });

  it('makes every Δ1 uniform and cheap (< rematch), so low bands are not repelled', () => {
    for (const [a, b] of [[1, 2], [2, 3], [3, 4], [4, 5]] as const) {
      expect(bandGapCost(a, b)).toBe(1.0);
      expect(bandGapCost(a, b)).toBeLessThan(EVENTUAL_REMATCH_COST);
    }
  });

  it('puts the asymmetry only in Δ2+: a low gap hurts more than a high one', () => {
    expect(bandGapCost(1, 3)).toBe(2.5); // b1-b3
    expect(bandGapCost(3, 5)).toBe(2.1); // b3-b5 (raised from 1.3 so a Δ2 costs > two Δ1 singles)
    expect(bandGapCost(1, 3)).toBeGreaterThan(bandGapCost(3, 5));
  });

  it('has the ordering rematch < b3-b5 (Δ2) < b1-b3 (Δ2)', () => {
    // Alex 2026-07-23: every Δ2 now costs > two Δ1 singles (2×1.0), which also lands it ABOVE an
    // eventual rematch (1.5) — so the optimiser prefers replaying an old opponent to a 2-band stomp,
    // and prefers two singles to one Δ2. The low-band Δ2 still hurts most (asymmetry survives).
    expect(EVENTUAL_REMATCH_COST).toBeLessThan(bandGapCost(3, 5)); // a Δ2 is now dearer than a rematch
    expect(bandGapCost(3, 5)).toBeLessThan(bandGapCost(1, 3)); // and the low-band Δ2 is the dearest
  });

  it('makes extreme play-ups very expensive', () => {
    expect(bandGapCost(1, 5)).toBe(9.0);
    expect(bandGapCost(1, 4)).toBe(5.0);
  });
});

describe('pairCost — band gap + rematch', () => {
  it('forbids an immediate rematch', () => {
    expect(pairCost(3, 3, { immediate: true, metBefore: true })).toBe(IMMEDIATE_REMATCH_COST);
  });

  it('adds the eventual-rematch penalty', () => {
    expect(pairCost(3, 3, { immediate: false, metBefore: true })).toBe(EVENTUAL_REMATCH_COST);
    expect(pairCost(3, 4, { immediate: false, metBefore: true })).toBe(1.0 + EVENTUAL_REMATCH_COST);
  });

  it('a fresh Δ1 play-up (1.0) beats an eventual rematch (1.5)', () => {
    const freshPlayUp = pairCost(3, 4, { immediate: false, metBefore: false });
    const rematch = pairCost(3, 3, { immediate: false, metBefore: true });
    expect(freshPlayUp).toBeLessThan(rematch);
  });
});

describe('playoff handicap — scales with rounds, 0.2/band', () => {
  it('is 0 for the division own band', () => {
    expect(playoffHandicap(5, 5, 5)).toBe(0);
  });

  it('scales with rounds (flat −1 would not): 3/4/5/6 rounds → 0.6/0.8/1.0/1.2 per band', () => {
    expect(playoffHandicap(3, 5, 4)).toBeCloseTo(0.6);
    expect(playoffHandicap(4, 5, 4)).toBeCloseTo(0.8);
    expect(playoffHandicap(5, 5, 4)).toBeCloseTo(1.0);
    expect(playoffHandicap(6, 5, 4)).toBeCloseTo(1.2);
  });

  it('stacks per band below (b3 in a b5 division at 5 rounds = 2.0)', () => {
    expect(playoffHandicap(5, 5, 3)).toBeCloseTo(2.0);
  });

  it("matches Alex's calibration at 5 rounds", () => {
    // B4 5-0 (raw 5) → 4.0 beats B5 3-2 (raw 3); ties B5 4-1 (raw 4) → tie-breakers.
    expect(adjustedSeedScore(5, 5, 5, 4)).toBeCloseTo(4.0);
    expect(adjustedSeedScore(5, 5, 5, 4)).toBeGreaterThan(3); // beats a 3-2 own-band
    expect(adjustedSeedScore(5, 5, 5, 4)).toBeCloseTo(4); // ties a 4-1 own-band
  });

  it('the 6-round harshness: a borrowed 6-0 lands below a top 5-1', () => {
    expect(adjustedSeedScore(6, 6, 5, 4)).toBeCloseTo(4.8); // borrowed 6-0
    expect(4.8).toBeLessThan(5); // < top-band 5-1 raw
  });
});
