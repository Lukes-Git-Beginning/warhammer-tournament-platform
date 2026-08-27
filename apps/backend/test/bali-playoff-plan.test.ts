/**
 * Frozen playoff plan (bali-playoff-plan.ts): skeleton derivation, live member resolution with
 * neighbour-bench borrow, and the bracket seat gate. See plans/bali-playoff-plan-freeze.md.
 */
import { describe, it, expect } from 'vitest';
import type { RankedPlayer, DivisionPool } from '../src/lib/balanced-liechtenstein.js';
import {
  derivePlayoffPlan,
  resolveDivisionPool,
  resolvePoolsFromPlan,
  bracketSeeds,
  type PlanDivision,
  type PlayoffPlan,
} from '../src/lib/bali-playoff-plan.js';

const rp = (userId: string, band: number, rank: number, rawScore: number): RankedPlayer => ({
  userId,
  band,
  rank,
  rawScore,
});

describe('derivePlayoffPlan — freeze the structure, not the members', () => {
  it('records band anchor, target size and per-band draw counts (own band first)', () => {
    const pool: DivisionPool = {
      band: 5,
      players: [
        rp('a', 5, 1, 4), rp('b', 5, 2, 3), rp('c', 5, 3, 2), rp('d', 5, 4, 1), rp('e', 5, 5, 1),
        rp('f', 4, 6, 3), rp('g', 4, 7, 2), rp('h', 4, 8, 1),
      ],
      seeds: [],
      finalists: null,
    };
    const plan = derivePlayoffPlan([pool]);
    expect(plan.divisions).toHaveLength(1);
    expect(plan.divisions[0]).toMatchObject({
      ordinal: 0,
      anchorBand: 5,
      targetSize: 8,
      draws: [{ band: 5, count: 5 }, { band: 4, count: 3 }],
    });
  });
});

