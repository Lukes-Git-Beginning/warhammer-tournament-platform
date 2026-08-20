import { randomUUID } from 'node:crypto';
import blossom from 'edmonds-blossom';
import type { MatchStatus } from '@rizzotto/db';

// ---------- Public interfaces ----------

export interface SwissPlayer {
  userId: string;
  score: number;
  avoid: string[];
  receivedBye: boolean;
  factionId?: string | null;
  /** B8: opponents this player must NEVER be re-paired with (no-contest / double-bye). */
  noContestAvoid?: string[];
}

export interface SwissMatchInput {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  status: MatchStatus;
  next_match_id: null;
  winner_id: string | null;
}

export interface SwissStanding {
  userId: string;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  gamesLost: number;
  buchholz: number;
  solkoff: number;  // buchholz minus the highest and lowest single opponent score
  opponentsBeaten: string[];
  dropped: boolean;
}

// ---------- Helpers ----------

/** Completed or BYE match input shape used for standings computation */
export interface CompletedMatchRecord {
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  status: string; // MatchStatus
  /** Games won by player1 in this match (for BO3/BO5 game-loss tiebreaker) */
  player1_game_wins?: number;
  /** Games won by player2 in this match (for BO3/BO5 game-loss tiebreaker) */
  player2_game_wins?: number;
}

// ---------- Min-weight pairing (B8) ----------
// Pairing is a minimum-cost perfect matching over the active players. Edge cost is
// tiered so the optimiser, globally (not greedily), prefers in order:
//   1. avoid no-contest re-pairs   (P_NOCONTEST)
//   2. avoid rematches             (P_REMATCH)
//   3. minimise (ΔScore)²          (SCALE_SCORE) — large gaps hurt quadratically
//   4. avoid faction mirrors       (P_MIRROR, pure tiebreaker)
// The ±1 score-group limit is gone: avoiding a rematch outranks score proximity.

const SCALE_SCORE = 100;
const P_MIRROR = 1;
const P_REMATCH = 10_000_000; // dominates any achievable score+mirror cost
const P_NOCONTEST = 100_000_000_000; // dominates any number of rematches

/** Deterministic PRNG shuffle (mulberry32) seeded from a string — reproducible tiebreaks. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
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

/**
 * Optional per-pair fairness surcharge (Faction War). Must stay BELOW the cost of one
 * 0.5-point score step (SCALE_SCORE = 100) so the Swiss score gap always outranks it — it
 * only breaks ties *within* a score group toward the more balanced faction matchup. In round 1
 * (all scores equal) every score term is 0, so fairness drives the whole pairing.
 */
export type FairnessCost = (a: SwissPlayer, b: SwissPlayer) => number;

function pairCost(a: SwissPlayer, b: SwissPlayer, fairnessCost?: FairnessCost): number {
  const dScaled = Math.round(Math.abs(a.score - b.score) * 2); // 0.5-point steps → integer
  let cost = dScaled * dScaled * SCALE_SCORE;
  const noContest =
    (a.noContestAvoid?.includes(b.userId) ?? false) ||
    (b.noContestAvoid?.includes(a.userId) ?? false);
  const rematch = a.avoid.includes(b.userId) || b.avoid.includes(a.userId);
  if (noContest) cost += P_NOCONTEST;
  else if (rematch) cost += P_REMATCH;
  if (a.factionId && b.factionId && a.factionId === b.factionId) cost += P_MIRROR;
  if (fairnessCost) cost += fairnessCost(a, b);
  return cost;
}

