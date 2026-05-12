/**
 * Unit tests for computeEloDeltas() — ELO Engine Variant A2.
 *
 * All ratings default to 1200 unless stated otherwise.
 * K=32 (regular), K=48 (major).
 *
 * Derivations for mixed-rating scenarios differ from plan-file values — see
 * comments. Own calculation verified and used (plan-file had rounding errors).
 */
import { describe, expect, it } from 'vitest';
import { computeEloDeltas } from '../src/lib/elo.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make(userId: string, currentRating: number, placement: number) {
  return { userId, currentRating, placement };
}

// ---------------------------------------------------------------------------
// 2-Player scenarios (equal ratings, K=32)
// ---------------------------------------------------------------------------

describe('2P equal ratings', () => {
  const players = [
    make('A', 1200, 1),
    make('B', 1200, 2),
  ];

  it('Platz 1 → +16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(16);
  });

  it('Platz 2 → -16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(-16);
  });
});

// ---------------------------------------------------------------------------
// 3-Player scenarios (equal ratings, K=32)
// ---------------------------------------------------------------------------

describe('3P equal ratings', () => {
  const players = [
    make('A', 1200, 1),
    make('B', 1200, 2),
    make('C', 1200, 3),
  ];

  it('Platz 1 → +16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(16);
  });

  it('Platz 2 → 0', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(0);
  });

  it('Platz 3 → -16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'C')!.delta).toBe(-16);
  });
});

// ---------------------------------------------------------------------------
// 4-Player scenarios (equal ratings, K=32)
// ---------------------------------------------------------------------------

describe('4P equal ratings', () => {
  const players = [
    make('A', 1200, 1),
    make('B', 1200, 2),
    make('C', 1200, 3),
    make('D', 1200, 4),
  ];

  it('Platz 1 → +16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(16);
  });

  it('Platz 2 → +5', () => {
    // scoreP = 2/3 ≈ 0.6667, expectedP = 0.5, delta = round(32*0.1667) = round(5.333) = 5
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(5);
  });

  it('Platz 3 → -5', () => {
    // scoreP = 1/3 ≈ 0.3333, expectedP = 0.5, delta = round(32*(-0.1667)) = round(-5.333) = -5
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'C')!.delta).toBe(-5);
  });

  it('Platz 4 → -16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'D')!.delta).toBe(-16);
  });
});

// ---------------------------------------------------------------------------
// 8-Player and 16-Player edge positions (equal ratings)
// ---------------------------------------------------------------------------

describe('8P equal ratings', () => {
  const players = Array.from({ length: 8 }, (_, i) =>
    make(`P${i + 1}`, 1200, i + 1),
  );

  it('Platz 1 → +16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'P1')!.delta).toBe(16);
  });

  it('Platz 8 → -16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'P8')!.delta).toBe(-16);
  });
});

describe('16P equal ratings', () => {
  const players = Array.from({ length: 16 }, (_, i) =>
    make(`P${i + 1}`, 1200, i + 1),
  );

  it('Platz 1 → +16', () => {
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'P1')!.delta).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Major K=48
// ---------------------------------------------------------------------------

describe('Major K=48, 2P equal ratings', () => {
  const players = [
    make('A', 1200, 1),
    make('B', 1200, 2),
  ];

  it('Platz 1 → +24', () => {
    const results = computeEloDeltas(players, { isMajor: true });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(24);
  });

  it('Platz 2 → -24', () => {
    const results = computeEloDeltas(players, { isMajor: true });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(-24);
  });
});

// ---------------------------------------------------------------------------
// Mixed ratings: 2P A=1400 vs B=1200
// E(1400,1200) = 1/(1 + 10^(-200/400)) = 1/(1 + 0.31623) = 0.75974
// E(1200,1400) = 1 - 0.75974 = 0.24026
// ---------------------------------------------------------------------------

describe('2P mixed ratings (A=1400, B=1200)', () => {
  it('A (1400) gewinnt → Platz 1: round(32*(1.0-0.75974)) = round(7.69) = +8', () => {
    const players = [make('A', 1400, 1), make('B', 1200, 2)];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(8);
  });

  it('B (1200) gewinnt → Platz 1: round(32*(1.0-0.24026)) = round(24.31) = +24', () => {
    const players = [make('B', 1200, 1), make('A', 1400, 2)];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(24);
  });

  it('A (1400) Upset-Verlierer → Platz 2: round(32*(0.0-0.75974)) = round(-24.31) = -24', () => {
    const players = [make('B', 1200, 1), make('A', 1400, 2)];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'A')!.delta).toBe(-24);
  });
});

