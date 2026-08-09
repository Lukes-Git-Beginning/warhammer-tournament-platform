/**
 * never-bye-twice counter (computeRestByePlayers): a real/provisional rest-bye counts, a NO_CONTEST
 * counts for BOTH players (double-bye), a CATCHUP_BYE does not. Locks the Ponti case — a no-contest
 * player must not be handed a second, real bye on top of the no-contest bye point.
 */
import { describe, it, expect } from 'vitest';
import { computeRestByePlayers } from '../src/lib/balanced-liechtenstein-service.js';

const m = (status: string, p1: string | null, p2: string | null = null) => ({ status, player1_id: p1, player2_id: p2 });

describe('computeRestByePlayers', () => {
  it('counts a real BYE and a PENDING_BYE (holder sat out alone)', () => {
    const s = computeRestByePlayers([m('BYE', 'A'), m('PENDING_BYE', 'B')]);
    expect(s.has('A')).toBe(true);
    expect(s.has('B')).toBe(true);
  });

  it('counts BOTH players of a NO_CONTEST (technical-abort double-bye)', () => {
    const s = computeRestByePlayers([m('NO_CONTEST', 'X', 'Y')]);
    expect(s.has('X')).toBe(true);
    expect(s.has('Y')).toBe(true);
  });

  it('does NOT count a CATCHUP_BYE (a catching-up player stays bye-eligible)', () => {
    const s = computeRestByePlayers([m('CATCHUP_BYE', 'C')]);
    expect(s.has('C')).toBe(false);
  });

  it('does NOT count a normal completed match', () => {
    const s = computeRestByePlayers([m('COMPLETED', 'P', 'Q')]);
    expect(s.size).toBe(0);
  });

  it('Ponti case: a NO_CONTEST player is now excluded from a second, real bye', () => {
    const s = computeRestByePlayers([m('NO_CONTEST', 'Ponti', 'Opp'), m('COMPLETED', 'Ponti', 'R2')]);
    expect(s.has('Ponti')).toBe(true);
  });
});
