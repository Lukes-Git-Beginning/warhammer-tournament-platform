import { describe, it, expect } from 'vitest';
import type { BracketNode } from '@rizzotto/types';
import { makeSlotLabel, computeSlotLabels, type BracketPlayerInfo } from './SVGBracket';

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

describe('computeSlotLabels — half-filled target projects the other feeder', () => {
  const playoffPlayers = new Map<string, BracketPlayerInfo>([
    ['byrd', { name: 'Byrd', avatarUrl: null }],
    ['galju', { name: 'Galju', avatarUrl: null }],
    ['ponti', { name: 'RAD | ponti', avatarUrl: null }],
    ['jimmy', { name: 'jimmy le singe', avatarUrl: null }],
  ]);

  // TOP4: SF2 finished (jimmy beat ponti) and advanced into one slot of both the
  // Grand Final and the third-place match via "first-free" propagation, while SF1
  // (Byrd vs Galju) is still pending. The empty slot must preview SF1 — not re-show
  // the SF2 result already seated above it (the reported duplicate-player bug).
  const sf1 = makeMatch({
    matchId: 'sf1', matchNumber: 1, player1Id: 'byrd', player2Id: 'galju',
    status: 'PENDING', nextMatchId: 'gf', loserNextMatchId: 'tp',
  });
  const sf2 = makeMatch({
    matchId: 'sf2', matchNumber: 2, player1Id: 'ponti', player2Id: 'jimmy',
    winnerId: 'jimmy', status: 'COMPLETED', nextMatchId: 'gf', loserNextMatchId: 'tp',
  });
  const gf = makeMatch({
    matchId: 'gf', matchNumber: 1, player1Id: 'jimmy', player2Id: null, status: 'PENDING',
  });
  const tp = makeMatch({
    matchId: 'tp', matchNumber: 2, player1Id: 'ponti', player2Id: null, status: 'PENDING',
  });

  const labels = computeSlotLabels([sf1, sf2, gf, tp], playoffPlayers);

  it('Grand Final empty slot previews the pending semifinal, not the seated winner', () => {
    expect(labels.get('gf')?.p2).toBe('Byrd / Galju');
    expect(labels.get('gf')?.p2).not.toBe('jimmy le singe');
  });

  it('third-place empty slot previews the pending semifinal loser, not the seated loser', () => {
    expect(labels.get('tp')?.p2).toBe('Loser of Byrd / Galju');
    expect(labels.get('tp')?.p2).not.toBe('RAD | ponti');
  });
});
