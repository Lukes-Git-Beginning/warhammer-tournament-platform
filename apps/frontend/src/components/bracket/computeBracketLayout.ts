import type { BracketNode, ProjectedDivision } from '@rizzotto/types';

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

/** A single placeholder node in a projected (pre-generated) playoff bracket. */
export interface PlaceholderNode {
  id: string;
  /** The id of the next placeholder this node's winner feeds into (null for finals). */
  nextId: string | null;
  /** The id of the next placeholder this node's loser feeds into (3rd-place match only). */
  loserNextId: string | null;
  /** Display label for the match type. */
  phase: 'QF' | 'SF' | 'Final' | '3rd Place';
  /** Division index (0-based) — used for the group label. */
  divisionIndex: number;
}

/** Pre-computed layout for placeholder (projected) playoff matches. */
export interface PlaceholderLayout {
  positions: Map<string, MatchPosition>;
  nodes: PlaceholderNode[];
  width: number;
  height: number;
  /** One entry per projected division; parallels the structure of BracketLayout.groups. */
  groups: Array<{
    nodeIds: string[];
    x: number;
    y: number;
    /** Division label text (e.g. "Division 1", or null for single-division tournaments). */
    label: string | null;
    /** Format string for the label (e.g. "Top 4 · 8 seeds"). */
    detail: string;
  }>;
}

// ---------------------------------------------------------------------------
// Placeholder layout helpers
// ---------------------------------------------------------------------------

/**
 * Build the placeholder nodes for a single projected division bracket.
 * Returns nodes in draw order (QF left, then SF, then Final+3rd-place).
 * The division prefix is used to generate unique IDs.
 */
function buildPlaceholderNodes(
  divIdx: number,
  format: ProjectedDivision['format'],
  hasThirdPlace: boolean,
): PlaceholderNode[] {
  const prefix = `__ph_d${divIdx}`;
  const nodes: PlaceholderNode[] = [];

  if (format === 'TOP8') {
    // QF: 4 matches → SF: 2 matches → Final + optional 3rd place
    const qfIds = [0, 1, 2, 3].map((i) => `${prefix}_qf${i}`);
    const sfIds = [0, 1].map((i) => `${prefix}_sf${i}`);
    const finalId = `${prefix}_final`;
    const thirdId = `${prefix}_3rd`;

    qfIds.forEach((id, i) => {
      nodes.push({ id, nextId: sfIds[Math.floor(i / 2)]!, loserNextId: null, phase: 'QF', divisionIndex: divIdx });
    });
    sfIds.forEach((id, i) => {
      nodes.push({ id, nextId: finalId, loserNextId: hasThirdPlace ? thirdId : null, phase: 'SF', divisionIndex: divIdx });
    });
    nodes.push({ id: finalId, nextId: null, loserNextId: null, phase: 'Final', divisionIndex: divIdx });
    if (hasThirdPlace) {
      nodes.push({ id: thirdId, nextId: null, loserNextId: null, phase: '3rd Place', divisionIndex: divIdx });
    }
  } else if (format === 'TOP4') {
    // SF: 2 matches → Final + optional 3rd place
    const sfIds = [0, 1].map((i) => `${prefix}_sf${i}`);
    const finalId = `${prefix}_final`;
    const thirdId = `${prefix}_3rd`;

    sfIds.forEach((id) => {
      nodes.push({ id, nextId: finalId, loserNextId: hasThirdPlace ? thirdId : null, phase: 'SF', divisionIndex: divIdx });
    });
    nodes.push({ id: finalId, nextId: null, loserNextId: null, phase: 'Final', divisionIndex: divIdx });
    if (hasThirdPlace) {
      nodes.push({ id: thirdId, nextId: null, loserNextId: null, phase: '3rd Place', divisionIndex: divIdx });
    }
  } else {
    // TOP2: Final only + optional 3rd place (no feeders)
    const finalId = `${prefix}_final`;
    const thirdId = `${prefix}_3rd`;
    nodes.push({ id: finalId, nextId: null, loserNextId: null, phase: 'Final', divisionIndex: divIdx });
    if (hasThirdPlace) {
      nodes.push({ id: thirdId, nextId: null, loserNextId: null, phase: '3rd Place', divisionIndex: divIdx });
    }
  }

  return nodes;
}

/**
 * Compute positions for a flat list of placeholder nodes using the same midpoint
 * algorithm as computeLinearLayout — but operating on PlaceholderNode instead of BracketNode.
 * Round membership is determined by the phase: QF=0, SF=1, Final=2, 3rd=2 (same column as Final).
 */
