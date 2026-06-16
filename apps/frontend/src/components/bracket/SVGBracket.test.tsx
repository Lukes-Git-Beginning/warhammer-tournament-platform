import { describe, it, expect } from 'vitest';
import type { BracketNode } from '@rizzotto/types';
import { makeSlotLabel, type BracketPlayerInfo } from './SVGBracket';

function makeMatch(overrides: Partial<BracketNode> = {}): BracketNode {
  return {
    matchId: 'sf1',
    round: 1,
    matchNumber: 1,
    player1Id: 'byrd',
    player2Id: 'galju',
    winnerId: null,
    score: null,
    result: null,
    player1Points: null,
    player2Points: null,
    status: 'PENDING',
    nextMatchId: null,
    loserNextMatchId: null,
    bracketSide: null,
    player1FactionId: null,
    player2FactionId: null,
    player1GameWins: 0,
    player2GameWins: 0,
    ...overrides,
  };
}

const players = new Map<string, BracketPlayerInfo>([
  ['byrd', { name: 'Byrd', avatarUrl: null }],
  ['galju', { name: 'Galju', avatarUrl: null }],
]);

describe('makeSlotLabel', () => {
  it('projects the candidate pair for an undecided winner slot', () => {
    const sf = makeMatch();
    expect(makeSlotLabel(sf, players, false)).toBe('Byrd / Galju');
  });

  it('distinguishes an undecided loser slot from the winner slot', () => {
    const sf = makeMatch();
    // The third-place (loser) slot must NOT render the same as the Grand Final
    // (winner) slot — that was the "same players in both nodes" bug.
    expect(makeSlotLabel(sf, players, true)).toBe('Loser of Byrd / Galju');
    expect(makeSlotLabel(sf, players, true)).not.toBe(makeSlotLabel(sf, players, false));
  });

  it('resolves to the winner name once the feeder is COMPLETED', () => {
    const sf = makeMatch({ status: 'COMPLETED', winnerId: 'byrd' });
    expect(makeSlotLabel(sf, players, false)).toBe('Byrd');
  });

  it('resolves to the loser name once the feeder is COMPLETED', () => {
    const sf = makeMatch({ status: 'COMPLETED', winnerId: 'byrd' });
    expect(makeSlotLabel(sf, players, true)).toBe('Galju');
  });

  it('returns null when the feeder has no known players yet', () => {
    const sf = makeMatch({ player1Id: null, player2Id: null });
    expect(makeSlotLabel(sf, players, false)).toBeNull();
    expect(makeSlotLabel(sf, players, true)).toBeNull();
  });
});
