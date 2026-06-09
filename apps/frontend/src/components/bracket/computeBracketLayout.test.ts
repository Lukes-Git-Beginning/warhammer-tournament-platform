import { describe, it, expect } from 'vitest';
import type { BracketNode } from '@rizzotto/types';
import {
  computeBracketLayout,
  MATCH_HEIGHT,
  MATCH_WIDTH,
  ROW_GAP,
  ROUND_GAP,
} from './computeBracketLayout';

function makeMatch(
  matchId: string,
  round: number,
  matchNumber: number,
  nextMatchId: string | null = null,
  bracketSide: BracketNode['bracketSide'] = null,
  loserNextMatchId: string | null = null,
): BracketNode {
  return {
    matchId,
    round,
    matchNumber,
    player1Id: null,
    player2Id: null,
    winnerId: null,
    score: null,
    result: null,
    player1Points: null,
    player2Points: null,
    status: 'PENDING',
    nextMatchId,
    loserNextMatchId,
    bracketSide,
    player1FactionId: null,
    player2FactionId: null,
    player1GameWins: 0,
    player2GameWins: 0,
  };
}

describe('computeBracketLayout', () => {
  it('4-player bracket: R2.y == midpoint of R1 y-values', () => {
    const matches: BracketNode[] = [
      makeMatch('r1m1', 1, 1, 'r2m1'),
      makeMatch('r1m2', 1, 2, 'r2m1'),
      makeMatch('r2m1', 2, 1, null),
    ];

    const layout = computeBracketLayout(matches);

    const r1m1 = layout.positions.get('r1m1')!;
    const r1m2 = layout.positions.get('r1m2')!;
    const r2m1 = layout.positions.get('r2m1')!;

    expect(r1m1.y).toBe(0);
    expect(r1m2.y).toBe(MATCH_HEIGHT + ROW_GAP);

    const expectedY = (r1m1.y + r1m2.y) / 2;
    expect(r2m1.y).toBe(expectedY);
  });

  it('8-player bracket: 7 matches, R3.y == midpoint of R2 feeders', () => {
    // R1: m1..m4, R2: m5(feeds m7), m6(feeds m7), R3: m7
    const matches: BracketNode[] = [
      makeMatch('r1m1', 1, 1, 'r2m1'),
      makeMatch('r1m2', 1, 2, 'r2m1'),
      makeMatch('r1m3', 1, 3, 'r2m2'),
      makeMatch('r1m4', 1, 4, 'r2m2'),
      makeMatch('r2m1', 2, 1, 'r3m1'),
      makeMatch('r2m2', 2, 2, 'r3m1'),
      makeMatch('r3m1', 3, 1, null),
    ];

    const layout = computeBracketLayout(matches);
    expect(layout.positions.size).toBe(7);

    const r2m1 = layout.positions.get('r2m1')!;
    const r2m2 = layout.positions.get('r2m2')!;
    const r3m1 = layout.positions.get('r3m1')!;

    expect(r3m1.y).toBe((r2m1.y + r2m2.y) / 2);
  });

  it('16-player bracket: 15 matches', () => {
    // R1: m1-m8, R2: m9-m12, R3: m13-m14, R4: m15
    const r1 = Array.from({ length: 8 }, (_, i) =>
      makeMatch(`r1m${i + 1}`, 1, i + 1, `r2m${Math.floor(i / 2) + 1}`),
    );
    const r2 = Array.from({ length: 4 }, (_, i) =>
      makeMatch(`r2m${i + 1}`, 2, i + 1, `r3m${Math.floor(i / 2) + 1}`),
    );
    const r3 = Array.from({ length: 2 }, (_, i) =>
      makeMatch(`r3m${i + 1}`, 3, i + 1, 'r4m1'),
    );
    const r4 = [makeMatch('r4m1', 4, 1, null)];

    const matches = [...r1, ...r2, ...r3, ...r4];
    expect(matches.length).toBe(15);

    const layout = computeBracketLayout(matches);
    expect(layout.positions.size).toBe(15);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  describe('Double-Elimination layout', () => {
    // Minimal DE fixture:
    //   WB: wb1 (round 1), wb2 (round 2) — wb1 → wb2 winner, wb1 loser → lb1
    //   LB: lb1 (round 3)
    //   GF: gf1 (round 4)
    const deMatches: BracketNode[] = [
      makeMatch('wb1', 1, 1, 'wb2', 'WINNERS', 'lb1'),
      makeMatch('wb2', 2, 1, 'gf1', 'WINNERS'),
      makeMatch('lb1', 3, 1, 'gf1', 'LOSERS'),
      makeMatch('gf1', 4, 1, null, 'GRAND_FINAL'),
    ];

    it('all match IDs are present in positions', () => {
      const layout = computeBracketLayout(deMatches);
      expect(layout.positions.size).toBe(4);
      expect(layout.positions.has('wb1')).toBe(true);
      expect(layout.positions.has('wb2')).toBe(true);
      expect(layout.positions.has('lb1')).toBe(true);
      expect(layout.positions.has('gf1')).toBe(true);
    });

    it('WB matches start at y=0 (top section)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb1 = layout.positions.get('wb1')!;
      const wb2 = layout.positions.get('wb2')!;
      expect(wb1.y).toBe(0);
      expect(wb2.y).toBe(0); // single feeder → same y
    });

    it('LB matches are below WB matches (y > WB bottom)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb2 = layout.positions.get('wb2')!;
      const lb1 = layout.positions.get('lb1')!;
      // LB y-base should be at least WB bottom + SECTION_GAP
      expect(lb1.y).toBeGreaterThan(wb2.y + MATCH_HEIGHT);
    });

    it('WB and LB start at x=0 (column normalisation)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb1 = layout.positions.get('wb1')!;
      const lb1 = layout.positions.get('lb1')!;
      expect(wb1.x).toBe(0);
      expect(lb1.x).toBe(0);
    });

    it('GF is to the right of WB/LB sections', () => {
      const layout = computeBracketLayout(deMatches);
      const wb2 = layout.positions.get('wb2')!;
      const gf1 = layout.positions.get('gf1')!;
      // GF x >= WB second-column x + MATCH_WIDTH + ROUND_GAP
      expect(gf1.x).toBeGreaterThanOrEqual(wb2.x + MATCH_WIDTH + ROUND_GAP);
    });

    it('bracketSide=null matches are unaffected (SE path)', () => {
      // Existing SE test should still pass — no bracketSide set
      const seMatches: BracketNode[] = [
        makeMatch('r1m1', 1, 1, 'r2m1'),
        makeMatch('r1m2', 1, 2, 'r2m1'),
        makeMatch('r2m1', 2, 1, null),
      ];
      const layout = computeBracketLayout(seMatches);
      const r1m1 = layout.positions.get('r1m1')!;
      const r1m2 = layout.positions.get('r1m2')!;
      const r2m1 = layout.positions.get('r2m1')!;
      expect(r1m1.y).toBe(0);
      expect(r1m2.y).toBe(MATCH_HEIGHT + ROW_GAP);
      expect(r2m1.y).toBe((r1m1.y + r1m2.y) / 2);
      // SE x-positions: col = round - 1, col 0 → x=0, col 1 → x=MATCH_WIDTH+ROUND_GAP
      expect(r1m1.x).toBe(0);
      expect(r2m1.x).toBe(MATCH_WIDTH + ROUND_GAP);
    });
  });
});
