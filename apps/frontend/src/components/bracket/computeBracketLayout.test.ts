import { describe, it, expect } from 'vitest';
import type { BracketNode } from '@rizzotto/types';
import {
  computeBracketLayout,
  MATCH_HEIGHT,
  ROW_GAP,
} from './computeBracketLayout';

function makeMatch(
  matchId: string,
  round: number,
  matchNumber: number,
  nextMatchId: string | null = null,
): BracketNode {
  return {
    matchId,
    round,
    matchNumber,
    player1Id: null,
    player2Id: null,
    winnerId: null,
    score: null,
    status: 'PENDING',
    nextMatchId,
    player1FactionId: null,
    player2FactionId: null,
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
});
