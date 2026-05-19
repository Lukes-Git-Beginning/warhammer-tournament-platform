import { randomUUID } from 'node:crypto';
import { Swiss as SwissPair } from 'tournament-pairings';
import type { MatchStatus } from '@rizzotto/db';

// ---------- Public interfaces ----------

export interface SwissPlayer {
  userId: string;
  score: number;
  avoid: string[];
  receivedBye: boolean;
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
  buchholz: number;
  solkoff: number;  // buchholz minus the highest and lowest single opponent score
  opponentsBeaten: string[];
}

// ---------- Helpers ----------

/** Completed or BYE match input shape used for standings computation */
export interface CompletedMatchRecord {
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  status: string; // MatchStatus
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
  const libPlayers = players.map((p) => ({
    id: p.userId,
    score: p.score,
    avoid: p.avoid,
    receivedBye: p.receivedBye,
  }));

  const libMatches = SwissPair(libPlayers, round, false, false);

  const result: SwissMatchInput[] = [];

  libMatches.forEach((m, idx) => {
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
): SwissStanding[] {
  // Initialize per-player record
  const recordMap = new Map<
    string,
    { wins: number; losses: number; draws: number; byes: number; score: number; opponents: string[]; opponentsBeaten: string[] }
  >();

  for (const id of participantIds) {
    recordMap.set(id, { wins: 0, losses: 0, draws: 0, byes: 0, score: 0, opponents: [], opponentsBeaten: [] });
  }

  for (const match of completedMatches) {
    // Only process completed or BYE matches
    if (match.status !== 'COMPLETED' && match.status !== 'BYE') continue;

    const p1 = match.player1_id;
    const p2 = match.player2_id;
    const winner = match.winner_id;

    if (match.status === 'BYE') {
      // Bye: one player gets free win
      const byePlayer = p1 ?? p2;
      if (byePlayer && recordMap.has(byePlayer)) {
        const r = recordMap.get(byePlayer)!;
        r.byes += 1;
        r.score += 1;
        r.wins += 1;
      }
      continue;
    }

    if (!p1 || !p2) continue;

    const r1 = recordMap.get(p1);
    const r2 = recordMap.get(p2);

    if (r1) r1.opponents.push(p2);
    if (r2) r2.opponents.push(p1);

    if (winner === null) {
      // Draw
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

  // Compute Buchholz (sum of all opponent scores) and Solkoff (Buchholz minus
  // the single highest and single lowest opponent score).
  const standings: SwissStanding[] = [];
  for (const [userId, rec] of recordMap) {
    const oppScores = rec.opponents.map((oppId) => recordMap.get(oppId)?.score ?? 0);
    const buchholz = oppScores.reduce((s, v) => s + v, 0);

    let solkoff = buchholz;
    if (oppScores.length >= 3) {
      // Remove the single highest and the single lowest opponent score
      const sorted = [...oppScores].sort((a, b) => a - b);
      solkoff = buchholz - sorted[0]! - sorted[sorted.length - 1]!;
    }
    // With 0–2 opponents, solkoff === buchholz (not enough data to trim)

    standings.push({
      userId,
      score: rec.score,
      wins: rec.wins,
      losses: rec.losses,
      draws: rec.draws,
      byes: rec.byes,
      buchholz,
      solkoff,
      opponentsBeaten: rec.opponentsBeaten,
    });
  }

  standings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.buchholz - a.buchholz;
  });

  return standings;
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
 *   3. solkoff desc   (buchholz minus highest + lowest opponent score)
 *   4. head-to-head   (direct match winner if exactly 2 players remain tied)
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
    // 1. score
    if (b.score !== a.score) return b.score - a.score;
    // 2. buchholz
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    // 3. solkoff
    if (b.solkoff !== a.solkoff) return b.solkoff - a.solkoff;
    // 4. head-to-head (only meaningful when exactly 2 players are compared here)
    const winner = getH2HWinner(a.userId, b.userId);
    if (winner === a.userId) return -1; // a wins → a ranks higher
    if (winner === b.userId) return 1;  // b wins → b ranks higher
    // Fully tied — preserve stable order (no swap)
    return 0;
  });
}
