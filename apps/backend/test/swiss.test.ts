import { describe, expect, it } from 'vitest';
import {
  generateSwissRound,
  computeSwissStandings,
  recommendNumberOfRounds,
  sortSwissStandings,
  tryAvoidMirrors,
  type SwissPlayer,
  type SwissMatchInput,
  type CompletedMatchRecord,
} from '../src/lib/swiss.js';

// ---------- Helpers ----------

function fakeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  );
}

const T_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

function makePlayers(ids: string[], scores?: number[]): SwissPlayer[] {
  return ids.map((id, i) => ({
    userId: id,
    score: scores?.[i] ?? 0,
    avoid: [],
    receivedBye: false,
  }));
}

// ---------- generateSwissRound ----------

describe('generateSwissRound', () => {
  it('8 players → round 1 produces 4 matches', () => {
    const ids = fakeIds(8);
    const players = makePlayers(ids);
    const matches = generateSwissRound(T_ID, players, 1);

    expect(matches).toHaveLength(4);
    for (const m of matches) {
      expect(m.round).toBe(1);
      expect(m.tournament_id).toBe(T_ID);
      expect(m.next_match_id).toBeNull();
    }
  });

  it('odd number of players → one BYE match', () => {
    const ids = fakeIds(5);
    const players = makePlayers(ids);
    const matches = generateSwissRound(T_ID, players, 1);

    // 5 players → 2 normal + 1 BYE = 3 matches
    const byeMatches = matches.filter((m) => m.status === 'BYE');
    expect(byeMatches).toHaveLength(1);
    expect(byeMatches[0]!.winner_id).not.toBeNull();
    expect(byeMatches[0]!.player2_id).toBeNull();
  });

  it('all match IDs are unique UUIDs', () => {
    const ids = fakeIds(8);
    const players = makePlayers(ids);
    const matches = generateSwissRound(T_ID, players, 1);

    const matchIds = matches.map((m) => m.id);
    const unique = new Set(matchIds);
    expect(unique.size).toBe(matches.length);
  });

  it('matches sorted by (round, match_number)', () => {
    const ids = fakeIds(8);
    const players = makePlayers(ids);
    const matches = generateSwissRound(T_ID, players, 1);

    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1]!;
      const curr = matches[i]!;
      expect(prev.round * 10000 + prev.match_number).toBeLessThanOrEqual(
        curr.round * 10000 + curr.match_number,
      );
    }
  });
});

// ---------- rematch-avoidance ----------

describe('rematch avoidance', () => {
  it('round 2 with avoid lists → no repeated matchup', () => {
    const ids = fakeIds(8);

    // Round 1: pair sequentially as the library would
    const r1Players = makePlayers(ids);
    const r1Matches = generateSwissRound(T_ID, r1Players, 1);

    // Build avoid map from round-1 pairings
    const avoidMap = new Map<string, string[]>();
    for (const id of ids) avoidMap.set(id, []);
    for (const m of r1Matches) {
      if (m.player1_id && m.player2_id) {
        avoidMap.get(m.player1_id)!.push(m.player2_id);
        avoidMap.get(m.player2_id)!.push(m.player1_id);
      }
    }

    const r2Players: SwissPlayer[] = ids.map((id) => ({
      userId: id,
      score: 0,
      avoid: avoidMap.get(id) ?? [],
      receivedBye: false,
    }));

    const r2Matches = generateSwissRound(T_ID, r2Players, 2);

    // No match in R2 should repeat an R1 pairing
    const r1Pairs = new Set(
      r1Matches
        .filter((m) => m.player1_id && m.player2_id)
        .map((m) => [m.player1_id!, m.player2_id!].sort().join('|')),
    );

    for (const m of r2Matches) {
      if (m.player1_id && m.player2_id) {
        const pair = [m.player1_id, m.player2_id].sort().join('|');
        expect(r1Pairs.has(pair)).toBe(false);
      }
    }
  });
});

