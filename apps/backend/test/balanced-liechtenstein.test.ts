import { describe, it, expect } from 'vitest';
import {
  planPairings,
  formDivisionPools,
  type BalancedParticipant,
  type BalancedMatchRow,
  type RankedPlayer,
} from '../src/lib/balanced-liechtenstein.js';

const R = (userId: string, band: number, rank: number): RankedPlayer => ({ userId, band, rank });

const P = (userId: string, band: number | null): BalancedParticipant => ({ userId, band });
const done = (round: number, a: string, b: string | null, winner: string): BalancedMatchRow => ({
  round,
  player1_id: a,
  player2_id: b,
  status: b === null ? 'BYE' : 'COMPLETED',
  // winner unused by the planner; kept for readability
  ...(winner ? {} : {}),
});
const ongoing = (round: number, a: string, b: string): BalancedMatchRow => ({
  round,
  player1_id: a,
  player2_id: b,
  status: 'ONGOING',
});

describe('planPairings — round 1 (batch)', () => {
  it('pairs every waiting player when the count is even', () => {
    const plan = planPairings([P('a', 3), P('b', 3), P('c', 3), P('d', 3)], [], 3);
    expect(plan.pairings).toHaveLength(2);
    expect(plan.byes).toHaveLength(0);
    expect(plan.complete).toBe(false);
    // all in round 1
    expect(plan.pairings.every((p) => p.round === 1)).toBe(true);
  });

  it('gives one bye when the count is odd', () => {
    const plan = planPairings([P('a', 3), P('b', 3), P('c', 3)], [], 3);
    expect(plan.pairings).toHaveLength(1);
    expect(plan.byes).toHaveLength(1);
    expect(plan.byes[0]!.round).toBe(1);
  });
});

describe('planPairings — skill banding', () => {
  it('prefers same-band pairings over cross-band', () => {
    // 2× band 2, 2× band 4 → must pair 2-2 and 4-4, never crossing.
    const plan = planPairings([P('a', 2), P('b', 2), P('c', 4), P('d', 4)], [], 3);
    expect(plan.pairings).toHaveLength(2);
    const bandOf: Record<string, number> = { a: 2, b: 2, c: 4, d: 4 };
    for (const p of plan.pairings) {
      expect(bandOf[p.player1_id]).toBe(bandOf[p.player2_id]);
    }
  });

  it('falls back to the nearest band (ascending) when no same-band partner exists', () => {
    const plan = planPairings([P('a', 2), P('b', 4)], [], 3);
    expect(plan.pairings).toHaveLength(1);
    expect(plan.byes).toHaveLength(0);
  });

  it('treats a null band as the default division', () => {
    const plan = planPairings([P('a', null), P('b', null)], [], 3);
    expect(plan.pairings).toHaveLength(1);
  });
});

describe('planPairings — incremental next round', () => {
  it('holds finished players when their pool still has incoming players', () => {
    // a,b played round 1 (done); c,d still playing round 1 (incoming to pool 2).
    // a and b just played each other → cannot rematch, and must wait for c/d.
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a'), ongoing(1, 'c', 'd')];
    const plan = planPairings([P('a', 3), P('b', 3), P('c', 3), P('d', 3)], matches, 3);
    expect(plan.pairings).toHaveLength(0);
    expect(plan.byes).toHaveLength(0); // held, not byed — reinforcements are coming
    expect(plan.complete).toBe(false);
  });

  it('pairs across the pool once enough players have arrived, excluding the last opponent', () => {
    // Round 1 fully done: a-b and c-d. Pool 2 = {a,b,c,d}. a must not rematch b,
    // c must not rematch d → the only valid pairing is a-c and b-d (or a-d, b-c).
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a'), done(1, 'c', 'd', 'c')];
    const plan = planPairings([P('a', 3), P('b', 3), P('c', 3), P('d', 3)], matches, 3);
    expect(plan.pairings).toHaveLength(2);
    expect(plan.pairings.every((p) => p.round === 2)).toBe(true);
    for (const p of plan.pairings) {
      const pair = new Set([p.player1_id, p.player2_id]);
      expect(pair).not.toEqual(new Set(['a', 'b']));
      expect(pair).not.toEqual(new Set(['c', 'd']));
    }
  });

  it('byes a straggler who is rematch-locked with no incoming players', () => {
    // Only a,b; they played round 1. Pool 2 = {a,b} but they just met → one byes.
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a')];
    const plan = planPairings([P('a', 3), P('b', 3)], matches, 3);
    expect(plan.pairings).toHaveLength(0);
    expect(plan.byes).toHaveLength(1);
  });
});

