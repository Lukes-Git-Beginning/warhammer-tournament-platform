/**
 * Unit tests for the pure scoring math (Alex-Spec).
 * Covers raw points, opponent share/modifier (incl. player-specific asymmetry
 * and dynamic recovery), and final points.
 */
import { describe, expect, it } from 'vitest';
import {
  rawPoints,
  opponentShare,
  opponentModifier,
  finalPoints,
} from '../src/lib/scoring-service.js';

// ---------------------------------------------------------------------------
// #1 Raw points: 100 * (1 - ExpectedChanceToWin)
// ---------------------------------------------------------------------------

describe('rawPoints', () => {
  it('0.75 expected win chance → 25 points', () => {
    expect(rawPoints(0.75)).toBeCloseTo(25, 10);
  });

  it('matches the spec examples across the curve', () => {
    expect(rawPoints(0.9)).toBeCloseTo(10, 10);
    expect(rawPoints(0.5)).toBeCloseTo(50, 10);
    expect(rawPoints(0.25)).toBeCloseTo(75, 10);
    expect(rawPoints(0.1)).toBeCloseTo(90, 10);
  });
});

// ---------------------------------------------------------------------------
// #4 Opponent modifier
//   <20 total → 1 ; share<=5% → 1 ; share>=10% → 0 ; else (0.10-share)/0.05
// ---------------------------------------------------------------------------

describe('opponentModifier', () => {
  it('100 total, 5 vs opponent → 1.00', () => {
    expect(opponentModifier(opponentShare(5, 100), 100)).toBeCloseTo(1.0, 10);
  });

  it('100 total, 7 vs opponent → 0.60', () => {
    expect(opponentModifier(opponentShare(7, 100), 100)).toBeCloseTo(0.6, 10);
  });

  it('100 total, 10 vs opponent → 0.00', () => {
    expect(opponentModifier(opponentShare(10, 100), 100)).toBeCloseTo(0.0, 10);
  });

  it('19 total, 10 vs opponent → 1.00 (below the 20-match floor)', () => {
    expect(opponentModifier(opponentShare(10, 19), 19)).toBeCloseTo(1.0, 10);
  });

  it('ramps linearly 6..9%', () => {
    expect(opponentModifier(0.06, 100)).toBeCloseTo(0.8, 10);
    expect(opponentModifier(0.08, 100)).toBeCloseTo(0.4, 10);
    expect(opponentModifier(0.09, 100)).toBeCloseTo(0.2, 10);
  });
});

// ---------------------------------------------------------------------------
// #5 Player-specific (asymmetric) modifier — same 8 shared matches, different
//    totals → different modifiers.
// ---------------------------------------------------------------------------

describe('player-specific opponent modifier', () => {
  it('A: 200 total, 8 vs B → share 4% → 1.00', () => {
    expect(opponentShare(8, 200)).toBeCloseTo(0.04, 10);
    expect(opponentModifier(opponentShare(8, 200), 200)).toBeCloseTo(1.0, 10);
  });

  it('B: 40 total, 8 vs A → share 20% → 0.00', () => {
    expect(opponentShare(8, 40)).toBeCloseTo(0.2, 10);
    expect(opponentModifier(opponentShare(8, 40), 40)).toBeCloseTo(0.0, 10);
  });
});

// ---------------------------------------------------------------------------
// #6 Dynamic recovery — same 8 matches vs B, growing total → modifier recovers.
// ---------------------------------------------------------------------------

describe('dynamic recovery', () => {
  it('50 total, 8 vs B → 0; later 160 total, still 8 vs B → 1', () => {
    expect(opponentModifier(opponentShare(8, 50), 50)).toBeCloseTo(0.0, 10); // 16% share
    expect(opponentModifier(opponentShare(8, 160), 160)).toBeCloseTo(1.0, 10); // 5% share
  });
});

// ---------------------------------------------------------------------------
// #7 Final points = RawPoints * OpponentModifier
// ---------------------------------------------------------------------------

describe('finalPoints', () => {
  it('RawPoints 60, modifier 0.4 → 24', () => {
    expect(finalPoints(60, 0.4)).toBeCloseTo(24, 10);
  });
});