// ---------------------------------------------------------------------------
// 4P mixed ratings: [1300, 1200, 1200, 1100]
//
// Own derivation (plan-file values were incorrect):
//
// Player 1300 (Platz 1):
//   E(1300,1200) = 1/(1+10^(-100/400)) = 1/(1+10^-0.25) = 1/(1+0.56234) = 0.64013
//   E(1300,1100) = 1/(1+10^(-200/400)) = 1/(1+10^-0.5)  = 1/(1+0.31623) = 0.75974
//   expectedP = (0.64013 + 0.64013 + 0.75974)/3 = 0.68000
//   delta = round(32*(1.0 - 0.68000)) = round(10.24) = 10
//   (Plan-file said 13 — incorrect)
//
// Player 1100 (Platz 1):
//   E(1100,1300) = 1/(1+10^(200/400)) = 1/(1+3.16228) = 0.24026
//   E(1100,1200) = 1/(1+10^(100/400)) = 1/(1+1.77828) = 0.35987
//   expectedP = (0.24026 + 0.35987 + 0.35987)/3 = 0.32000
//   delta = round(32*(1.0 - 0.32000)) = round(21.76) = 22
//   (Plan-file said 19 — incorrect)
// ---------------------------------------------------------------------------

describe('4P mixed ratings [1300, 1200, 1200, 1100]', () => {
  it('1300 gewinnt (Platz 1) → delta = +10', () => {
    // Own calculation: +10 (plan-file: +13, incorrect)
    const players = [
      make('high', 1300, 1),
      make('mid1', 1200, 2),
      make('mid2', 1200, 3),
      make('low', 1100, 4),
    ];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'high')!.delta).toBe(10);
  });

  it('1100 gewinnt (Platz 1) → delta = +22', () => {
    // Own calculation: +22 (plan-file: +19, incorrect)
    const players = [
      make('low', 1100, 1),
      make('mid1', 1200, 2),
      make('mid2', 1200, 3),
      make('high', 1300, 4),
    ];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'low')!.delta).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// Zero-sum: sum of all deltas = 0 (4P equal ratings)
// ---------------------------------------------------------------------------

describe('Zero-sum property', () => {
  it('sum of all deltas is 0 for 4P equal ratings (16+5-5-16=0)', () => {
    const players = [
      make('A', 1200, 1),
      make('B', 1200, 2),
      make('C', 1200, 3),
      make('D', 1200, 4),
    ];
    const results = computeEloDeltas(players, { isMajor: false });
    const sum = results.reduce((acc, r) => acc + r.delta, 0);
    expect(sum).toBe(0);
  });

  it('sum of all deltas is 0 for 8P equal ratings', () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      make(`P${i + 1}`, 1200, i + 1),
    );
    const results = computeEloDeltas(players, { isMajor: false });
    const sum = results.reduce((acc, r) => acc + r.delta, 0);
    expect(sum).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tie between Platz 2 and 3 (N=4 all equal ratings)
// Avg rank = 2.5 → scoreP = (4 - 2.5) / 3 = 0.500, expectedP = 0.500 → delta = 0
// ---------------------------------------------------------------------------

describe('Tie handling', () => {
  it('Tie zwischen Platz 2 und 3 (N=4 gleiche Ratings) → beide delta = 0', () => {
    const players = [
      make('A', 1200, 1),
      make('B', 1200, 2),
      make('C', 1200, 2), // tied with B
      make('D', 1200, 4),
    ];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results.find((r) => r.userId === 'B')!.delta).toBe(0);
    expect(results.find((r) => r.userId === 'C')!.delta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// N=1 guard — Solo tournament
// ---------------------------------------------------------------------------

describe('N=1 guard', () => {
  it('Solo-Turnier → delta = 0, newRating = currentRating', () => {
    const players = [make('solo', 1400, 1)];
    const results = computeEloDeltas(players, { isMajor: false });
    expect(results).toHaveLength(1);
    expect(results[0]!.delta).toBe(0);
    expect(results[0]!.newRating).toBe(1400);
    expect(results[0]!.oldRating).toBe(1400);
  });
});

// ---------------------------------------------------------------------------
// Result shape validation
// ---------------------------------------------------------------------------

describe('Result shape', () => {
  it('returns correct shape with oldRating and newRating', () => {
    const players = [make('A', 1200, 1), make('B', 1200, 2)];
    const results = computeEloDeltas(players, { isMajor: false });
    const a = results.find((r) => r.userId === 'A')!;
    expect(a.oldRating).toBe(1200);
    expect(a.newRating).toBe(1216);
    expect(a.delta).toBe(16);
  });
});