describe('resolveDivisionPool — fill per draws, then neighbour-bench borrow', () => {
  const div: PlanDivision = {
    ordinal: 0,
    anchorBand: 5,
    targetSize: 8,
    draws: [{ band: 5, count: 5 }, { band: 4, count: 3 }],
  };

  it('fills exactly per the frozen draws when the field is intact', () => {
    const field = [
      rp('a', 5, 1, 4), rp('b', 5, 2, 3), rp('c', 5, 3, 2), rp('d', 5, 4, 1), rp('e', 5, 5, 1),
      rp('f', 4, 6, 3), rp('g', 4, 7, 2), rp('h', 4, 8, 1), rp('i', 4, 9, 0),
    ];
    const pool = resolveDivisionPool(div, field, 5);
    expect(pool).toHaveLength(8);
    // top-3 of band 4 by rank = f,g,h — NOT the 4th (i).
    expect(pool.map((p) => p.userId).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('covers a shortfall (dropped top-band players) by borrowing from the nearest lower band — no stranding', () => {
    // Two band-5 players dropped → only 3 remain; draws want 5. Shortfall = 2.
    const field = [
      rp('a', 5, 1, 4), rp('b', 5, 2, 3), rp('c', 5, 3, 2), // 3 band-5
      rp('f', 4, 4, 3), rp('g', 4, 5, 2), rp('h', 4, 6, 1), rp('i', 4, 7, 1), // 4 band-4
      rp('j', 3, 8, 2), rp('k', 3, 9, 1), // 2 band-3
    ];
    const pool = resolveDivisionPool(div, field, 5);
    // 3 band-5 + 3 drawn band-4 = 6; shortfall 2 → borrow the 4th band-4 (i), then the top band-3 (j).
    expect(pool).toHaveLength(8);
    const ids = new Set(pool.map((p) => p.userId));
    expect(ids.has('i')).toBe(true); // 4th band-4 borrowed
    expect(ids.has('j')).toBe(true); // then the TOP of the lower band (band 3)
    expect(ids.has('k')).toBe(false); // k is the bottom band-3, not needed
  });
});

describe('resolveDivisionPool — borrow precedence: lower-top before higher-bottom', () => {
  it('prefers the top of the lower band over any higher-band player', () => {
    const div: PlanDivision = { ordinal: 1, anchorBand: 4, targetSize: 4, draws: [{ band: 4, count: 4 }] };
    const field = [
      rp('p', 4, 3, 3), rp('q', 4, 4, 2), // only 2 band-4 (short by 2)
      rp('lowTop', 3, 5, 2), rp('lowBot', 3, 6, 1), // lower band (3)
      rp('hiTop', 5, 1, 5), rp('hiBot', 5, 2, 4), // higher band (5) — must NOT be taken
    ];
    const pool = resolveDivisionPool(div, field, 5);
    const ids = new Set(pool.map((p) => p.userId));
    expect(pool).toHaveLength(4);
    expect(ids.has('lowTop')).toBe(true);
    expect(ids.has('lowBot')).toBe(true);
    expect(ids.has('hiTop')).toBe(false);
    expect(ids.has('hiBot')).toBe(false);
  });

  it('reaches into the higher band (its BOTTOM) only once the lower band is exhausted', () => {
    const div: PlanDivision = { ordinal: 1, anchorBand: 4, targetSize: 4, draws: [{ band: 4, count: 2 }] };
    const field = [
      rp('p', 4, 3, 3), rp('q', 4, 4, 2), // 2 band-4
      rp('low', 3, 5, 2), // only 1 lower-band player
      rp('hiTop', 5, 1, 5), rp('hiMid', 5, 2, 4), rp('hiBot', 5, 3, 3), // higher band (bottom = hiBot by rank)
    ];
    const pool = resolveDivisionPool(div, field, 5);
    const ids = new Set(pool.map((p) => p.userId));
    expect(pool).toHaveLength(4); // p, q, low, + one higher
    expect(ids.has('low')).toBe(true);
    expect(ids.has('hiBot')).toBe(true); // the BOTTOM of the higher band
    expect(ids.has('hiTop')).toBe(false);
    expect(ids.has('hiMid')).toBe(false);
  });
});

describe('resolvePoolsFromPlan — top-first partition, shrinkage cascades, no stranding', () => {
  const plan: PlayoffPlan = {
    divisions: [
      { ordinal: 0, anchorBand: 5, targetSize: 4, draws: [{ band: 5, count: 2 }, { band: 4, count: 2 }] },
      { ordinal: 1, anchorBand: 3, targetSize: 4, draws: [{ band: 3, count: 2 }, { band: 2, count: 2 }] },
    ],
  };

  it('partitions the intact field into the two frozen divisions, no overlap', () => {
    const field = [
      rp('a', 5, 1, 4), rp('b', 5, 2, 3),
      rp('c', 4, 3, 3), rp('d', 4, 4, 2),
      rp('e', 3, 5, 2), rp('f', 3, 6, 1),
      rp('g', 2, 7, 2), rp('h', 2, 8, 1),
    ];
    const [top, bottom] = resolvePoolsFromPlan(plan, field, 5);
    expect(new Set(top.players.map((p) => p.userId))).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(new Set(bottom.players.map((p) => p.userId))).toEqual(new Set(['e', 'f', 'g', 'h']));
    // No player appears in both.
    expect(top.players.some((p) => bottom.players.find((q) => q.userId === p.userId))).toBe(false);
  });

  it('absorbs a lower-band drop into the bottom division without stranding anyone', () => {
    // 'e' (a band-3 player) dropped. Bottom division draws want 2 band-3 but only 1 is left.
    const field = [
      rp('a', 5, 1, 4), rp('b', 5, 2, 3),
      rp('c', 4, 3, 3), rp('d', 4, 4, 2),
      rp('f', 3, 6, 1), // only 1 band-3 now
      rp('g', 2, 7, 2), rp('h', 2, 8, 1), rp('i', 2, 9, 1), // 3 band-2
    ];
    const [top, bottom] = resolvePoolsFromPlan(plan, field, 5);
    // Top is untouched; bottom borrows the extra band-2 to cover the missing band-3. Everyone placed.
    expect(new Set(top.players.map((p) => p.userId))).toEqual(new Set(['a', 'b', 'c', 'd']));
    const placed = [...top.players, ...bottom.players].map((p) => p.userId);
    expect(new Set(placed)).toEqual(new Set(['a', 'b', 'c', 'd', 'f', 'g', 'h', 'i']));
    expect(new Set(placed).size).toBe(placed.length); // no double-placement
  });
});

describe('resolvePoolsFromPlan — never claim a parked player into an ALREADY-GENERATED pool', () => {
  // The RizzOtto bug: a borrowed neighbour band (band 4) dropped AFTER the top division was generated,
  // so the frozen top division would now re-borrow down to band 3 and "claim" that band's leader — but
  // its bracket is already fixed without them. The claim must be suppressed for a generated division so
  // the leader stays available for their own, not-yet-generated division instead of vanishing from both.
  const plan: PlayoffPlan = {
    divisions: [
      { ordinal: 0, anchorBand: 5, targetSize: 4, draws: [{ band: 5, count: 2 }, { band: 4, count: 2 }] },
      { ordinal: 1, anchorBand: 3, targetSize: 2, draws: [{ band: 3, count: 2 }] },
    ],
  };
  // A borrowed band-4 player has dropped → the top division is 1 short and would re-borrow band-3's top.
  const field = [
    rp('a', 5, 1, 4), rp('b', 5, 2, 3), // band 5
    rp('c', 4, 3, 3), // only 1 band-4 left (the other dropped)
    rp('rizz', 3, 4, 3), rp('m', 3, 5, 2), // band 3 (rizz = leader, perfect record)
  ];

  it('legacy (no `placed`) reproduces the bug — the leader is claimed up and stranded from their division', () => {
    const [top, bottom] = resolvePoolsFromPlan(plan, field, 3);
    expect(top.players.map((p) => p.userId)).toContain('rizz'); // borrowed up into the (fixed) top pool
    expect(bottom.seeds).not.toContain('rizz'); // …and gone from their own division
  });

  it('with `placed` = the generated top division, the leader stays in their own division', () => {
    const placed = new Set(['a', 'b', 'c']); // the top division's actual generated members
    const [, bottom] = resolvePoolsFromPlan(plan, field, 3, placed);
    expect(bottom.seeds[0]).toBe('rizz'); // #1 seed of their own division
    expect(bottom.seeds).toContain('m');
  });
});

describe('bracketSeeds — 0-point demoted, handicapped earner still seated', () => {
  it('puts every earner ahead of every 0-point player, regardless of adjusted score', () => {
    // A borrowed earner (band 3, 1 win → adjusted 1 - 0.2*5*2 = -1) vs an own-band-5 organic 0.
    // Sorted by adjusted the zero (0) outranks the earner (-1); bracketSeeds must still seat the earner first.
    const zero = rp('zeroOwn', 5, 1, 0);
    const earner = rp('earnerBorrowed', 3, 2, 1);
    // Pass in adjusted order (zero first) to prove the gate re-partitions.
    const seeds = bracketSeeds([zero, earner]);
    expect(seeds).toEqual(['earnerBorrowed', 'zeroOwn']);
  });

  it('keeps 0-point players in the pool (for size) but at the very back', () => {
    const pool = [rp('w', 5, 1, 3), rp('x', 5, 2, 2), rp('y', 5, 3, 0), rp('z', 5, 4, 0)];
    expect(bracketSeeds(pool)).toEqual(['w', 'x', 'y', 'z']);
    // Pool size (4) is preserved for format even though y,z can't take a top seat in a stronger pool.
    expect(pool).toHaveLength(4);
  });
});
