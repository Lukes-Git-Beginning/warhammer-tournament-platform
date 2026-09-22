// ---------------------------------------------------------------------------
// Liechtenstein ASAP pairing planner (2026-09).
//
// A hybrid of Swiss (score-based pairing) and BaLi (ASAP / free-when-your-match-
// ends). On every pairing tick this decides which currently-FREE players to pair
// RIGHT NOW, whom to HOLD (wait for a better/available opponent), and whom to BYE.
//
// Design (per spec, aligned with Swiss swiss.ts):
//   - Score = current Swiss points. Pair equal scores, top-down; a score gap is
//     penalised quadratically.
//   - Rematches and NO_CONTEST re-pairs are AVOIDED VIA COST, not hard-excluded
//     (Swiss model): P_NOCONTEST > P_REMATCH > score > free-preference > mirror. A
//     pair is therefore only re-matched as a genuine last resort — but it CAN be, so
//     a shrinking field never strands a player on a forced bye. Byes happen only for
//     a true odd-one-out (odd parity), never because a player "ran out of" opponents.
//   - ASAP: realise a pairing as soon as BOTH players are free — in any order. A
//     waiting player takes the first *permissible* free opponent.
//
// How ASAP falls out of one matching:
//   Nodes = ALL players still needing a match (free AND in-progress) so parity is
//   correct. Every pair is an edge (rematch / no-contest are costs, not missing
//   edges). A max-weight matching with a cardinality-dominant offset yields the plan
//   that pairs the most players (fewest byes), then the lowest total cost (avoid
//   no-contest, then rematch, then score gap). We realise only the free-free pairs
//   and hold the rest; re-run on every free-up (the tick) so held players are picked
//   up the moment a permissible partner frees.
// ---------------------------------------------------------------------------

import blossom from 'edmonds-blossom';

/** SCALE for a 0.5-point score step, squared — mirrors Swiss (swiss.ts). */
const SCALE_SCORE = 100;
/** Rematch avoidance — dominates any achievable score + free + mirror cost, so a rematch is only
 *  taken when it is the sole way to pair a player (never as a mere score convenience). Mirrors Swiss. */
const P_REMATCH = 10_000_000;
/** No-contest re-pair avoidance — a voided (technical-abort) match. Dominates P_REMATCH: a no-contest
 *  pair is the ABSOLUTE last two who should meet again, avoided even more strongly than a rematch, but
 *  still permitted as a final resort rather than stranding a player. Mirrors Swiss P_NOCONTEST. */
const P_NOCONTEST = 100_000_000_000;
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
  /** Opponent ids this player has already played — strongly avoided (P_REMATCH), not hard-excluded. */
  played: ReadonlySet<string>;
  /** Opponent ids this player had a NO_CONTEST (voided) match with — avoided even more strongly
   *  (P_NOCONTEST) than a rematch, but still permitted as an absolute last resort. */
  noContest?: ReadonlySet<string>;
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
  /** Free players to BYE now — a genuine odd-one-out with no in-progress partner to wait for. */
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

function isNoContest(a: LPlayer, b: LPlayer): boolean {
  return (a.noContest?.has(b.id) ?? false) || (b.noContest?.has(a.id) ?? false);
}

function edgeCost(a: LPlayer, b: LPlayer): number {
  const dScaled = Math.round(Math.abs(a.score - b.score) * 2); // 0.5-point steps → integer
  let cost = dScaled * dScaled * SCALE_SCORE;
  // A no-contest re-pair is worse than a rematch; a rematch is worse than any score gap. Mirrors Swiss.
  if (isNoContest(a, b)) cost += P_NOCONTEST;
  else if (a.played.has(b.id) || b.played.has(a.id)) cost += P_REMATCH;
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

  // Could this free player still be paired once an in-progress player frees? With cost-based (not
  // hard) rematch avoidance every in-progress player is a permissible future partner, so waiting is
  // pointless only when NObody is still in-progress — then a lone free player is the odd-one-out → bye.
  const canWaitForFuturePartner = (p: LPlayer): boolean =>
    players.some((q) => !q.free && q.id !== p.id);

  if (players.length === 1) {
    const p = players[0]!;
    if (!p.free) return empty; // in-progress → nothing to do this tick
    return canWaitForFuturePartner(p) ? { pairs: [], byes: [], held: [p.id] } : { pairs: [], byes: [p.id], held: [] };
  }

  // Deterministic node order → reproducible blossom tiebreaks.
  const nodes = seededShuffle(players, seed);
  const n = nodes.length;

  // Every pair is a valid edge — rematch / no-contest are COSTS (Swiss model), not exclusions, so no
  // player is ever stranded. Track the max single-edge cost for the cardinality-dominant offset.
  let maxCost = 0;
  const rawEdges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = edgeCost(nodes[i]!, nodes[j]!);
      if (c > maxCost) maxCost = c;
      rawEdges.push([i, j, c]);
    }
  }

  // Max-weight matching with a cardinality-dominant offset: weight = BIG − cost, BIG large enough
  // that any extra edge (one more player paired) always beats any cost saving → maximise cardinality
  // (fewest byes) first, then minimise total cost. Odd parity leaves exactly one node unmatched.
  const BIG = (maxCost + 1) * n + 1;
  const edges: Array<[number, number, number]> = rawEdges.map(([i, j, c]) => [i, j, BIG - c]);
  const mate: number[] = blossom(edges);

  const pairs: Array<[string, string]> = [];
  const held: string[] = [];
  const byes: string[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const j = mate[i]!;
    const a = nodes[i]!;
    if (j < 0 || j === undefined) {
      // The odd-one-out this tick. A free player waits if any in-progress player could still free
      // (they'll be paired next tick); with everyone free it is a genuine bye.
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
