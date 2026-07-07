import { describe, it, expect } from 'vitest';
import { toActualCell } from './matrix';

describe('toActualCell — matrix viewer transpose', () => {
  it('is the identity when not transposed (viewer is player 1)', () => {
    expect(toActualCell(false, 0, 2)).toEqual([0, 2]);
    expect(toActualCell(false, 1, 0)).toEqual([1, 0]);
    expect(toActualCell(false, 2, 2)).toEqual([2, 2]);
  });

  it('swaps row/col when transposed (viewer is player 2)', () => {
    expect(toActualCell(true, 0, 2)).toEqual([2, 0]);
    expect(toActualCell(true, 1, 0)).toEqual([0, 1]);
    expect(toActualCell(true, 2, 1)).toEqual([1, 2]);
  });

  it('a transposed board maps every displayed cell to a distinct actual cell', () => {
    const seen = new Set<string>();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const [ar, ac] = toActualCell(true, r, c);
        seen.add(`${ar},${ac}`);
      }
    }
    // Bijective: all 9 real cells are covered exactly once, so a player-2 ban
    // never collides with or misses a cell.
    expect(seen.size).toBe(9);
  });

  it('a diagonal cell is stable under transpose (same actual cell for both views)', () => {
    // (1,1) is on the diagonal, so it refers to the same matchup either way.
    expect(toActualCell(true, 1, 1)).toEqual([1, 1]);
    expect(toActualCell(false, 1, 1)).toEqual([1, 1]);
  });
});
