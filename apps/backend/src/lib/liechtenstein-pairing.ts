// ---------------------------------------------------------------------------
// Liechtenstein ASAP pairing planner (2026-09).
//
// A hybrid of Swiss (score-based pairing) and BaLi (ASAP / free-when-your-match-
// ends). On every pairing tick this decides which currently-FREE players to pair
// RIGHT NOW, whom to HOLD (wait for a better/available opponent), and whom to BYE.
//
// Design (per spec):
//   - Score = current Swiss points. Pair equal scores, top-down; a score gap is
//     penalised quadratically (same as Swiss).
//   - Rematches are HARD-excluded — not a cost, the edge simply does not exist, so
//     a pair can NEVER meet twice (a bye is taken instead if unavoidable).
//   - Optimality invariant: the matches created so far + still to create must always
//     be completable into a globally optimal (min total score-gap) plan. So the
//     number of cross-score pairings never exceeds the forced minimum.
//   - ASAP: within that invariant, realise a pairing as soon as BOTH players are free
//     — in any order. A waiting player takes the first *permissible* free opponent.
//
// How the invariant + ASAP fall out of one matching:
//   Nodes = ALL players still needing a match (free AND in-progress) so parity/
//   budget are correct. Edge cost = scoreGap²·SCALE (primary) + FREE_PENALTY if the
//   edge touches an in-progress player (tiny tiebreak → among equally-score-optimal
//   plans, prefer the one that pairs the MOST currently-free players) + mirror. A
//   max-weight matching (cardinality-dominant offset) then yields the optimal plan
//   that realises the most free-free pairs; we create only the free-free edges and
//   hold the rest. Re-run on every free-up (the tick) → held players are reclaimed
//   the moment a permissible partner frees.
// ---------------------------------------------------------------------------

import blossom from 'edmonds-blossom';

/** SCALE for a 0.5-point score step, squared — mirrors Swiss (swiss.ts). */
const SCALE_SCORE = 100;
/** Tiebreak: an edge touching an in-progress player costs this. MUST be < SCALE_SCORE
 *  (one score step) so score proximity always outranks it — it only decides *among
 *  equally score-optimal* plans, steering toward pairing currently-free players. */
const FREE_PENALTY = 10;
/** Faction-mirror avoidance — pure tiebreak below FREE_PENALTY (like Swiss P_MIRROR). */
const P_MIRROR = 1;

export interface LPlayer {
  /** Opaque competitor id (user for 1v1, team for 2v2) — the pairing engine is identity-agnostic. */
  id: string;
  /** Current Swiss points. */
  score: number;
  /** Opponent ids this player has ALREADY played — hard-excluded from re-pairing. */
  played: ReadonlySet<string>;
  /** True when the player is available to be paired NOW (finished their last match, needs another). */
  free: boolean;
  /** Already received a bye — deprioritised for a further bye. */
  receivedBye: boolean;
  /** Optional faction id for mirror-avoidance tiebreak. */
  factionId?: string | null;
}

export interface LPlan {
  /** Pairs to CREATE now — both players are free. `[a, b]`. */
  pairs: Array<[string, string]>;
  /** Free players to BYE now — no non-rematch partner exists at all (dead-end). */
  byes: string[];
  /** Free players to HOLD — their optimal partner is still in-progress; reclaim next tick. */
  held: string[];
}

/** Deterministic PRNG shuffle (mulberry32) seeded from a string — reproducible tiebreaks. */
function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function isRematch(a: LPlayer, b: LPlayer): boolean {
  return a.played.has(b.id) || b.played.has(a.id);
}

function edgeCost(a: LPlayer, b: LPlayer): number {
  const dScaled = Math.round(Math.abs(a.score - b.score) * 2); // 0.5-point steps → integer
  let cost = dScaled * dScaled * SCALE_SCORE;
  if (!(a.free && b.free)) cost += FREE_PENALTY; // steer toward pairing currently-free players
  if (a.factionId && b.factionId && a.factionId === b.factionId) cost += P_MIRROR;
  return cost;
}

/**
 * Plan the pairings for one ASAP tick over the players still needing a match.
 *
 * @param players  Every player still needing a match this "round" — free AND in-progress.
 * @param seed     Per-(tournament) salt for reproducible tiebreaks.
 */
export function planLiechtensteinPairings(players: readonly LPlayer[], seed: string): LPlan {
  const empty: LPlan = { pairs: [], byes: [], held: [] };
  if (players.length === 0) return empty;

  // A free player with NO non-rematch partner anywhere in the field is a genuine dead-end → bye.
  // (Check BEFORE matching so a forced bye is never mistaken for a hold.)
  const hasAnyValidPartner = (p: LPlayer): boolean =>
    players.some((q) => q.id !== p.id && !isRematch(p, q));

  const deadEndByes: string[] = [];
  const matchable = players.filter((p) => {
    if (!hasAnyValidPartner(p)) {
      if (p.free) deadEndByes.push(p.id); // only a free player is byed now; a busy one byes when it frees
      return false;
    }
    return true;
  });

  if (matchable.length < 2) {
    // Nothing to match — the lone matchable free player (if any) simply waits (held).
    const held = matchable.filter((p) => p.free).map((p) => p.id);
    return { pairs: [], byes: deadEndByes, held };
  }

  // Deterministic node order → reproducible blossom tiebreaks.
  const nodes = seededShuffle(matchable, seed);
  const n = nodes.length;

  // Build edges for non-rematch pairs only (hard exclusion). Track max cost for the offset.
  let maxCost = 0;
  const rawEdges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (isRematch(a, b)) continue; // hard rematch exclusion → no edge
      const c = edgeCost(a, b);
      if (c > maxCost) maxCost = c;
      rawEdges.push([i, j, c]);
    }
  }

  // Max-weight matching with a cardinality-dominant offset: weight = BIG − cost, BIG large enough
  // that any extra edge (more players paired) always beats any cost saving → maximise cardinality
  // first, then minimise total cost. Missing edges (rematches) can leave nodes unmatched (mate=-1).
  const BIG = (maxCost + 1) * n + 1;
  const edges: Array<[number, number, number]> = rawEdges.map(([i, j, c]) => [i, j, BIG - c]);
  const mate: number[] = blossom(edges);

  const pairs: Array<[string, string]> = [];
  const held: string[] = [];
  const byes: string[] = [...deadEndByes];
  const seen = new Set<number>();

  // Could this free player still be paired once an in-progress player frees? Only if some
  // in-progress player exists whom they have NOT already played. If not (e.g. odd field with
  // everyone free), waiting is pointless → they take a bye now (Swiss-style odd-one-out).
  const canWaitForFuturePartner = (p: LPlayer): boolean =>
    players.some((q) => !q.free && q.id !== p.id && !isRematch(p, q));

  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const j = mate[i]!;
    const a = nodes[i]!;
    if (j < 0) {
      // Unmatched this tick (odd-one-out or all partners better used elsewhere). A free player
      // waits only if a future free-up could still pair them — otherwise they bye now.
      if (a.free) (canWaitForFuturePartner(a) ? held : byes).push(a.id);
      seen.add(i);
      continue;
    }
    seen.add(i);
    seen.add(j);
    const b = nodes[j]!;
    if (a.free && b.free) {
      pairs.push([a.id, b.id]); // both free → create the match now
    } else {
      // The matched pair includes an in-progress player → the free one(s) wait.
      if (a.free) held.push(a.id);
      if (b.free) held.push(b.id);
    }
  }

  return { pairs, byes, held };
}
