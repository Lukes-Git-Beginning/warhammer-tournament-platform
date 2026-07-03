import { describe, it, expect } from 'vitest';
import {
  planPairings,
  type BalancedParticipant,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';

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