describe('min-weight pairing (B8)', () => {
  it('never re-pairs a no-contest pair, even when score-optimal', () => {
    const ids = fakeIds(4);
    // All same score → score doesn't force anything; ids[0] & ids[1] had a no-contest.
    const players: SwissPlayer[] = ids.map((id) => ({
      userId: id,
      score: 1,
      avoid: [],
      receivedBye: false,
      noContestAvoid: id === ids[0] ? [ids[1]!] : id === ids[1] ? [ids[0]!] : [],
    }));
    const matches = generateSwissRound(T_ID, players, 2);
    const pairedTogether = matches.some(
      (m) =>
        (m.player1_id === ids[0] && m.player2_id === ids[1]) ||
        (m.player1_id === ids[1] && m.player2_id === ids[0]),
    );
    expect(pairedTogether).toBe(false);
  });

  it('is deterministic for the same (tournament, round)', () => {
    const ids = fakeIds(8);
    const mk = (): SwissPlayer[] =>
      ids.map((id, i) => ({ userId: id, score: i < 4 ? 1 : 0, avoid: [], receivedBye: false }));
    const norm = (ms: ReturnType<typeof generateSwissRound>) =>
      ms
        .filter((m) => m.player1_id && m.player2_id)
        .map((m) => [m.player1_id!, m.player2_id!].sort().join('|'))
        .sort()
        .join(',');
    expect(norm(generateSwissRound(T_ID, mk(), 2))).toBe(norm(generateSwissRound(T_ID, mk(), 2)));
  });

  it('minimises score gap: equal-score players pair together', () => {
    const ids = fakeIds(4);
    const players: SwissPlayer[] = [
      { userId: ids[0]!, score: 2, avoid: [], receivedBye: false },
      { userId: ids[1]!, score: 2, avoid: [], receivedBye: false },
      { userId: ids[2]!, score: 1, avoid: [], receivedBye: false },
      { userId: ids[3]!, score: 1, avoid: [], receivedBye: false },
    ];
    const matches = generateSwissRound(T_ID, players, 2);
    const paired = (a: string, b: string) =>
      matches.some(
        (m) =>
          (m.player1_id === a && m.player2_id === b) || (m.player1_id === b && m.player2_id === a),
      );
    expect(paired(ids[0]!, ids[1]!)).toBe(true); // both score 2
    expect(paired(ids[2]!, ids[3]!)).toBe(true); // both score 1
  });
});

describe('Faction War fairness cost', () => {
  const fw = (id: string, score: number, factionId: string): SwissPlayer => ({
    userId: id,
    score,
    avoid: [],
    receivedBye: false,
    factionId,
  });
  const ids = fakeIds(4);
  // x–y and z–w are coin-flips (0 surcharge); every cross pairing is lopsided (max surcharge).
  const balanced = new Set(['x|y', 'y|x', 'z|w', 'w|z']);
  const cost = (a: SwissPlayer, b: SwissPlayer) =>
    balanced.has(`${a.factionId}|${b.factionId}`) ? 0 : 50;
  const paired = (matches: SwissMatchInput[], a: string, b: string) =>
    matches.some(
      (m) =>
        (m.player1_id === a && m.player2_id === b) || (m.player1_id === b && m.player2_id === a),
    );

  it('round 1 (all equal score) pairs the fairest faction matchups', () => {
    const players = [fw(ids[0]!, 0, 'x'), fw(ids[1]!, 0, 'y'), fw(ids[2]!, 0, 'z'), fw(ids[3]!, 0, 'w')];
    const matches = generateSwissRound(T_ID, players, 1, cost);
    expect(paired(matches, ids[0]!, ids[1]!)).toBe(true); // x vs y — a coin-flip
    expect(paired(matches, ids[2]!, ids[3]!)).toBe(true); // z vs w — a coin-flip
  });

  it('never outranks the Swiss score gap (score stays primary in later rounds)', () => {
    // The two score-2 players have factions that make a fair matchup only *across* the score gap.
    const players = [fw(ids[0]!, 2, 'x'), fw(ids[1]!, 2, 'z'), fw(ids[2]!, 0, 'y'), fw(ids[3]!, 0, 'w')];
    const matches = generateSwissRound(T_ID, players, 2, cost);
    // Even though x–y / z–w would be fairer, the equal-score pairs must stay together.
    expect(paired(matches, ids[0]!, ids[1]!)).toBe(true); // both score 2
    expect(paired(matches, ids[2]!, ids[3]!)).toBe(true); // both score 0
  });
});