/** Minimum-cost perfect matching over an even-sized set (Edmonds blossom, max-weight). */
function pairByMinWeight(
  active: SwissPlayer[],
  fairnessCost?: FairnessCost,
): Array<[SwissPlayer, SwissPlayer]> {
  const n = active.length;
  if (n < 2) return [];
  if (n === 2) return [[active[0]!, active[1]!]];

  let maxCost = 0;
  const cost: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = pairCost(active[i]!, active[j]!, fairnessCost);
      cost[i]![j] = c;
      cost[j]![i] = c;
      if (c > maxCost) maxCost = c;
    }
  }
  // Offset so every weight is positive → max-weight matching == min-cost perfect matching.
  const K = maxCost + 1;
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push([i, j, K - cost[i]![j]!]);
    }
  }

  const mate = blossom(edges);
  const pairs: Array<[SwissPlayer, SwissPlayer]> = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const j = mate[i]!;
    if (j >= 0 && !seen.has(i) && !seen.has(j)) {
      seen.add(i);
      seen.add(j);
      pairs.push([active[i]!, active[j]!]);
    }
  }
  return pairs;
}

// ---------- Core functions ----------

/**
 * Generate one round of Swiss pairings.
 *
 * BYE: player2 === null → status=BYE, winner_id=player1.
 */
export function generateSwissRound(
  tournamentId: string,
  players: SwissPlayer[],
  round: number,
  fairnessCost?: FairnessCost,
): SwissMatchInput[] {
  let activePlayers = players;
  let byePlayer: SwissPlayer | null = null;

  // With an odd number of players, explicitly assign the Bye to the player
  // with the lowest score who hasn't received a Bye yet — so no top-scorer
  // slides into the playoffs on a free win.
  if (players.length % 2 === 1) {
    const eligible = players.filter((p) => !p.receivedBye);
    const pool = eligible.length > 0 ? eligible : players;
    const minScore = Math.min(...pool.map((p) => p.score));
    const tied = pool.filter((p) => p.score === minScore);
    byePlayer = tied[Math.floor(Math.random() * tied.length)] ?? null;
    if (byePlayer) {
      activePlayers = players.filter((p) => p.userId !== byePlayer!.userId);
    }
  }

  // Global minimum-cost perfect matching over the active players (B8). A seeded
  // shuffle makes tiebreaks reproducible for a given (tournament, round). This
  // replaces the greedy score-bucket pairer + cross-group fallback + the mirror
  // post-processor (mirror avoidance is now folded into the edge cost).
  const ordered = seededShuffle(activePlayers, `${tournamentId}:${round}`);
  const pairs = pairByMinWeight(ordered, fairnessCost);

  const result: SwissMatchInput[] = pairs.map(([a, b], idx) => ({
    id: randomUUID(),
    tournament_id: tournamentId,
    round,
    match_number: idx + 1,
    player1_id: a.userId,
    player2_id: b.userId,
    status: 'PENDING' as MatchStatus,
    next_match_id: null,
    winner_id: null,
  }));

  // Append the explicit Bye match for the pre-selected player
  if (byePlayer) {
    result.push({
      id: randomUUID(),
      tournament_id: tournamentId,
      round,
      match_number: result.length + 1,
      player1_id: byePlayer.userId,
      player2_id: null,
      status: 'BYE',
      next_match_id: null,
      winner_id: byePlayer.userId,
    });
  }

  result.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return result;
}

/**
 * Compute Swiss standings from all completed matches.
 *
 * Scoring: win=1, draw=0.5, loss=0, bye=1.
 * Tiebreaker: Buchholz (sum of opponents' scores).
 * Sorted: score desc, then buchholz desc.
 */