function placeholderLinearLayout(
  nodes: PlaceholderNode[],
  xBase: number,
  yBase: number,
): Map<string, MatchPosition> {
  const positions = new Map<string, MatchPosition>();
  if (nodes.length === 0) return positions;

  const phaseCol: Record<PlaceholderNode['phase'], number> = {
    QF: 0,
    SF: 1,
    Final: 2,
    '3rd Place': 2,
  };

  // Adjust for formats that start at SF or Final so col 0 is always leftmost.
  const minCol = Math.min(...nodes.map((n) => phaseCol[n.phase]));

  // Group by column
  const byCol = new Map<number, PlaceholderNode[]>();
  for (const n of nodes) {
    const col = phaseCol[n.phase] - minCol;
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(n);
  }

  const sortedCols = Array.from(byCol.keys()).sort((a, b) => a - b);

  // First column: evenly spaced from yBase (only non-3rd-place nodes in col 0)
  const firstColNodes = byCol.get(0) ?? [];
  // Filter 3rd place out of column 0 (it's always in the Final column)
  const firstColMain = firstColNodes.filter((n) => n.phase !== '3rd Place');
  firstColMain.forEach((n, i) => {
    positions.set(n.id, {
      x: xBase,
      y: yBase + i * (MATCH_HEIGHT + ROW_GAP),
    });
  });

  // Subsequent columns: position by midpoint of feeders
  for (let ci = 1; ci < sortedCols.length; ci++) {
    const col = sortedCols[ci]!;
    const colNodes = (byCol.get(col) ?? []).filter((n) => n.phase !== '3rd Place');
    let minY = yBase;
    const x = xBase + col * (MATCH_WIDTH + ROUND_GAP);

    for (const n of colNodes) {
      const feeders = nodes.filter((f) => f.nextId === n.id);
      let y: number;
      if (feeders.length > 0) {
        const feederYs = feeders.map((f) => positions.get(f.id)?.y ?? yBase);
        y = feederYs.reduce((s, v) => s + v, 0) / feederYs.length;
      } else {
        y = minY;
      }
      if (y < minY) y = minY;
      positions.set(n.id, { x, y });
      minY = y + MATCH_HEIGHT + ROW_GAP;
    }
  }

  // 3rd place match: same column as Final, directly below it
  const finalNode = nodes.find((n) => n.phase === 'Final');
  const thirdNode = nodes.find((n) => n.phase === '3rd Place');
  if (thirdNode && finalNode) {
    const finalPos = positions.get(finalNode.id);
    if (finalPos) {
      positions.set(thirdNode.id, {
        x: finalPos.x,
        y: finalPos.y + MATCH_HEIGHT + ROW_GAP,
      });
    }
  }

  return positions;
}

/**
 * Compute the full placeholder layout for all projected divisions.
 * For a single division (Swiss/Liechtenstein) the result is left-aligned.
 * For BaLi (multiple divisions) the divisions stack vertically like real matches
 * in computeBalancedPlayoffLayout — xBase is shifted right if there are swiss matches.
 */
export function computePlaceholderLayout(
  divisions: ProjectedDivision[],
  hasThirdPlace: boolean,
  /** x offset to position placeholders to the right of existing swiss matches */
  xBase = 0,
): PlaceholderLayout {
  const real = divisions.filter((d) => d.format !== 'NONE' && d.size >= 2);
  const positions = new Map<string, MatchPosition>();
  const allNodes: PlaceholderNode[] = [];
  const groups: PlaceholderLayout['groups'] = [];

  let yOffset = 0;

  real.forEach((div, i) => {
    const nodes = buildPlaceholderNodes(i, div.format, hasThirdPlace);
    const divPositions = placeholderLinearLayout(nodes, xBase, yOffset + DIVISION_LABEL_HEIGHT);
    for (const [id, pos] of divPositions) positions.set(id, pos);

    // Compute height of this division
    let maxY = yOffset + DIVISION_LABEL_HEIGHT;
    for (const pos of divPositions.values()) {
      const bottom = pos.y + MATCH_HEIGHT;
      if (bottom > maxY) maxY = bottom;
    }

    groups.push({
      nodeIds: nodes.map((n) => n.id),
      x: xBase,
      y: yOffset,
      label: real.length > 1 ? `Division ${i + 1}` : null,
      detail: `${div.format.replace('TOP', 'Top ')} · ${div.size} seeds`,
    });

    allNodes.push(...nodes);
    yOffset = maxY + SECTION_GAP;
  });

  // Compute bounding box
  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    if (pos.x + MATCH_WIDTH > maxX) maxX = pos.x + MATCH_WIDTH;
    if (pos.y + MATCH_HEIGHT > maxY) maxY = pos.y + MATCH_HEIGHT;
  }

  return { positions, nodes: allNodes, width: maxX - xBase, height: maxY, groups };
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
function computeBalancedPlayoffLayout(swiss: BracketNode[], playoff: BracketNode[], bandByUser?: Map<string, number>): BracketLayout {
  const positions = new Map<string, MatchPosition>();

  const swissLayout = computeLinearLayout(swiss, { xBase: 0, yBase: 0 });
  for (const [id, pos] of swissLayout.positions) positions.set(id, pos);

  const xBase = swissLayout.width > 0 ? swissLayout.width + SECTION_GAP : 0;

  // Order divisions by skill band, HIGHEST first (Top → Advanced → …) so the top division's
  // bracket is always on top. The old "earliest match number" heuristic assumed the top
  // division was generated first, which isn't guaranteed. A division's band = the highest band
  // among its players (same rule as the SVGBracket label). Falls back to match-number order
  // when band info is absent (keeps a deterministic tie-break).
  const divisionBand = (div: BracketNode[]): number => {
    let band = 0;
    for (const m of div) {
      for (const pid of [m.player1Id, m.player2Id]) {
        const b = pid ? bandByUser?.get(pid) : undefined;
        if (b && b > band) band = b;
      }
    }
    return band;
  };
  const divisions = groupPlayoffDivisions(playoff).sort((a, b) => {
    const byBand = divisionBand(b) - divisionBand(a); // highest band first
    if (byBand !== 0) return byBand;
    return Math.min(...a.map((m) => m.matchNumber)) - Math.min(...b.map((m) => m.matchNumber));
  });

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

export function computeBracketLayout(matches: BracketNode[], bandByUser?: Map<string, number>): BracketLayout {
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
      return computeBalancedPlayoffLayout(swiss, playoff, bandByUser);
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
