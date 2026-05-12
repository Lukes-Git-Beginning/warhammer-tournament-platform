import { describe, expect, it } from 'vitest';
import { generateRoundRobin } from '../src/lib/round-robin.js';

const T_ID = 'cccccccc-0000-0000-0000-000000000001';

function fakeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  );
}

describe('generateRoundRobin — 4 players', () => {
  it('single RR → 3 rounds, 6 matches', () => {
    const ids = fakeIds(4);
    const matches = generateRoundRobin(T_ID, ids, false);

    const rounds = Math.max(...matches.map((m) => m.round));
    expect(rounds).toBe(3);
    expect(matches).toHaveLength(6);
  });

  it('every pair plays exactly once', () => {
    const ids = fakeIds(4);
    const matches = generateRoundRobin(T_ID, ids, false);

    const pairs = matches
      .filter((m) => m.player1_id && m.player2_id)
      .map((m) => [m.player1_id!, m.player2_id!].sort().join('|'));

    const pairSet = new Set(pairs);
    // C(4,2)=6 unique pairs
    expect(pairSet.size).toBe(6);
  });

  it('no BYEs for even player count', () => {
    const ids = fakeIds(4);
    const matches = generateRoundRobin(T_ID, ids, false);
    expect(matches.filter((m) => m.status === 'BYE')).toHaveLength(0);
  });
});

describe('generateRoundRobin — 4 players DRR', () => {
  it('double RR → 6 rounds, 12 matches', () => {
    const ids = fakeIds(4);
    const matches = generateRoundRobin(T_ID, ids, true);

    const rounds = Math.max(...matches.map((m) => m.round));
    expect(rounds).toBe(6);
    expect(matches).toHaveLength(12);
  });

  it('each pair plays exactly twice (home+away swapped)', () => {
    const ids = fakeIds(4);
    const matches = generateRoundRobin(T_ID, ids, true);

    const realMatches = matches.filter((m) => m.player1_id && m.player2_id);
    const pairCounts = new Map<string, number>();
    for (const m of realMatches) {
      const key = [m.player1_id!, m.player2_id!].sort().join('|');
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    for (const count of pairCounts.values()) {
      expect(count).toBe(2);
    }
  });
});

describe('generateRoundRobin — 5 players (odd)', () => {
  it('5 players RR → 5 rounds', () => {
    const ids = fakeIds(5);
    const matches = generateRoundRobin(T_ID, ids, false);

    const rounds = Math.max(...matches.map((m) => m.round));
    expect(rounds).toBe(5);
  });

  it('exactly 1 BYE per round', () => {
    const ids = fakeIds(5);
    const matches = generateRoundRobin(T_ID, ids, false);

    const roundNums = [...new Set(matches.map((m) => m.round))];
    for (const r of roundNums) {
      const byesInRound = matches.filter((m) => m.round === r && m.status === 'BYE');
      expect(byesInRound).toHaveLength(1);
    }
  });

  it('BYE match has winner_id set and exactly one player slot occupied', () => {
    const ids = fakeIds(5);
    const matches = generateRoundRobin(T_ID, ids, false);

    for (const bye of matches.filter((m) => m.status === 'BYE')) {
      expect(bye.winner_id).not.toBeNull();
      // Exactly one of the two slots is occupied (the library may put the bye
      // player in either slot depending on the round)
      const occupied = (bye.player1_id !== null ? 1 : 0) + (bye.player2_id !== null ? 1 : 0);
      expect(occupied).toBe(1);
    }
  });

  it('all next_match_ids are null', () => {
    const ids = fakeIds(5);
    const matches = generateRoundRobin(T_ID, ids, false);

    for (const m of matches) {
      expect(m.next_match_id).toBeNull();
    }
  });
});

describe('generateRoundRobin — general', () => {
  it('all match IDs are unique', () => {
    const ids = fakeIds(6);
    const matches = generateRoundRobin(T_ID, ids, false);
    const idSet = new Set(matches.map((m) => m.id));
    expect(idSet.size).toBe(matches.length);
  });

  it('matches sorted by (round, match_number)', () => {
    const ids = fakeIds(6);
    const matches = generateRoundRobin(T_ID, ids, false);

    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1]!;
      const curr = matches[i]!;
      expect(prev.round * 10000 + prev.match_number).toBeLessThanOrEqual(
        curr.round * 10000 + curr.match_number,
      );
    }
  });
});
