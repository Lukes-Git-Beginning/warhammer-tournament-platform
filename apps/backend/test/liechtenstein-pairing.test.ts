import { describe, expect, it } from 'vitest';
import { planLiechtensteinPairings, type LPlayer } from '../src/lib/liechtenstein-pairing.js';

function p(
  id: string,
  score: number,
  opts: { free?: boolean; played?: string[]; noContest?: string[]; receivedBye?: boolean } = {},
): LPlayer {
  return {
    id,
    score,
    played: new Set(opts.played ?? []),
    noContest: new Set(opts.noContest ?? []),
    free: opts.free ?? true,
    receivedBye: opts.receivedBye ?? false,
  };
}

const SEED = 'tourney-1';
const gap = (players: LPlayer[], a: string, b: string) => {
  const sa = players.find((x) => x.id === a)!.score;
  const sb = players.find((x) => x.id === b)!.score;
  return Math.abs(sa - sb);
};

describe('Liechtenstein ASAP planner', () => {
  it("realises the optimal round: 5 two-pointers + a one-pointer → two 2-2 and one 2-1 (all free)", () => {
    const players = [
      p('A', 2), p('B', 2), p('C', 2), p('D', 2), p('E', 2), // five 2-pointers
      p('F', 1),                                             // one 1-pointer
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toHaveLength(3);
    expect(plan.byes).toEqual([]);
    expect(plan.held).toEqual([]);
    const gaps = plan.pairs.map(([a, b]) => gap(players, a, b)).sort();
    expect(gaps).toEqual([0, 0, 1]); // exactly one forced 2-1, the rest 2-2
  });

  it('ASAP (odd group): a waiting 2-pointer takes the freed 1-pointer, because one 2-1 is permissible', () => {
    // A(2) is free; the other four 2-pointers are still playing; F(1) just freed up.
    const players = [
      p('A', 2, { free: true }),
      p('B', 2, { free: false }), p('C', 2, { free: false }), p('D', 2, { free: false }), p('E', 2, { free: false }),
      p('F', 1, { free: true }),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    // A and F are the only free players → the single realised pair must be A–F (the permissible 2-1).
    expect(plan.pairs).toEqual([['A', 'F']]);
    expect(plan.held).toEqual([]);
    expect(plan.byes).toEqual([]);
  });

  it('ASAP (even group): a free 2-pointer does NOT pair down — it holds for a same-score opponent', () => {
    // Even 2-group (A,B). Optimal plan has ZERO 2-1, so A must wait for B, not take C.
    const players = [
      p('A', 2, { free: true }), p('B', 2, { free: false }),
      p('C', 1, { free: true }), p('F', 1, { free: false }),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toEqual([]);              // no free-free pair is score-optimal
    expect(plan.held.sort()).toEqual(['A', 'C']); // both wait for their in-progress same-score partner
    expect(plan.byes).toEqual([]);
  });

  it('avoids a rematch when a fresh pairing exists — the played pair does not meet again', () => {
    // A & B already played; all three free, odd → one pair + one bye. A fresh pairing (A–C or B–C)
    // is far cheaper than the A–B rematch, so A–B is avoided; the third player byes.
    const players = [
      p('A', 1, { played: ['B'] }),
      p('B', 1, { played: ['A'] }),
      p('C', 1),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toHaveLength(1);
    const [x, y] = plan.pairs[0]!;
    expect([x, y].sort()).not.toEqual(['A', 'B']); // rematch avoided (a cheaper fresh pairing exists)
    expect([x, y]).toContain('C');
    expect(plan.byes).toHaveLength(1);
    expect(['A', 'B']).toContain(plan.byes[0]);
  });

  it('re-pairs a rematch as a LAST RESORT rather than stranding a player on a bye', () => {
    // Two free players who have already played and nobody else left. A hard exclusion would bye both
    // (stranding); cost-based avoidance re-pairs them instead — a rematch is better than no game.
    const players = [
      p('A', 1, { played: ['B'] }),
      p('B', 1, { played: ['A'] }),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0]!.slice().sort()).toEqual(['A', 'B']); // re-paired, not stranded
    expect(plan.byes).toEqual([]);
  });

  it('prefers a rematch over a NO_CONTEST re-pair (no-contest is avoided the most)', () => {
    // A played B (rematch) AND had a no-contest vs C. Odd trio, one pair + one bye. Pairing A costs
    // P_REMATCH (vs B) or P_NOCONTEST (vs C); the rematch is cheaper, so if A is paired it is with B.
    // Equivalently: the plan never pairs the no-contest pair (A–C) while a rematch (A–B) is available.
    const players = [
      p('A', 1, { played: ['B'], noContest: ['C'] }),
      p('B', 1, { played: ['A'] }),
      p('C', 1, { noContest: ['A'] }),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0]!.slice().sort()).not.toEqual(['A', 'C']); // never the no-contest re-pair here
  });

  it('holds a player who has played everyone still active (rematch as last resort) rather than bying', () => {
    // A has played B and C. B is free, C in-progress. With cost-based avoidance A is NOT a dead-end:
    // a fresh B–C pair is cheapest (B free), so A holds to be picked up next tick, no premature bye.
    const players = [
      p('A', 1, { free: true, played: ['B', 'C'] }),
      p('B', 1, { free: true }),
      p('C', 1, { free: false }),
    ];
    const plan = planLiechtensteinPairings(players, SEED);

    expect(plan.pairs).toEqual([]);        // B–C not realised (C in-progress)
    expect(plan.byes).toEqual([]);         // nobody stranded on a bye
    expect(plan.held.slice().sort()).toEqual(['A', 'B']);
  });

  it('is deterministic for a given seed', () => {
    const build = () => [p('A', 2), p('B', 2), p('C', 1), p('D', 1), p('E', 0), p('F', 0)];
    const a = planLiechtensteinPairings(build(), SEED);
    const b = planLiechtensteinPairings(build(), SEED);
    expect(a).toEqual(b);
  });
});
