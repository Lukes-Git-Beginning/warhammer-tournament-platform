import { describe, it, expect } from 'vitest';
import { generateDoubleElim } from '../src/lib/bracket.js';

/** Deterministic PRNG (mulberry32) for reproducible playthroughs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play out a full DE bracket with random results and count how many Loser-Bracket matches in the
 * FIRST `earlyRounds` LB rounds are a rematch of an earlier pairing. Simulates purely from the
 * round-1 seeds through next_match_id / loser_next_match_id, so it depends only on the wiring.
 *
 * The cross-seed (bracket.ts: WB round-2+ losers drop into the LB in reversed order) guarantees
 * that two players who met in the winners bracket cannot meet again in the opening LB rounds — the
 * early rematches an un-seeded drop produces. (Rematches in the mid/late LB can still occur as the
 * two halves converge; eliminating those entirely needs a deeper LB restructure — out of scope.)
 */
function earlyLbRematches(n: number, rand: () => number, earlyRounds: number): number {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const matches = generateDoubleElim('t', ids);
  const players = new Map<string, string[]>();
  for (const m of matches)
    players.set(
      m.id,
      m.bracket_side === 'WINNERS' && m.round === 1
        ? [m.player1_id, m.player2_id].filter((x): x is string => x != null)
        : [],
    );
  const lbRoundNums = matches.filter((m) => m.bracket_side === 'LOSERS').map((m) => m.round);
  const firstLbRound = Math.min(...lbRoundNums);

  const met = new Map<string, number>();
  const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let early = 0;

  const ordered = [...matches].sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  for (const m of ordered) {
    const ps = players.get(m.id) ?? [];
    let winner: string | null;
    let loser: string | null = null;
    if (ps.length >= 2) {
      const [x, y] = [ps[0]!, ps[1]!];
      const prior = met.get(pk(x, y)) ?? 0;
      met.set(pk(x, y), prior + 1);
      if (prior >= 1 && m.bracket_side === 'LOSERS' && m.round - firstLbRound < earlyRounds) early++;
      winner = rand() < 0.5 ? x : y;
      loser = winner === x ? y : x;
    } else if (ps.length === 1) winner = ps[0]!;
    else continue;
    if (winner && m.next_match_id) players.get(m.next_match_id)?.push(winner);
    if (loser && m.loser_next_match_id) players.get(m.loser_next_match_id)?.push(loser);
  }
  return early;
}

describe('Double Elimination — Loser Bracket rematch avoidance (cross-seed)', () => {
  const SIZES = [8, 16, 23, 32, 48, 64];
  const RUNS = 500;

  it('never produces a Winners-Bracket rematch in the first two Loser-Bracket rounds', () => {
    for (const n of SIZES) {
      let early = 0;
      for (let s = 0; s < RUNS; s++) early += earlyLbRematches(n, rng(n * 100003 + s), 2);
      expect(
        early,
        `field of ${n}: ${early} early-LB (round 1-2) WB rematches across ${RUNS} playthroughs`,
      ).toBe(0);
    }
  });
});
