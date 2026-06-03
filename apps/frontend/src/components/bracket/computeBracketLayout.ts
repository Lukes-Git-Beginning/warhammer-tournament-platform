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

const SECTION_GAP = 80;

interface LinearLayoutOpts {
  xBase?: number;
  yBase?: number;
  /** All matches in the broader tournament — used for cross-group feeder lookup (unused here,
   *  feeders are scoped to the group only). Kept for future extensibility. */
  allMatchIds?: Set<string>;
}

/**
 * Core layout algorithm — positions a flat list of matches in a left-to-right
 * tournament tree. Rounds are normalised relative to the smallest round number
 * in the group so the first column always starts at xBase.
 */
function computeLinearLayout(
  matches: BracketNode[],
  opts: LinearLayoutOpts = {},
): BracketLayout {
  const positions = new Map<string, MatchPosition>();

  if (matches.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  const xBase = opts.xBase ?? 0;
  const yBase = opts.yBase ?? 0;

  // Build a set of match IDs belonging to this group for scoped feeder lookup.
  const groupIds = new Set(matches.map((m) => m.matchId));

  // Group by round
  const rounds = new Map<number, BracketNode[]>();
  for (const m of matches) {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round)!.push(m);
  }

  const sortedRounds = Array.from(rounds.keys()).sort((a, b) => a - b);

  // Normalise column index: col = round - minRound (so col 0 is always leftmost).
  const minRound = sortedRounds[0] ?? 1;

  // Round 0 (relative): evenly spaced from top
  const firstRoundNum = sortedRounds[0] ?? minRound;
  const round1 = rounds.get(firstRoundNum)!;
  round1.sort((a, b) => a.matchNumber - b.matchNumber);
  for (let i = 0; i < round1.length; i++) {
    const node = round1[i];
    if (node) {
      positions.set(node.matchId, {
        x: xBase + 0 * (MATCH_WIDTH + ROUND_GAP), // col 0
        y: yBase + i * (MATCH_HEIGHT + ROW_GAP),
      });
    }
  }

  // Subsequent rounds: y = midpoint of feeder y-positions (within this group only)
  for (let ri = 1; ri < sortedRounds.length; ri++) {
    const roundNum = sortedRounds[ri] ?? minRound;
    const col = roundNum - minRound;
    const roundMatches = rounds.get(roundNum)!;
    roundMatches.sort((a, b) => a.matchNumber - b.matchNumber);

    const x = xBase + col * (MATCH_WIDTH + ROUND_GAP);
    let fallbackY = yBase;

    for (const m of roundMatches) {
      // Only consider feeders that belong to this group (scoped lookup)
      const feeders = matches.filter(
        (f) => f.nextMatchId === m.matchId && groupIds.has(f.matchId),
      );
      let y: number;

      if (feeders.length > 0) {
        const feederYs = feeders.map((f) => positions.get(f.matchId)?.y ?? yBase);
        y = feederYs.reduce((sum, v) => sum + v, 0) / feederYs.length;
      } else {
        y = fallbackY;
      }

      positions.set(m.matchId, { x, y });
      fallbackY = y + MATCH_HEIGHT + ROW_GAP;
    }
  }

  // Compute bounding box relative to the group's content
  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    const localX = pos.x - xBase + MATCH_WIDTH;
    const localY = pos.y - yBase + MATCH_HEIGHT;
    if (localX > maxX) maxX = localX;
    if (localY > maxY) maxY = localY;
  }

  return { positions, width: maxX, height: maxY };
}

export function computeBracketLayout(matches: BracketNode[]): BracketLayout {
  if (matches.length === 0) {
    return { positions: new Map(), width: 0, height: 0 };
  }

  const hasDE = matches.some((m) => m.bracketSide !== null);

  if (!hasDE) {
    // SE / Swiss / RR — identical behaviour to the original implementation.
    return computeLinearLayout(matches);
  }

  // Double-Elimination split
  const wb = matches.filter((m) => m.bracketSide === 'WINNERS');
  const lb = matches.filter((m) => m.bracketSide === 'LOSERS');
  const gf = matches.filter((m) => m.bracketSide === 'GRAND_FINAL');

  const wbLayout = computeLinearLayout(wb, { xBase: 0, yBase: 0 });

  const lbYBase = wbLayout.height + SECTION_GAP;
  const lbLayout = computeLinearLayout(lb, { xBase: 0, yBase: lbYBase });

  const totalHeight = lbYBase + lbLayout.height;
  const gfX = Math.max(wbLayout.width, lbLayout.width) + ROUND_GAP;
  // Vertically centre GF between WB top and LB bottom
  const gfYBase = totalHeight / 2 - MATCH_HEIGHT / 2;
  const gfLayout = computeLinearLayout(gf, { xBase: gfX, yBase: gfYBase });

  // Merge all three position maps
  const positions = new Map<string, MatchPosition>();
  for (const [id, pos] of wbLayout.positions) positions.set(id, pos);
  for (const [id, pos] of lbLayout.positions) positions.set(id, pos);
  for (const [id, pos] of gfLayout.positions) positions.set(id, pos);

  // Compute overall bounding box (absolute coordinates)
  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    if (pos.x + MATCH_WIDTH > maxX) maxX = pos.x + MATCH_WIDTH;
    if (pos.y + MATCH_HEIGHT > maxY) maxY = pos.y + MATCH_HEIGHT;
  }

  return { positions, width: maxX, height: maxY };
}
