import { randomUUID } from 'node:crypto';
import { RoundRobin } from 'tournament-pairings';
import type { MatchStatus } from '@rizzotto/db';

export interface RoundRobinMatchInput {
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
 * Generate all rounds for a Round-Robin or Double-Round-Robin tournament.
 *
 * For DRR: generates a second leg where player1/player2 are swapped,
 * starting at round = (firstLegRounds + 1).
 *
 * BYE: player2 === null → status=BYE, winner_id=player1 (auto-win).
 * Returns matches sorted by (round, match_number).
 */
export function generateRoundRobin(
  tournamentId: string,
  participantIds: string[],
  double: boolean,
): RoundRobinMatchInput[] {
  const firstLeg = RoundRobin(participantIds, 1, true);
  const firstLegRounds = firstLeg.length > 0 ? Math.max(...firstLeg.map((m) => m.round)) : 0;

  const allLibMatches = double
    ? [
        ...firstLeg,
        ...RoundRobin(participantIds, firstLegRounds + 1, true).map((m) => ({
          ...m,
          // Swap player1/player2 for the second leg (home/away reversal)
          player1: m.player2,
          player2: m.player1,
        })),
      ]
    : firstLeg;

  // Group by round to assign sequential match_number per round
  const byRound = new Map<number, typeof allLibMatches>();
  for (const m of allLibMatches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  const result: RoundRobinMatchInput[] = [];

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
