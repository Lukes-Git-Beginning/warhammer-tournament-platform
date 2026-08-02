import { describe, it, expect } from 'vitest';
import {
  planPairings,
  formDivisionPools,
  divisionPlayoffFormat,
  type BalancedParticipant,
  type BalancedMatchRow,
  type RankedPlayer,
} from '../src/lib/balanced-liechtenstein.js';

const R = (userId: string, band: number, rank: number, rawScore = 100 - rank): RankedPlayer => ({
  userId,
  band,
  rank,
  rawScore,
});

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

describe('planPairings — #36 abundance de-hold', () => {
  it('commits free-free pairs instead of holding everyone when many same-band players are still incoming', () => {
    // 4 free b3 (two completed R1 matches) + 6 incoming b3 (three ongoing R1 matches). The old
    // engine held all four free players (tie-break bonus 30−5p is minimised by committing
    // nothing → they idled). The cost-neutral de-hold must commit the two clean (Δ0, non-
    // rematch) free-free pairs instead.
    const participants = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => P(id, 3));
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'), // a, b → free for R2
      done(1, 'c', 'd', 'c'), // c, d → free for R2
      ongoing(1, 'e', 'f'), // e, f → incoming to R2
      ongoing(1, 'g', 'h'), // g, h → incoming to R2
      ongoing(1, 'i', 'j'), // i, j → incoming to R2
    ];
    const plan = planPairings(participants, matches, 3);
    const r2 = plan.pairings.filter((p) => p.round === 2);
    expect(r2).toHaveLength(2); // was 0 before the fix
    const freeSet = new Set(['a', 'b', 'c', 'd']);
    for (const p of r2) {
      expect(freeSet.has(p.player1_id) && freeSet.has(p.player2_id)).toBe(true);
      const pair = new Set([p.player1_id, p.player2_id]);
      expect(pair).not.toEqual(new Set(['a', 'b'])); // no forced immediate rematch
      expect(pair).not.toEqual(new Set(['c', 'd']));
    }
    expect(plan.byes.filter((b) => b.round === 2)).toHaveLength(0); // nobody stranded
  });

  it('still HOLDS a lone off-band free player for a closer incoming one (scarcity, not abundance)', () => {
    // Free b2 + b4 (from two completed R1 matches), incoming b2 + b4 still playing. Committing
    // the two free players together would be a Δ2 stomp; the de-hold must NOT do it — each waits
    // for their same-band incoming partner. So no R2 pairing is committed yet.
    const participants = [P('a', 2), P('b', 4), P('x1', 2), P('x2', 2), P('y1', 4), P('y2', 4)];
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'), // a(b2), b(b4) → free (their only free partner is each other = Δ2)
      ongoing(1, 'x1', 'x2'), // incoming b2
      ongoing(1, 'y1', 'y2'), // incoming b4
    ];
    const plan = planPairings(participants, matches, 3);
    const r2 = plan.pairings.filter((p) => p.round === 2);
    // a×b (Δ2) must NOT be committed — held for the incoming same-band partners.
    for (const p of r2) {
      const pair = new Set([p.player1_id, p.player2_id]);
      expect(pair).not.toEqual(new Set(['a', 'b']));
    }
  });
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

