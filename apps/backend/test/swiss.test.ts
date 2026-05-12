import { describe, expect, it } from 'vitest';
import {
  generateSwissRound,
  computeSwissStandings,
  recommendNumberOfRounds,
  type SwissPlayer,
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

// ---------- computeSwissStandings ----------

describe('computeSwissStandings', () => {
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