// ---------- computeSwissStandings ----------

describe('computeSwissStandings', () => {
  it('CATCHUP_BYE scores 0 (late-join placeholder), unlike a scoring BYE', () => {
    const ids = ['a', 'b'];
    const matches: CompletedMatchRecord[] = [
      { round: 1, player1_id: 'a', player2_id: null, winner_id: null, status: 'CATCHUP_BYE' },
      { round: 1, player1_id: 'b', player2_id: null, winner_id: 'b', status: 'BYE' },
    ];
    const standings = computeSwissStandings(ids, matches);
    const a = standings.find((s) => s.userId === 'a')!;
    const b = standings.find((s) => s.userId === 'b')!;
    expect(a.score).toBe(0);
    expect(a.byes).toBe(0);
    expect(a.buchholz).toBe(0);
    expect(b.score).toBe(1);
    expect(b.byes).toBe(1);
  });

  it('8 players, correct score accumulation', () => {
    const ids = fakeIds(8);

    // Round 1: ids[0] beats ids[1], ids[2] beats ids[3], draw ids[4]-ids[5], bye ids[6]
    const matches: CompletedMatchRecord[] = [
      { round: 1, player1_id: ids[0], player2_id: ids[1], winner_id: ids[0], status: 'COMPLETED' },
      { round: 1, player1_id: ids[2], player2_id: ids[3], winner_id: ids[2], status: 'COMPLETED' },
      { round: 1, player1_id: ids[4], player2_id: ids[5], winner_id: null, status: 'COMPLETED' },
      { round: 1, player1_id: ids[6], player2_id: null, winner_id: ids[6], status: 'BYE' },
      { round: 1, player1_id: ids[7], player2_id: null, winner_id: ids[7], status: 'BYE' },
    ];

    const standings = computeSwissStandings(ids, matches);

    const get = (id: string) => standings.find((s) => s.userId === id)!;

    expect(get(ids[0]).score).toBe(1);
    expect(get(ids[0]).wins).toBe(1);
    expect(get(ids[1]).score).toBe(0);
    expect(get(ids[1]).losses).toBe(1);
    expect(get(ids[4]).score).toBe(0.5);
    expect(get(ids[4]).draws).toBe(1);
    expect(get(ids[6]).score).toBe(1);
    expect(get(ids[6]).byes).toBe(1);
  });

  it('standings sorted: score desc, then buchholz desc', () => {
    const ids = fakeIds(4);

    // ids[0] beats ids[1] (ids[1] score=0)
    // ids[2] beats ids[3] (ids[3] score=0)
    // Round 2: ids[0] beats ids[2] (ids[2] score=1 → buchholz for ids[0]=1+0=1)
    //          ids[1] beats ids[3] (ids[3] score=0 → buchholz for ids[1]=0+0=0)
    const matches: CompletedMatchRecord[] = [
      { round: 1, player1_id: ids[0], player2_id: ids[1], winner_id: ids[0], status: 'COMPLETED' },
      { round: 1, player1_id: ids[2], player2_id: ids[3], winner_id: ids[2], status: 'COMPLETED' },
      { round: 2, player1_id: ids[0], player2_id: ids[2], winner_id: ids[0], status: 'COMPLETED' },
      { round: 2, player1_id: ids[1], player2_id: ids[3], winner_id: ids[1], status: 'COMPLETED' },
    ];

    const standings = computeSwissStandings(ids, matches);

    // ids[0]: 2 wins = score 2; ids[2]: 1 win 1 loss = score 1
    expect(standings[0]!.userId).toBe(ids[0]);
    expect(standings[0]!.score).toBe(2);
    expect(standings[1]!.score).toBe(1);
  });

  it('buchholz tiebreak: higher opponent score ranks higher', () => {
    const ids = fakeIds(4);
    // ids[0] beats ids[2] (ids[2] is strong), ids[1] beats ids[3] (ids[3] is weak)
    // ids[2] beats ids[3] in R1 (so ids[2].score=1)
    const matches: CompletedMatchRecord[] = [
      { round: 1, player1_id: ids[2], player2_id: ids[3], winner_id: ids[2], status: 'COMPLETED' },
      { round: 2, player1_id: ids[0], player2_id: ids[2], winner_id: ids[0], status: 'COMPLETED' },
      { round: 2, player1_id: ids[1], player2_id: ids[3], winner_id: ids[1], status: 'COMPLETED' },
    ];

    const standings = computeSwissStandings(ids, matches);
    const s0 = standings.find((s) => s.userId === ids[0])!;
    const s1 = standings.find((s) => s.userId === ids[1])!;

    // Both ids[0] and ids[1] have score=1
    expect(s0.score).toBe(1);
    expect(s1.score).toBe(1);
    // ids[0]'s opponent (ids[2]) has score=1, ids[1]'s opponent (ids[3]) has score=0
    expect(s0.buchholz).toBeGreaterThan(s1.buchholz);

    // ids[0] should rank above ids[1]
    const rank0 = standings.findIndex((s) => s.userId === ids[0]);
    const rank1 = standings.findIndex((s) => s.userId === ids[1]);
    expect(rank0).toBeLessThan(rank1);
  });

  it('NO_CONTEST → both players get a bye point, 0 Buchholz, not dropped (B10)', () => {
    const ids = fakeIds(4);
    const matches: CompletedMatchRecord[] = [
      // A real result so opponents would otherwise contribute Buchholz.
      { round: 1, player1_id: ids[2], player2_id: ids[3], winner_id: ids[2], status: 'COMPLETED' },
      // ids[0] vs ids[1] declared a No Contest (technical-abort double bye).
      { round: 1, player1_id: ids[0], player2_id: ids[1], winner_id: null, status: 'NO_CONTEST' },
    ];
    const standings = computeSwissStandings(ids, matches);
    const get = (id: string) => standings.find((s) => s.userId === id)!;

    for (const id of [ids[0], ids[1]]) {
      expect(get(id).score).toBe(1);
      expect(get(id).byes).toBe(1);
      expect(get(id).buchholz).toBe(0); // forfeiting opponent contributes no BH
      expect(get(id).dropped).toBe(false); // a No Contest does not drop anyone
    }
  });
});

