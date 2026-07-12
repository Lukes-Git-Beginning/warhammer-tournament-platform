import { describe, it, expect } from 'vitest';
import { getBalancedTopDivisionPodium } from './bracketStandings';
import type { BracketNode } from '@rizzotto/types';

const node = (p: Partial<BracketNode>): BracketNode => p as BracketNode;

describe('getBalancedTopDivisionPodium', () => {
  // Top division = band 5 (vm, fb, xeblon). cb is band 4, borrowed UP into the top
  // division's small final. a3..d3 are a separate lower (band 3) division.
  const band = new Map<string, number>([
    ['vm', 5], ['fb', 5], ['xeblon', 5], ['cb', 4],
    ['a3', 3], ['b3', 3], ['c3', 3], ['d3', 3],
  ]);

  it('awards 1/2/3 from the top division final + small final, crediting a borrowed small-final winner', () => {
    const matches = [
      // Top division (band 5): vm beats fb; cb (borrowed) beats xeblon in the small final.
      node({ phase: 'PLAYOFF_FINAL', player1Id: 'vm', player2Id: 'fb', winnerId: 'vm', status: 'COMPLETED' }),
      node({ phase: 'PLAYOFF_THIRD_PLACE', player1Id: 'xeblon', player2Id: 'cb', winnerId: 'cb', status: 'COMPLETED' }),
      // A lower (band 3) division playoff — must NOT award any tournament placement.
      node({ phase: 'PLAYOFF_FINAL', player1Id: 'a3', player2Id: 'b3', winnerId: 'a3', status: 'COMPLETED' }),
      node({ phase: 'PLAYOFF_THIRD_PLACE', player1Id: 'c3', player2Id: 'd3', winnerId: 'c3', status: 'COMPLETED' }),
    ];
    const podium = getBalancedTopDivisionPodium(matches, band);
    expect(podium.get('vm')).toBe(1);
    expect(podium.get('fb')).toBe(2);
    expect(podium.get('cb')).toBe(3); // borrowed small-final winner is the 3rd
    expect(podium.get('xeblon')).toBeUndefined(); // lost the small final → no badge
    expect(podium.get('a3')).toBeUndefined(); // lower division → no tournament badge
    expect(podium.get('c3')).toBeUndefined();
    expect(podium.size).toBe(3); // exactly three badges, no 4th
  });

  it('is empty until the top division final is decided', () => {
    const matches = [
      node({ phase: 'PLAYOFF_FINAL', player1Id: 'vm', player2Id: 'fb', winnerId: null, status: 'PENDING' }),
    ];
    expect(getBalancedTopDivisionPodium(matches, band).size).toBe(0);
  });
});