describe('planPairings — late joiner (CATCHUP_BYE)', () => {
  it('places a late joiner with CATCHUP_BYE placeholders at frontier depth, no bye-flood', () => {
    // x advanced through rounds 1-2 (byes); the late joiner was folded in with two
    // 0-point CATCHUP_BYE placeholders → both sit at depth 2 → paired in round 3.
    const matches: BalancedMatchRow[] = [
      { round: 1, player1_id: 'x', player2_id: null, status: 'BYE' },
      { round: 2, player1_id: 'x', player2_id: null, status: 'BYE' },
      { round: 1, player1_id: 'late', player2_id: null, status: 'CATCHUP_BYE' },
      { round: 2, player1_id: 'late', player2_id: null, status: 'CATCHUP_BYE' },
    ];
    const plan = planPairings([P('x', 3), P('late', 3)], matches, 3);
    expect(plan.byes).toHaveLength(0);
    expect(plan.pairings).toHaveLength(1);
    expect(plan.pairings[0]!.round).toBe(3);
    expect([plan.pairings[0]!.player1_id, plan.pairings[0]!.player2_id].sort()).toEqual(['late', 'x']);
  });

  it('CATCHUP_BYE counts toward completeness (late joiner complete at rounds_count)', () => {
    const matches: BalancedMatchRow[] = [
      { round: 1, player1_id: 'late', player2_id: null, status: 'CATCHUP_BYE' },
      { round: 2, player1_id: 'late', player2_id: null, status: 'CATCHUP_BYE' },
      { round: 1, player1_id: 'x', player2_id: null, status: 'BYE' },
      { round: 2, player1_id: 'x', player2_id: null, status: 'BYE' },
      { round: 3, player1_id: 'late', player2_id: 'x', status: 'COMPLETED' },
    ];
    const plan = planPairings([P('late', 3), P('x', 3)], matches, 3);
    expect(plan.complete).toBe(true);
    expect(plan.pairings).toHaveLength(0);
    expect(plan.byes).toHaveLength(0);
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

  it('replays two rematch-locked leftovers instead of bye-ing them when no one else is due (#3)', () => {
    // Only a,b remain and they already met in round 1. Rather than sit BOTH out across
    // ticks (bye one now, the other next), they replay each other — an immediate
    // rematch as a last resort beats a double bye.
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a')];
    const plan = planPairings([P('a', 3), P('b', 3)], matches, 3);
    expect(plan.byes).toHaveLength(0);
    expect(plan.pairings).toHaveLength(1);
    expect(new Set([plan.pairings[0]!.player1_id, plan.pairings[0]!.player2_id])).toEqual(new Set(['a', 'b']));
    expect(plan.pairings[0]!.round).toBe(2);
  });

  it('pairs everyone globally instead of stranding a rematch-locked pair (#18)', () => {
    // Round 1: a-b, c-d, e-f all played, so for round 2 those three pairs are immediate
    // rematches. A greedy pass would take a-c + b-d and strand e+f (a rematch) into a
    // bye; the global (Blossom) matching finds a-c / b-e / d-f — all fresh, nobody
    // stranded. This is the Ponti case from trial-by-fire.
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => P(id, 2));
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'),
      done(1, 'c', 'd', 'c'),
      done(1, 'e', 'f', 'e'),
    ];
    const plan = planPairings(players, matches, 3);
    expect(plan.byes).toHaveLength(0);
    expect(plan.pairings).toHaveLength(3);
    // No round-2 pairing repeats a round-1 opponent.
    const r1 = new Set(['a|b', 'c|d', 'e|f']);
    for (const p of plan.pairings) {
      const key = [p.player1_id, p.player2_id].sort().join('|');
      expect(r1.has(key)).toBe(false);
    }
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

describe('planPairings — eventual rematch vs playing up', () => {
  // History helpers: a,b (New) met in round 1, then each played up in round 2, so by
  // round 3 they are an *eventual* (not immediate) rematch of each other.
  const pairSet = (pl: { player1_id: string; player2_id: string }) =>
    new Set([pl.player1_id, pl.player2_id]);

  it('prefers a fresh one-band play-up over replaying an earlier opponent', () => {
    // Round 3 pool {a,b,c}: a↔b met in round 1 (eventual rematch, cost 1.5); c is a
    // fresh Beginner one band up (cost 1). The cheaper fresh play-up must win.
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'),
      done(1, 'c', null, 'c'),
      done(2, 'a', 'c', 'a'),
      done(2, 'b', null, 'b'),
    ];
    const plan = planPairings([P('a', 1), P('b', 1), P('c', 2)], matches, 3);
    expect(plan.pairings).toHaveLength(1);
    expect(pairSet(plan.pairings[0]!)).toEqual(new Set(['b', 'c'])); // fresh gap-1
    expect(pairSet(plan.pairings[0]!)).not.toEqual(new Set(['a', 'b'])); // not the repeat
  });

  it('prefers replaying an earlier opponent over a two-band play-up', () => {
    // Round 3 pool {a,b,d}: a↔b eventual rematch (cost 1.5); the only fresh option for
    // b is d, two bands up (cost 2). The repeat is now the cheaper, better game.
    const matches: BalancedMatchRow[] = [
      done(1, 'a', 'b', 'a'),
      done(1, 'd', null, 'd'),
      done(2, 'a', 'd', 'a'),
      done(2, 'b', null, 'b'),
    ];
    const plan = planPairings([P('a', 1), P('b', 1), P('d', 3)], matches, 3);
    expect(plan.pairings).toHaveLength(1);
    expect(pairSet(plan.pairings[0]!)).toEqual(new Set(['a', 'b'])); // the eventual rematch
    expect(plan.byes.map((x) => x.player_id)).toEqual(['d']);
  });

  it('still blocks an immediate rematch outright, even to avoid a three-band jump', () => {
    // a,b just played each other (round 1); r is idle after a bye. An immediate
    // rematch is forbidden, so one New plays up to Advanced rather than replay.
    const matches: BalancedMatchRow[] = [done(1, 'a', 'b', 'a'), done(1, 'r', null, 'r')];
    const plan = planPairings([P('a', 1), P('b', 1), P('r', 4)], matches, 3);
    expect(plan.pairings).toHaveLength(1);
    expect(pairSet(plan.pairings[0]!)).not.toEqual(new Set(['a', 'b'])); // no immediate rematch
    expect(pairSet(plan.pairings[0]!).has('r')).toBe(true); // the play-up happened
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
    const pools = formDivisionPools(players, 5);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.band).toBe(3);
    expect(pools[0]!.players).toHaveLength(8);
    expect(pools[0]!.finalists).toEqual(['p1', 'p2']);
  });

  it('borrows the best of the level below to fill a short top level', () => {
    // 3 level-5 (best ranks) + 5 level-3 → level5 pool = 3 own + best level-3.
    const players = [R('a', 5, 1), R('b', 5, 2), R('c', 5, 3), R('d', 3, 4), R('e', 3, 5), R('f', 3, 6), R('g', 3, 7), R('h', 3, 8)];
    const pools = formDivisionPools(players, 5);
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
    const pools = formDivisionPools(players, 5);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.players).toHaveLength(6);
    expect(pools[0]!.finalists).toEqual(['a', 'b']);
  });

  it('fills to the target pool size when the host chose a larger playoff', () => {
    // TOP4 → target 8: a short top band borrows down to 8 instead of the floor of 4.
    // 9 band-3 players so the 4 left after borrowing still form their own viable pool.
    const players = [
      R('a', 5, 1), R('b', 5, 2), R('c', 5, 3),
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((r) => R(`i${r}`, 3, r)),
    ];
    const pools = formDivisionPools(players, 5, 8);
    const top = pools.find((p) => p.band === 5)!;
    expect(top.players).toHaveLength(8); // 3 own + 5 borrowed
    expect(pools.find((p) => p.band === 3)!.players).toHaveLength(4); // remainder stands alone
  });

  it('handles a tiny field (single pool, whatever its size)', () => {
    const pools = formDivisionPools([R('a', 3, 1), R('b', 3, 2), R('c', 3, 3)], 5);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.finalists).toEqual(['a', 'b']);
  });

  // BaLi 2.0: no seat-1 own-band reservation — the handicap-adjusted score decides.
  it('seeds a merged pool by handicap-adjusted score, not raw cross-band record', () => {
    // Pool band 4 borrows two band-3 players. Handicap at 5 rounds = 1.0 per band.
    //  adv1 5-0 → 5.0 ; int1 5-0 → 4.0 ; int2 4-1 → 3.0 ; adv2 2-3 → 2.0.
    // A dominant borrowed 5-0 (int1) outseeds a weak own-band 2-3 (adv2), but stays
    // behind the own-band 5-0 (adv1). No artificial own-band seat 1.
    const players = [R('adv1', 4, 1, 5), R('int1', 3, 2, 5), R('int2', 3, 3, 4), R('adv2', 4, 6, 2)];
    const pools = formDivisionPools(players, 5);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.band).toBe(4);
    expect(pools[0]!.seeds).toEqual(['adv1', 'int1', 'int2', 'adv2']);
    expect(pools[0]!.finalists).toEqual(['adv1', 'int1']);
  });

  it('does NOT head the bracket with a lone 0-5 top-band player (the edge that killed seat-1)', () => {
    // adv1 is the only band-4 player and went 0-5; the pool borrows three strong band-3
    // players. adv1 must sink to the bottom seed, not be reserved seat 1.
    const players = [R('int1', 3, 1, 5), R('int2', 3, 2, 4), R('int3', 3, 3, 4), R('adv1', 4, 8, 0)];
    const pools = formDivisionPools(players, 5);
    expect(pools[0]!.band).toBe(4);
    expect(pools[0]!.seeds[0]).toBe('int1');
    expect(pools[0]!.seeds.at(-1)).toBe('adv1');
    expect(pools[0]!.finalists).toEqual(['int1', 'int2']);
  });

  it('a pure single-band pool seeds strictly by score then rank', () => {
    const players = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => R(`p${r}`, 3, r));
    const pools = formDivisionPools(players, 5);
    expect(pools[0]!.seeds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  });
});

describe('divisionPlayoffFormat', () => {
  it('maps division size to bracket format (thresholds 4 / 8 / 16)', () => {
    expect(divisionPlayoffFormat(4)).toBe('TOP2');
    expect(divisionPlayoffFormat(7)).toBe('TOP2');
    expect(divisionPlayoffFormat(8)).toBe('TOP4');
    expect(divisionPlayoffFormat(15)).toBe('TOP4');
    expect(divisionPlayoffFormat(16)).toBe('TOP8');
    expect(divisionPlayoffFormat(20)).toBe('TOP8');
  });
});