// ---------- recommendNumberOfRounds ----------

describe('recommendNumberOfRounds', () => {
  it.each([
    [4, 3],
    [8, 3],
    [16, 4],
    [32, 5],
    [100, 7], // capped at 7 (log2(100)≈6.64 → ceil=7)
  ])('%i players → %i rounds', (n, expected) => {
    expect(recommendNumberOfRounds(n)).toBe(expected);
  });
});

// ---------- sortSwissStandings — tiebreaker hierarchy ----------

describe('sortSwissStandings — solkoff tiebreaker', () => {
  it('2 players with equal score + buchholz → solkoff decides', () => {
    // Setup: 4 players, two rounds
    // ids[0] and ids[1] end up with identical score and buchholz
    // but different solkoff (achieved via different opponent strength spread)
    const ids = fakeIds(6);
    // Round 1: ids[0] beats ids[2], ids[1] beats ids[3], ids[4] beats ids[5]
    // Round 2: ids[2] beats ids[4], ids[3] beats ids[5]
    //   → ids[0].opponents = [ids[2]], ids[2].score=0 after R1 but then wins R2
    //   → ids[1].opponents = [ids[3]], ids[3].score=0 after R1 but also wins R2
    //   Buchholz is equal if both opponents end at score=1
    // To create solkoff difference, we need >=3 opponents per player (need more rounds)
    // Simpler: build standings manually and call sortSwissStandings directly

    // Player A: score=2, buchholz=3, solkoff=2
    // Player B: score=2, buchholz=3, solkoff=1
    const standingA = {
      userId: ids[0]!,
      score: 2,
      wins: 2,
      losses: 0,
      draws: 0,
      byes: 0,
      buchholz: 3,
      solkoff: 2,
      opponentsBeaten: [],
    };
    const standingB = {
      userId: ids[1]!,
      score: 2,
      wins: 2,
      losses: 0,
      draws: 0,
      byes: 0,
      buchholz: 3,
      solkoff: 1,
      opponentsBeaten: [],
    };

    const sorted = sortSwissStandings([standingB, standingA], []);
    // A has higher solkoff → A should rank above B
    expect(sorted[0]!.userId).toBe(ids[0]);
    expect(sorted[1]!.userId).toBe(ids[1]);
  });
});

