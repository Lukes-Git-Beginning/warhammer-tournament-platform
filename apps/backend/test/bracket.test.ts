import { describe, expect, it } from 'vitest';
import { generateSingleElim } from '../src/lib/bracket.js';

// Helper: build N fake participant UUIDs
function fakeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  );
}

const TOURNAMENT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('generateSingleElim', () => {
  it('4 players → 3 matches, correct round structure', () => {
    const ids = fakeIds(4);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    expect(matches).toHaveLength(3);

    const r1 = matches.filter((m) => m.round === 1);
    const r2 = matches.filter((m) => m.round === 2);
    expect(r1).toHaveLength(2);
    expect(r2).toHaveLength(1);

    // All R1 matches link to the single R2 match
    const finalId = r2[0]!.id;
    for (const m of r1) {
      expect(m.next_match_id).toBe(finalId);
    }

    // Final match has no next
    expect(r2[0]!.next_match_id).toBeNull();
  });

  it('4 players → all next_match_ids point to existing match ids', () => {
    const ids = fakeIds(4);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);
    const allIds = new Set(matches.map((m) => m.id));

    for (const m of matches) {
      if (m.next_match_id !== null) {
        expect(allIds.has(m.next_match_id)).toBe(true);
      }
    }
  });

  // Regression (2026-06-04): on non-pow2 fields the play-in target was
  // prematurely finalized as BYE, orphaning the play-in winner. A match with
  // one player whose free slot is fed by another match must stay PENDING.
  describe('non-pow2 fields — no premature BYE on feeder targets', () => {
    for (const n of [5, 6, 7, 9, 12]) {
      it(`${n} players → BYE only without unresolved feeders, all players placed once`, () => {
        const ids = fakeIds(n);
        const matches = generateSingleElim(TOURNAMENT_ID, ids);

        // Feeder structure from the generated graph itself.
        const feedersByTarget = new Map<string, typeof matches>();
        for (const m of matches) {
          if (m.next_match_id !== null) {
            const arr = feedersByTarget.get(m.next_match_id) ?? [];
            arr.push(m);
            feedersByTarget.set(m.next_match_id, arr);
          }
        }

        for (const m of matches) {
          const unresolved = (feedersByTarget.get(m.id) ?? []).filter(
            (f) => f.winner_id === null,
          ).length;
          const filled =
            (m.player1_id !== null ? 1 : 0) + (m.player2_id !== null ? 1 : 0);

          if (m.status === 'BYE') {
            // A BYE must have its winner set and no feeder still delivering.
            expect(m.winner_id).not.toBeNull();
            expect(unresolved).toBe(0);
          }
          if (filled === 1 && unresolved > 0) {
            // Half-filled match awaiting a play-in winner must stay open.
            expect(m.status).toBe('PENDING');
            expect(m.winner_id).toBeNull();
          }
        }

        // Every participant appears exactly once as an initially placed player.
        const placed = matches
          .flatMap((m) => [m.player1_id, m.player2_id])
          .filter((id): id is string => id !== null);
        // BYE propagation duplicates winners into later rounds — count uniques.
        expect(new Set(placed).size).toBe(n);
        for (const id of ids) {
          expect(placed).toContain(id);
        }
      });
    }
  });

  it('8 players → 7 matches, 3 rounds', () => {
    const ids = fakeIds(8);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    expect(matches).toHaveLength(7);
    const maxRound = Math.max(...matches.map((m) => m.round));
    expect(maxRound).toBe(3);

    // Round counts: R1=4, R2=2, R3=1
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(matches.filter((m) => m.round === 3)).toHaveLength(1);
  });

  it('16 players → 15 matches, 4 rounds', () => {
    const ids = fakeIds(16);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    expect(matches).toHaveLength(15);
    const maxRound = Math.max(...matches.map((m) => m.round));
    expect(maxRound).toBe(4);
  });

  it('17 players → no cycles in next_match_id chain', () => {
    const ids = fakeIds(17);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    // Build adjacency for next_match_id
    const nextMap = new Map<string, string | null>();
    for (const m of matches) {
      nextMap.set(m.id, m.next_match_id);
    }

    // Walk from every match: should reach null within matches.length steps
    for (const startMatch of matches) {
      const visited = new Set<string>();
      let cur: string | null = startMatch.id;
      while (cur !== null) {
        expect(visited.has(cur)).toBe(false); // no cycle
        visited.add(cur);
        cur = nextMap.get(cur) ?? null;
      }
    }
  });

  it('17 players → no next_match_id points to a non-existent id', () => {
    const ids = fakeIds(17);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);
    const allIds = new Set(matches.map((m) => m.id));

    for (const m of matches) {
      if (m.next_match_id !== null) {
        expect(allIds.has(m.next_match_id)).toBe(true);
      }
    }
  });

  it('17 players → total match count is consistent (no duplicate match keys)', () => {
    const ids = fakeIds(17);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    // No two matches share (round, match_number)
    const keys = matches.map((m) => `${m.round}:${m.match_number}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(matches.length);
  });

  it('5 players → play-in structure, no BYE at generation time', () => {
    // tournament-pairings builds a play-in round for non-pow2 fields instead
    // of classic BYEs: the half-filled round-2 match awaits the play-in
    // winner and must NOT be finalized as BYE (regression 2026-06-04).
    const ids = fakeIds(5);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    expect(matches.filter((m) => m.status === 'BYE')).toHaveLength(0);

    // Exactly one round-1 play-in with two players, feeding a half-filled
    // PENDING round-2 match.
    const r1 = matches.filter((m) => m.round === 1);
    expect(r1).toHaveLength(1);
    expect(r1[0]!.player1_id).not.toBeNull();
    expect(r1[0]!.player2_id).not.toBeNull();
    expect(r1[0]!.next_match_id).not.toBeNull();

    const target = matches.find((m) => m.id === r1[0]!.next_match_id)!;
    expect(target.status).toBe('PENDING');
    expect(target.winner_id).toBeNull();
  });

  it('all matches belong to the correct tournamentId', () => {
    const ids = fakeIds(8);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    for (const m of matches) {
      expect(m.tournament_id).toBe(TOURNAMENT_ID);
    }
  });

  it('matches are sorted by (round, match_number)', () => {
    const ids = fakeIds(8);
    const matches = generateSingleElim(TOURNAMENT_ID, ids);

    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1]!;
      const curr = matches[i]!;
      const prevKey = prev.round * 10000 + prev.match_number;
      const currKey = curr.round * 10000 + curr.match_number;
      expect(prevKey).toBeLessThanOrEqual(currKey);
    }
  });
});