export function computeSwissStandings(
  participantIds: string[],
  completedMatches: CompletedMatchRecord[],
  withdrawnIds?: ReadonlySet<string>,
): SwissStanding[] {
  // Initialize per-player record
  const recordMap = new Map<
    string,
    { wins: number; losses: number; draws: number; byes: number; catchupByes: number; score: number; gamesLost: number; opponents: string[]; opponentsBeaten: string[] }
  >();

  for (const id of participantIds) {
    recordMap.set(id, { wins: 0, losses: 0, draws: 0, byes: 0, catchupByes: 0, score: 0, gamesLost: 0, opponents: [], opponentsBeaten: [] });
  }

  for (const match of completedMatches) {
    if (match.status !== 'COMPLETED' && match.status !== 'BYE' && match.status !== 'FORFEIT' && match.status !== 'NO_CONTEST' && match.status !== 'CATCHUP_BYE') continue;

    // CATCHUP_BYE: late-join placeholder — counts as a played round for depth/completeness
    // but scores 0 and pushes no opponent (0 Buchholz). It IS counted as a virtual 0-score
    // opponent for Solkoff (below) so a late joiner has the same opponent count as everyone
    // else — otherwise their Solkoff would be under-trimmed (an unfair advantage).
    if (match.status === 'CATCHUP_BYE') {
      const cbPlayer = match.player1_id ?? match.player2_id;
      if (cbPlayer && recordMap.has(cbPlayer)) recordMap.get(cbPlayer)!.catchupByes += 1;
      continue;
    }

    const p1 = match.player1_id;
    const p2 = match.player2_id;
    const winner = match.winner_id;

    if (match.status === 'BYE') {
      const byePlayer = p1 ?? p2;
      if (byePlayer && recordMap.has(byePlayer)) {
        const r = recordMap.get(byePlayer)!;
        r.byes += 1;
        r.score += 1;
      }
      continue;
    }

    // NO_CONTEST (B10): technical-abort double-bye — both players get a bye point
    // (1.0), counted as a bye, with no opponent (0 BH). The pair are not pushed to
    // each other's opponents, so this never feeds Buchholz.
    if (match.status === 'NO_CONTEST') {
      for (const pid of [p1, p2]) {
        if (pid && recordMap.has(pid)) {
          const r = recordMap.get(pid)!;
          r.byes += 1;
          r.score += 1;
        }
      }
      continue;
    }

    // FORFEIT: the match is awarded to the opponent as a bye-like win (no BH
    // contribution from the forfeiting player). B1: a forfeit does NOT itself mark
    // a player as dropped — "dropped" is derived from current WITHDREW status only,
    // so a match-drop keeps the player active in the standings.
    if (match.status === 'FORFEIT') {
      if (!p1 || !p2 || !winner) continue;
      const rWinner = recordMap.get(winner);
      if (rWinner) {
        rWinner.byes += 1;
        rWinner.score += 1;
        // Deliberately do NOT push the forfeiting player into rWinner.opponents —
        // FORFEIT is treated as a bye, so they contribute 0 BH.
      }
      continue;
    }

    if (!p1 || !p2) continue;

    const r1 = recordMap.get(p1);
    const r2 = recordMap.get(p2);

    if (r1) r1.opponents.push(p2);
    if (r2) r2.opponents.push(p1);

    // Track games lost per player (opponent's game wins in this match)
    const p1GameWins = match.player1_game_wins ?? (winner === p1 ? 1 : 0);
    const p2GameWins = match.player2_game_wins ?? (winner === p2 ? 1 : 0);
    if (r1) r1.gamesLost += p2GameWins;
    if (r2) r2.gamesLost += p1GameWins;

    if (winner === null) {
      if (r1) { r1.draws += 1; r1.score += 0.5; }
      if (r2) { r2.draws += 1; r2.score += 0.5; }
    } else if (winner === p1) {
      if (r1) { r1.wins += 1; r1.score += 1; r1.opponentsBeaten.push(p2); }
      if (r2) { r2.losses += 1; }
    } else if (winner === p2) {
      if (r2) { r2.wins += 1; r2.score += 1; r2.opponentsBeaten.push(p1); }
      if (r1) { r1.losses += 1; }
    }
  }

  // Compute Buchholz and Solkoff
  const standings: SwissStanding[] = [];
  for (const [userId, rec] of recordMap) {
    const oppScores = rec.opponents.map((oppId) => recordMap.get(oppId)?.score ?? 0);
    const buchholz = oppScores.reduce((s, v) => s + v, 0);

    // Solkoff (median Buchholz) = Buchholz minus the single highest and single lowest opponent
    // score. To keep it comparable across players, every non-played round (a real bye, a
    // NO_CONTEST double-bye, a forfeit-win, a catch-up bye) counts as a virtual 0-score
    // opponent — so a player with byes has the same opponent count as everyone else and always
    // drops one top + one bottom (a bye's 0 is usually the bottom). The padded zeros add nothing
    // to Buchholz. With fewer than 2 opponents nothing survives the trim, so Solkoff is 0.
    const solkoffScores = oppScores.concat(new Array(rec.byes + rec.catchupByes).fill(0));
    let solkoff = 0;
    if (solkoffScores.length >= 2) {
      const sorted = [...solkoffScores].sort((a, b) => a - b);
      solkoff = buchholz - sorted[0]! - sorted[sorted.length - 1]!;
    }

    standings.push({
      userId,
      score: rec.score,
      wins: rec.wins,
      losses: rec.losses,
      draws: rec.draws,
      byes: rec.byes,
      gamesLost: rec.gamesLost,
      buchholz,
      solkoff,
      opponentsBeaten: rec.opponentsBeaten,
      dropped: withdrawnIds?.has(userId) ?? false,
    });
  }

  standings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.gamesLost - b.gamesLost; // fewer games lost = better
  });

  return standings;
}