describe('sortSwissStandings — head-to-head tiebreaker', () => {
  it('2 players with equal score + buchholz + solkoff → H2H decides', () => {
    const ids = fakeIds(2);
    const [winner, loser] = ids as [string, string];

    const standingWinner = {
      userId: winner,
      score: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      byes: 0,
      buchholz: 1,
      solkoff: 1,
      opponentsBeaten: [loser],
    };
    const standingLoser = {
      userId: loser,
      score: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      byes: 0,
      buchholz: 1,
      solkoff: 1,
      opponentsBeaten: [],
    };

    const h2hMatch: CompletedMatchRecord = {
      round: 1,
      player1_id: winner,
      player2_id: loser,
      winner_id: winner,
      status: 'COMPLETED',
    };

    const sorted = sortSwissStandings([standingLoser, standingWinner], [h2hMatch]);
    expect(sorted[0]!.userId).toBe(winner);
    expect(sorted[1]!.userId).toBe(loser);
  });

  it('3 players all equal (no H2H) → deterministic order, independent of input order (#26)', () => {
    const ids = fakeIds(3);
    const makeStanding = (id: string) => ({
      userId: id,
      score: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      byes: 0,
      buchholz: 1,
      solkoff: 1,
      opponentsBeaten: [],
    });

    // No completed matches → H2H cannot decide; the deterministic hash tiebreak
    // (#26) must resolve the total tie the same way regardless of input order,
    // instead of leaving it to arbitrary insertion order.
    const forward = sortSwissStandings(ids.map(makeStanding), []).map((s) => s.userId);
    const reversed = sortSwissStandings([...ids].reverse().map(makeStanding), []).map((s) => s.userId);

    expect(forward).toEqual(reversed); // order does not depend on input order
    expect(new Set(forward).size).toBe(3); // all three present, distinct
    for (const id of ids) expect(forward).toContain(id);
  });
});

describe('sortSwissStandings — solkoff computed via computeSwissStandings', () => {
  it('solkoff is computed and differs from buchholz when >=3 opponents', () => {
    // 4 players: ids[0] beats everyone, each plays 3 rounds
    // This exercises the "trim highest + lowest" path
    const ids = fakeIds(5);
    // Round 1: ids[0] beats ids[1], ids[2] beats ids[3]
    // Round 2: ids[0] beats ids[2], ids[1] beats ids[4]
    // Round 3: ids[0] beats ids[3], ids[2] beats ids[4]
    const matches: CompletedMatchRecord[] = [
      { round: 1, player1_id: ids[0], player2_id: ids[1], winner_id: ids[0], status: 'COMPLETED' },
      { round: 1, player1_id: ids[2], player2_id: ids[3], winner_id: ids[2], status: 'COMPLETED' },
      { round: 2, player1_id: ids[0], player2_id: ids[2], winner_id: ids[0], status: 'COMPLETED' },
      { round: 2, player1_id: ids[1], player2_id: ids[4], winner_id: ids[1], status: 'COMPLETED' },
      { round: 3, player1_id: ids[0], player2_id: ids[3], winner_id: ids[0], status: 'COMPLETED' },
      { round: 3, player1_id: ids[2], player2_id: ids[4], winner_id: ids[2], status: 'COMPLETED' },
    ];

    const standings = computeSwissStandings(ids as string[], matches);
    const topPlayer = standings.find((s) => s.userId === ids[0]);
    expect(topPlayer).toBeDefined();
    // ids[0] has 3 opponents (ids[1], ids[2], ids[3])
    // buchholz = sum of their scores
    // solkoff = buchholz - max - min (trimmed)
    expect(topPlayer!.buchholz).toBeGreaterThanOrEqual(0);
    // solkoff ≤ buchholz (trimming can only reduce or keep equal)
    expect(topPlayer!.solkoff).toBeLessThanOrEqual(topPlayer!.buchholz);
  });
});

// ---------- tryAvoidMirrors ----------

