import type { BracketNode } from '@rizzotto/types';

export interface MatchPosition {
  x: number;
  y: number;
}

/** A visually separated bracket section (e.g. one Balanced Liechtenstein division). */
export interface BracketGroup {
  /** Match IDs belonging to this section (used to derive a band label). */
  matchIds: string[];
  /** Left x of the section (label anchor). */
  x: number;
  /** Top y of the section, including the label strip. */
  y: number;
}

export interface BracketLayout {
  positions: Map<string, MatchPosition>;
  width: number;
  height: number;
  /** Present when the bracket is split into labelled sections (Balanced divisions). */
  groups?: BracketGroup[];
}

export const MATCH_WIDTH = 200;
export const MATCH_HEIGHT = 80;
export const ROUND_GAP = 100;
export const ROW_GAP = 24;

const SECTION_GAP = 80;
/** Vertical space reserved above each Balanced division bracket for its band label. */
const DIVISION_LABEL_HEIGHT = 32;

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
    // Running floor: the next match in this round must sit at least here. This keeps a
    // bye-seeded match (no feeder, e.g. a bye-vs-bye in an odd single-elim round) from
    // colliding with a later, feeder-positioned match whose ideal midpoint lands on the
    // same row — the later match is pushed down instead of drawn on top.
    let minY = yBase;

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
        y = minY;
      }
      if (y < minY) y = minY; // never overlap the previous match in this round

      positions.set(m.matchId, { x, y });
      minY = y + MATCH_HEIGHT + ROW_GAP;
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

/**
 * Group playoff matches into connected components — one per Balanced division —
 * following next_match_id and loser_next_match_id links.
 */
function groupPlayoffDivisions(playoff: BracketNode[]): BracketNode[][] {
  const ids = new Set(playoff.map((m) => m.matchId));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const m of playoff) parent.set(m.matchId, m.matchId);
  for (const m of playoff) {
    if (m.nextMatchId && ids.has(m.nextMatchId)) union(m.matchId, m.nextMatchId);
    if (m.loserNextMatchId && ids.has(m.loserNextMatchId)) union(m.matchId, m.loserNextMatchId);
  }
  // A TOP2 division's third-place match has no feeders (no SFs point at it), so it
  // is not linked to its final. Attach each such orphan to the final numbered just
  // before it (buildDivisionBracket emits final then third place, consecutively).
  const hasFeeder = new Set<string>();
  for (const m of playoff) {
    if (m.nextMatchId) hasFeeder.add(m.nextMatchId);
    if (m.loserNextMatchId) hasFeeder.add(m.loserNextMatchId);
  }
  const byNumber = new Map(playoff.map((m) => [m.matchNumber, m]));
  for (const m of playoff) {
    if (m.phase === 'PLAYOFF_THIRD_PLACE' && !hasFeeder.has(m.matchId)) {
      const finalBefore = byNumber.get(m.matchNumber - 1);
      if (finalBefore) union(m.matchId, finalBefore.matchId);
    }
  }
  const groups = new Map<string, BracketNode[]>();
  for (const m of playoff) {
    const root = find(m.matchId);
    const arr = groups.get(root);
    if (arr) arr.push(m);
    else groups.set(root, [m]);
  }
  return [...groups.values()];
}

/**
 * Balanced Liechtenstein playoffs: the (optional) Swiss matches on the left, then
 * each division's own bracket stacked vertically on the right, every division
 * getting a label strip. Divisions are ordered by their earliest match number
 * (top division — highest band — first).
 */
function computeBalancedPlayoffLayout(swiss: BracketNode[], playoff: BracketNode[]): BracketLayout {
  const positions = new Map<string, MatchPosition>();

  const swissLayout = computeLinearLayout(swiss, { xBase: 0, yBase: 0 });
  for (const [id, pos] of swissLayout.positions) positions.set(id, pos);

  const xBase = swissLayout.width > 0 ? swissLayout.width + SECTION_GAP : 0;

  const divisions = groupPlayoffDivisions(playoff).sort(
    (a, b) =>
      Math.min(...a.map((m) => m.matchNumber)) - Math.min(...b.map((m) => m.matchNumber)),
  );

  const groups: BracketGroup[] = [];
  let yOffset = 0;
  for (const div of divisions) {
    const sub = computeLinearLayout(div, { xBase, yBase: yOffset + DIVISION_LABEL_HEIGHT });
    for (const [id, pos] of sub.positions) positions.set(id, pos);
    groups.push({ matchIds: div.map((m) => m.matchId), x: xBase, y: yOffset });
    yOffset += DIVISION_LABEL_HEIGHT + sub.height + SECTION_GAP;
  }

  let maxX = 0;
  let maxY = yOffset;
  for (const pos of positions.values()) {
    if (pos.x + MATCH_WIDTH > maxX) maxX = pos.x + MATCH_WIDTH;
    if (pos.y + MATCH_HEIGHT > maxY) maxY = pos.y + MATCH_HEIGHT;
  }

  return { positions, width: maxX, height: maxY, groups };
}

export function computeBracketLayout(matches: BracketNode[]): BracketLayout {
  if (matches.length === 0) {
    return { positions: new Map(), width: 0, height: 0 };
  }

  const hasDE = matches.some((m) => m.bracketSide !== null);

  if (!hasDE) {
    // Balanced Liechtenstein division playoffs: more than one final = several
    // parallel division brackets → stack them vertically with labels.
    const playoff = matches.filter((m) => m.phase?.startsWith('PLAYOFF'));
    const finalCount = playoff.filter((m) => m.phase === 'PLAYOFF_FINAL').length;
    if (finalCount > 1) {
      const swiss = matches.filter((m) => !m.phase || m.phase === 'SWISS');
      return computeBalancedPlayoffLayout(swiss, playoff);
    }

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