describe('planPairings — earliest COMPATIBLE, not earliest', () => {
  const bandOf: Record<string, number> = {
    a: 1, b: 1, // New
    g: 2, h: 2, // Beginner
    p: 3, q: 3, // Intermediate
    r: 4, // Advanced
  };

  it('holds two New players rather than shoving one three bands up to the lone Advanced', () => {
    // The reported bug: a,b (New) just played each other and r (Advanced) is free
    // after a bye, but the Beginners are still in round 1. Pairing a↔r (gap 3) now
    // is wrong — hold everyone and wait for a closer opponent to free up.
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'), // New vs New
      done(1, 'r', null, 'r'), // Advanced bye
      ongoing(1, 'g', 'h'), // Beginners still playing → incoming to pool 2
    ];
    const plan = planPairings(
      [P('a', 1), P('b', 1), P('r', 4), P('g', 2), P('h', 2)],
      matches,
      3,
    );
    expect(plan.pairings).toHaveLength(0);
    expect(plan.byes).toHaveLength(0); // held, not byed
  });

  it('pairs the New players with Beginners (gap 1), never the Advanced, once Beginners are free', () => {
    // a,b (New) and g,h (Beginner) are all free (each pair rematch-locked); r
    // (Advanced) is free too but Intermediates (p,q) are still incoming. The New
    // players take the Beginners at gap 1; r waits for a closer (Intermediate).
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'),
      done(1, 'g', 'h', 'g'),
      done(1, 'r', null, 'r'),
      ongoing(1, 'p', 'q'),
    ];
    const plan = planPairings(
      [P('a', 1), P('b', 1), P('g', 2), P('h', 2), P('r', 4), P('p', 3), P('q', 3)],
      matches,
      3,
    );
    expect(plan.pairings).toHaveLength(2);
    // r is held, not paired with anyone.
    expect(plan.pairings.flatMap((pp) => [pp.player1_id, pp.player2_id])).not.toContain('r');
    // Every pairing is exactly one band apart (New↔Beginner).
    for (const pp of plan.pairings) {
      expect(Math.abs(bandOf[pp.player1_id]! - bandOf[pp.player2_id]!)).toBe(1);
    }
  });

  it('still makes an unavoidable big jump when nothing closer is available or incoming', () => {
    // Only a (New) and r (Advanced) remain, both idle after byes, nobody else
    // coming → the gap-3 pairing must happen rather than deadlock.
    const matches: BalancedMatchRow[] = [done(1, 'a', null, 'a'), done(1, 'r', null, 'r')];
    const plan = planPairings([P('a', 1), P('r', 4)], matches, 3);
    expect(plan.pairings).toHaveLength(1);
    expect(plan.byes).toHaveLength(0);
  });
});

describe('planPairings — completion', () => {
  it('reports complete when everyone has played all rounds', () => {
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a')];
    const plan = planPairings([P('a', 3), P('b', 3)], matches, 1);
    expect(plan.complete).toBe(true);
    expect(plan.pairings).toHaveLength(0);
    expect(plan.byes).toHaveLength(0);
  });

  it('is not complete while a match is still ongoing', () => {
    const matches: BalancedMatchRow[] = [ongoing(1, 'a', 'b')];
    const plan = planPairings([P('a', 3), P('b', 3)], matches, 1);
    expect(plan.complete).toBe(false);
  });
});

describe('formDivisionPools', () => {
  it('keeps one level as a single pool and picks the top 2 as finalists', () => {
    const players = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => R(`p${r}`, 3, r));
    const pools = formDivisionPools(players);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.band).toBe(3);
    expect(pools[0]!.players).toHaveLength(8);
    expect(pools[0]!.finalists).toEqual(['p1', 'p2']);
  });

  it('borrows the best of the level below to fill a short top level', () => {
    // 3 level-5 (best ranks) + 5 level-3 → level5 pool = 3 own + best level-3.
    const players = [R('a', 5, 1), R('b', 5, 2), R('c', 5, 3), R('d', 3, 4), R('e', 3, 5), R('f', 3, 6), R('g', 3, 7), R('h', 3, 8)];
    const pools = formDivisionPools(players);
    expect(pools).toHaveLength(2);
    const top = pools.find((p) => p.band === 5)!;
    expect(top.players.map((p) => p.userId).sort()).toEqual(['a', 'b', 'c', 'd']); // d promoted
    expect(top.finalists).toEqual(['a', 'b']);
    const bottom = pools.find((p) => p.band === 3)!;
    expect(bottom.players).toHaveLength(4);
    expect(bottom.finalists).toEqual(['e', 'f']);
  });

  it('merges a trailing sub-minimum pool into the pool above', () => {
    // 4 level-5 + 2 level-3, nothing below to fill → the 2 join the level-5 pool.
    const players = [R('a', 5, 1), R('b', 5, 2), R('c', 5, 3), R('d', 5, 4), R('e', 3, 5), R('f', 3, 6)];
    const pools = formDivisionPools(players);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.players).toHaveLength(6);
    expect(pools[0]!.finalists).toEqual(['a', 'b']);
  });

  it('handles a tiny field (single pool, whatever its size)', () => {
    const pools = formDivisionPools([R('a', 3, 1), R('b', 3, 2), R('c', 3, 3)]);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.finalists).toEqual(['a', 'b']);
  });
});