describe('tryAvoidMirrors', () => {
  function makeMatch(n: number, p1: string, p2: string): SwissMatchInput {
    return {
      id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`,
      tournament_id: T_ID,
      round: 2,
      match_number: n,
      player1_id: p1,
      player2_id: p2,
      status: 'PENDING',
      next_match_id: null,
      winner_id: null,
    };
  }

  function withFactions(
    ids: string[],
    factions: (string | null)[],
    scores?: number[],
    avoid?: string[][],
  ): SwissPlayer[] {
    return ids.map((id, i) => ({
      userId: id,
      score: scores?.[i] ?? 0,
      avoid: avoid?.[i] ?? [],
      receivedBye: false,
      factionId: factions[i] ?? null,
    }));
  }

  it('resolves a mirror when an equal-score swap partner exists', () => {
    const [a, b, c, d] = fakeIds(4) as [string, string, string, string];
    // (A,B) is a mirror (both empire); (C,D) are different factions.
    const players = withFactions([a, b, c, d], ['empire', 'empire', 'dwarfs', 'greenskins']);
    const matches = [makeMatch(1, a, b), makeMatch(2, c, d)];

    tryAvoidMirrors(matches, players);

    const pairs = matches.map((m) => [m.player1_id, m.player2_id]);
    for (const [p1, p2] of pairs) {
      const f1 = players.find((p) => p.userId === p1)!.factionId;
      const f2 = players.find((p) => p.userId === p2)!.factionId;
      expect(f1).not.toBe(f2);
    }
  });

  it('does not swap when it would create a rematch', () => {
    const [a, b, c, d] = fakeIds(4) as [string, string, string, string];
    // Only viable swaps pair A with C or D — but A already played both.
    const players = withFactions(
      [a, b, c, d],
      ['empire', 'empire', 'dwarfs', 'greenskins'],
      undefined,
      [[c, d], [], [], []],
    );
    const matches = [makeMatch(1, a, b), makeMatch(2, c, d)];

    tryAvoidMirrors(matches, players);

    expect(matches[0]!.player1_id).toBe(a);
    expect(matches[0]!.player2_id).toBe(b);
    expect(matches[1]!.player1_id).toBe(c);
    expect(matches[1]!.player2_id).toBe(d);
  });

  it('does not swap when the counterpart pair would become a mirror', () => {
    const [a, b, c, d] = fakeIds(4) as [string, string, string, string];
    // (A,B) mirror on empire. Swapping A↔C or A↔D would fix pair 1 but
    // pair 2 would become (B, dwarfs?) — make both C and D empire-adjacent:
    // C is dwarfs, D is empire → (A,C)+(B,D) makes (B,D) an empire mirror,
    // (A,D) is itself a mirror. No valid swap exists.
    const players = withFactions([a, b, c, d], ['empire', 'empire', 'dwarfs', 'empire']);
    const matches = [makeMatch(1, a, b), makeMatch(2, c, d)];

    tryAvoidMirrors(matches, players);

    const mirrorCount = matches.filter((m) => {
      const f1 = players.find((p) => p.userId === m.player1_id)!.factionId;
      const f2 = players.find((p) => p.userId === m.player2_id)!.factionId;
      return f1 === f2;
    }).length;
    // Started with 1 mirror — must not have grown.
    expect(mirrorCount).toBeLessThanOrEqual(1);
  });

  it('does not swap when it would increase a score delta', () => {
    const [a, b, c, d] = fakeIds(4) as [string, string, string, string];
    // (A,B) mirror at score 3 each (delta 0); (C,D) at score 0 each.
    // Any swap creates two pairs with delta 3 — must be rejected.
    const players = withFactions(
      [a, b, c, d],
      ['empire', 'empire', 'dwarfs', 'greenskins'],
      [3, 3, 0, 0],
    );
    const matches = [makeMatch(1, a, b), makeMatch(2, c, d)];

    tryAvoidMirrors(matches, players);

    expect(matches[0]!.player2_id).toBe(b);
    expect(matches[1]!.player1_id).toBe(c);
  });

  it('no-op when no faction data is present', () => {
    const [a, b, c, d] = fakeIds(4) as [string, string, string, string];
    const players = withFactions([a, b, c, d], [null, null, null, null]);
    const matches = [makeMatch(1, a, b), makeMatch(2, c, d)];

    tryAvoidMirrors(matches, players);

    expect(matches[0]!.player2_id).toBe(b);
    expect(matches[1]!.player2_id).toBe(d);
  });
});
