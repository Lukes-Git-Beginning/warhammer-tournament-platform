import { randomUUID } from 'node:crypto';
import { RoundRobin } from 'tournament-pairings';
import type { MatchStatus } from '@rizzotto/db';

export interface LiechtensteinMatchInput {
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

/**
 * Generate a pre-randomised schedule for a Liechtenstein-format tournament.
 *
 * All rounds are generated up-front at tournament start (like Round Robin),
 * but only `rounds` of them are kept (configurable, like Swiss).
 * The underlying Round-Robin algorithm guarantees no rematches within the
 * selected rounds as long as rounds <= n-1 (even player count) or rounds <= n
 * (odd player count with BYE).
 *
 * Throws when rounds exceed the rematch-free maximum for the given player count.
 */
export function generateLiechtensteinSchedule(
  tournamentId: string,
  participantIds: string[],
  rounds: number,
): LiechtensteinMatchInput[] {
  const n = participantIds.length;
  const maxRounds = n % 2 === 0 ? n - 1 : n;
  if (rounds > maxRounds) {
    throw new Error(
      `Zu wenig Spieler (${n}) für ${rounds} Runden ohne Rematch — maximal ${maxRounds} möglich`,
    );
  }

  // Randomise player order so pairings are not predictable
  const shuffled = [...participantIds].sort(() => Math.random() - 0.5);

  // Full round-robin schedule (guarantees unique pairings per round)
  const allRounds = RoundRobin(shuffled, 1, true);

  // Group by round, keep only the first `rounds` rounds
  const byRound = new Map<number, typeof allRounds>();
  for (const m of allRounds) {
    if (m.round > rounds) continue;
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  const result: LiechtensteinMatchInput[] = [];

  for (const [round, roundMatches] of byRound) {
    roundMatches.sort((a, b) => a.match - b.match);
    roundMatches.forEach((m, idx) => {
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
  }

  result.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return result;
}