/**
 * Post-processing: for each mirror pair (same faction), try a local swap with
 * another pair in the same round. A swap is accepted only when neither pair's
 * individual score delta increases, neither new pair is a rematch (avoid
 * lists), and neither new pair is itself a mirror. Priority order per
 * ROADMAP: score delta > rematch avoidance > mirror avoidance.
 *
 * Mutates `matches` in-place; returns void. Exported for direct unit testing.
 */
export function tryAvoidMirrors(matches: SwissMatchInput[], players: SwissPlayer[]): void {
  const factionById = new Map<string, string>();
  for (const p of players) {
    if (p.factionId) factionById.set(p.userId, p.factionId);
  }
  if (factionById.size === 0) return;

  const scoreById = new Map(players.map((p) => [p.userId, p.score]));
  const avoidById = new Map(players.map((p) => [p.userId, new Set(p.avoid)]));
  const pending = matches.filter((m) => m.status === 'PENDING');

  const isRematch = (x: string, y: string) =>
    (avoidById.get(x)?.has(y) ?? false) || (avoidById.get(y)?.has(x) ?? false);
  const isMirror = (x: string, y: string) => {
    const fx = factionById.get(x);
    return fx !== undefined && fx === factionById.get(y);
  };

  for (const m1 of pending) {
    if (!m1.player1_id || !m1.player2_id) continue;

    const a = m1.player1_id;
    const b = m1.player2_id;
    if (!isMirror(a, b)) continue;

    const sa = scoreById.get(a) ?? 0;
    const sb = scoreById.get(b) ?? 0;
    const delta1 = Math.abs(sa - sb);

    const start = pending.indexOf(m1) + 1;
    for (let j = start; j < pending.length; j++) {
      const m2 = pending[j];
      if (!m2 || !m2.player1_id || !m2.player2_id) continue;

      const c = m2.player1_id;
      const d = m2.player2_id;
      const sc = scoreById.get(c) ?? 0;
      const sd = scoreById.get(d) ?? 0;
      const delta2 = Math.abs(sc - sd);

      // Try (A,C) + (B,D): swap player2 of m1 with player1 of m2
      if (
        Math.abs(sa - sc) <= delta1 &&
        Math.abs(sb - sd) <= delta2 &&
        !isMirror(a, c) &&
        !isMirror(b, d) &&
        !isRematch(a, c) &&
        !isRematch(b, d)
      ) {
        m1.player2_id = c;
        m2.player1_id = b;
        break;
      // Try (A,D) + (B,C): swap player2 of m1 with player2 of m2
      } else if (
        Math.abs(sa - sd) <= delta1 &&
        Math.abs(sb - sc) <= delta2 &&
        !isMirror(a, d) &&
        !isMirror(b, c) &&
        !isRematch(a, d) &&
        !isRematch(b, c)
      ) {
        m1.player2_id = d;
        m2.player2_id = b;
        break;
      }
    }
  }
}

