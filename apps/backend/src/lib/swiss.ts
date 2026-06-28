import { randomUUID } from 'node:crypto';
import { Swiss as SwissPair } from 'tournament-pairings';
import type { MatchStatus } from '@rizzotto/db';

// ---------- Public interfaces ----------

export interface SwissPlayer {
  userId: string;
  score: number;
  avoid: string[];
  receivedBye: boolean;
  factionId?: string | null;
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

  // Build the player list and shuffle within each score group so that pairing
  // within a group is random rather than standings-order (Buchholz) biased.
  // The group boundaries are preserved — 2-point players always pair within
  // their group, etc. — only the internal order is randomised.
  const libPlayers = (() => {
    const raw = activePlayers.map((p) => ({
      id: p.userId,
      score: p.score,
      avoid: p.avoid,
      receivedBye: p.receivedBye,
    }));
    const out: typeof raw = [];
    let i = 0;
    while (i < raw.length) {
      let j = i;
      while (j < raw.length && raw[j]!.score === raw[i]!.score) j++;
      const group = raw.slice(i, j);
      for (let k = group.length - 1; k > 0; k--) {
        const r = Math.floor(Math.random() * (k + 1));
        [group[k], group[r]] = [group[r]!, group[k]!];
      }
      out.push(...group);
      i = j;
    }
    return out;
  })();

  const scoreById = new Map(activePlayers.map((p) => [p.userId, p.score]));
  const hasLargeGap = (matches: ReturnType<typeof SwissPair>) =>
    matches.some((m) => {
      if (!m.player1 || !m.player2) return false;
      return Math.abs((scoreById.get(String(m.player1)) ?? 0) - (scoreById.get(String(m.player2)) ?? 0)) > 1;
    });

  let rawMatches = SwissPair(libPlayers, round, false, false);

  // If the library produced a cross-group pairing (score gap > 1) due to avoid
  // constraints, retry without avoid lists. A rematch is less bad than a
  // 2-point score-group violation.
  if (hasLargeGap(rawMatches)) {
    rawMatches = SwissPair(libPlayers.map((p) => ({ ...p, avoid: [] })), round, false, false);
  }

  const result: SwissMatchInput[] = [];

  rawMatches.forEach((m, idx) => {
    const p1 = typeof m.player1 === 'string' ? m.player1 : null;
    const p2 = typeof m.player2 === 'string' ? m.player2 : null;

    const hasBye = (p1 !== null && p2 === null) || (p1 === null && p2 !== null);
    const status: MatchStatus = hasBye ? 'BYE' : 'PENDING';
    const winner_id: string | null = hasBye ? (p1 ?? p2) : null;

    result.push({
      id: randomUUID(),
      tournament_id: tournamentId,
      round,
      match_number: idx + 1,
      player1_id: p1,
      player2_id: p2,
      status,
      next_match_id: null,
      winner_id,
    });
  });

  tryAvoidMirrors(result, activePlayers);

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
    { wins: number; losses: number; draws: number; byes: number; score: number; gamesLost: number; opponents: string[]; opponentsBeaten: string[] }
  >();

  for (const id of participantIds) {
    recordMap.set(id, { wins: 0, losses: 0, draws: 0, byes: 0, score: 0, gamesLost: 0, opponents: [], opponentsBeaten: [] });
  }

  for (const match of completedMatches) {
    if (match.status !== 'COMPLETED' && match.status !== 'BYE' && match.status !== 'FORFEIT' && match.status !== 'NO_CONTEST') continue;

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

    let solkoff = buchholz;
    if (oppScores.length >= 3) {
      const sorted = [...oppScores].sort((a, b) => a - b);
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
export function sortSwissStandings(
  standings: SwissStanding[],
  allMatches: CompletedMatchRecord[],
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
    return 0;
  });
}
