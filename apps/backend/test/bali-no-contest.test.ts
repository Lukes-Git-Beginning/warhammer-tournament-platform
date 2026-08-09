/**
 * NO_CONTEST must free both players for the next round in Balanced Liechtenstein (it is an ADVANCING
 * status). The engine already handles it; the live bug was the no-contest endpoint not firing a
 * pairing tick (matches.ts) — this locks that a NO_CONTEST'd pair is re-paired, not stranded.
 */
import { describe, it, expect } from 'vitest';
import {
  planPairings,
  type BalancedParticipant,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';

describe('BaLi NO_CONTEST frees players for the next round', () => {
  it('pairs both players of a NO_CONTEST match into the following round', () => {
    const parts: BalancedParticipant[] = [
      { userId: 'A', band: 3 }, { userId: 'B', band: 3 },
      { userId: 'C', band: 3 }, { userId: 'D', band: 3 },
    ];
    const history: BalancedMatchRow[] = [
      { round: 1, player1_id: 'A', player2_id: 'B', status: 'NO_CONTEST' },
      { round: 1, player1_id: 'C', player2_id: 'D', status: 'COMPLETED' },
    ];
    const plan = planPairings(parts, history, 3, 'nc-seed');
    const paired = new Set(
      plan.pairings.filter((p) => p.round === 2).flatMap((p) => [p.player1_id, p.player2_id]),
    );
    // A and B (their round-1 match was NO_CONTEST) must be advanced into round 2, not stranded.
    expect(paired.has('A')).toBe(true);
    expect(paired.has('B')).toBe(true);
  });
});