/**
 * Recommend the number of Swiss rounds for a given participant count.
 * Formula: Math.ceil(log2(n)), clamped to [3, 7].
 */
export function recommendNumberOfRounds(participantCount: number): number {
  if (participantCount < 2) return 3;
  const raw = Math.ceil(Math.log2(participantCount));
  return Math.min(7, Math.max(3, raw));
}

/**
 * Multi-level tiebreaker sort for Swiss standings.
 *
 * Priority:
 *   1. score desc
 *   2. buchholz desc  (sum of all opponents' scores)
 *   3. gamesLost asc  (fewer individual games lost = better)
 *   4. solkoff desc   (buchholz minus highest + lowest opponent score)
 *   5. head-to-head   (direct match winner if exactly 2 players remain tied)
 *
 * @param standings  Pre-computed standings (output of computeSwissStandings).
 * @param allMatches All completed matches for the tournament (used for H2H lookup).
 * @returns A new array sorted with the full tiebreaker hierarchy.
 */
/**
 * Stable 32-bit FNV-1a hash of a string → a deterministic pseudo-random ordering
 * key. Used as the final Swiss tiebreak so a total tie resolves reproducibly
 * (and independently of array order) rather than by arbitrary insertion order.
 */
function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @param seed  Per-tournament salt (the tournament id) mixed into the final
 *   tiebreak hash, so a total tie is a fresh, reproducible "coin flip" for THIS
 *   tournament rather than a fixed per-player bias across every tournament.
 */
export function sortSwissStandings(
  standings: SwissStanding[],
  allMatches: CompletedMatchRecord[],
  seed = '',
): SwissStanding[] {
  // Build a head-to-head winner lookup: "playerA|playerB" → winner userId
  const h2hMap = new Map<string, string | null>();
  for (const m of allMatches) {
    if (m.status !== 'COMPLETED') continue;
    if (!m.player1_id || !m.player2_id) continue;
    const key = [m.player1_id, m.player2_id].sort().join('|');
    // Last match result wins if they played more than once (shouldn't happen in Swiss)
    h2hMap.set(key, m.winner_id);
  }

  const getH2HWinner = (a: string, b: string): string | null => {
    const key = [a, b].sort().join('|');
    return h2hMap.get(key) ?? null;
  };

  return [...standings].sort((a, b) => {
    // Dropped players always sort to the bottom
    if (a.dropped !== b.dropped) return a.dropped ? 1 : -1;
    // 1. score
    if (b.score !== a.score) return b.score - a.score;
    // 2. buchholz
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    // 3. games lost asc (fewer = better)
    if (a.gamesLost !== b.gamesLost) return a.gamesLost - b.gamesLost;
    // 4. solkoff
    if (b.solkoff !== a.solkoff) return b.solkoff - a.solkoff;
    // 5. head-to-head (only meaningful when exactly 2 players are compared here)
    const winner = getH2HWinner(a.userId, b.userId);
    if (winner === a.userId) return -1;
    if (winner === b.userId) return 1;
    // 6. Deterministic final tiebreak — a stable pseudo-random order from a hash
    // of the tournament seed + each player's id, so a total tie (equal score/BH/
    // gamesLost/solkoff and no head-to-head) resolves as a fresh, reproducible
    // per-tournament coin flip instead of by arbitrary array order.
    const ha = hashId(`${seed}:${a.userId}`);
    const hb = hashId(`${seed}:${b.userId}`);
    if (ha !== hb) return ha - hb;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}
