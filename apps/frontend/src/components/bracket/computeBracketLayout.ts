import type { BracketNode } from '@rizzotto/types';

export interface MatchPosition {
  x: number;
  y: number;
}

export interface BracketLayout {
  positions: Map<string, MatchPosition>;
  width: number;
  height: number;
}

export const MATCH_WIDTH = 200;
export const MATCH_HEIGHT = 80;
export const ROUND_GAP = 100;
export const ROW_GAP = 24;

export function computeBracketLayout(matches: BracketNode[]): BracketLayout {
  const positions = new Map<string, MatchPosition>();

  if (matches.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  // Group by round
  const rounds = new Map<number, BracketNode[]>();
  for (const m of matches) {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round)!.push(m);
  }

  const sortedRounds = Array.from(rounds.keys()).sort((a, b) => a - b);

  // Round 1: evenly spaced from top
  const firstRoundNum = sortedRounds[0] ?? 1;
  const round1 = rounds.get(firstRoundNum)!;
  round1.sort((a, b) => a.matchNumber - b.matchNumber);
  for (let i = 0; i < round1.length; i++) {
    const node = round1[i];
    if (node) {
      positions.set(node.matchId, {
        x: (firstRoundNum - 1) * (MATCH_WIDTH + ROUND_GAP),
        y: i * (MATCH_HEIGHT + ROW_GAP),
      });
    }
  }

  // Subsequent rounds: y = midpoint of feeder y-positions
  for (let ri = 1; ri < sortedRounds.length; ri++) {
    const roundNum = sortedRounds[ri] ?? 1;
    const roundMatches = rounds.get(roundNum)!;
    roundMatches.sort((a, b) => a.matchNumber - b.matchNumber);

    const x = (roundNum - 1) * (MATCH_WIDTH + ROUND_GAP);
    let fallbackY = 0;

    for (const m of roundMatches) {
      const feeders = matches.filter((f) => f.nextMatchId === m.matchId);
      let y: number;

      if (feeders.length > 0) {
        const feederYs = feeders
          .map((f) => positions.get(f.matchId)?.y ?? 0);
        y = feederYs.reduce((sum, v) => sum + v, 0) / feederYs.length;
      } else {
        y = fallbackY;
      }

      positions.set(m.matchId, { x, y });
      fallbackY = y + MATCH_HEIGHT + ROW_GAP;
    }
  }

  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    if (pos.x + MATCH_WIDTH > maxX) maxX = pos.x + MATCH_WIDTH;
    if (pos.y + MATCH_HEIGHT > maxY) maxY = pos.y + MATCH_HEIGHT;
  }

  return { positions, width: maxX, height: maxY };
}
