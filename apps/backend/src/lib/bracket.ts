import { randomUUID } from 'node:crypto';
import { SingleElimination } from 'tournament-pairings';
import type { MatchStatus } from '@rizzotto/db';

export interface BracketMatchInput {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  status: MatchStatus;
  next_match_id: string | null;
  winner_id: string | null;
}

/**
 * Generate a single-elimination bracket from a list of participant IDs.
 *
 * Seeding: order as delivered (caller may shuffle beforehand).
 * BYE-handling:
 *   - Exactly one player set → status=BYE, winner_id=that player.
 *   - Both null → status=PENDING (empty feeder slot).
 *   - BYE winners are propagated into the next match during generation.
 *
 * Returns matches sorted by (round, match_number).
 */
export function generateSingleElim(
  tournamentId: string,
  participantIds: string[],
): BracketMatchInput[] {
  const libMatches = SingleElimination(participantIds, 1, false, true);

  // First pass: assign UUIDs keyed by (round, match) for cross-referencing.
  const idMap = new Map<string, string>();
  for (const m of libMatches) {
    idMap.set(`${m.round}:${m.match}`, randomUUID());
  }

  // Second pass: build mutable output objects so BYE-propagation can mutate them.
  const outputMap = new Map<string, BracketMatchInput>();

  for (const m of libMatches) {
    const key = `${m.round}:${m.match}`;
    const id = idMap.get(key)!;
    const nextKey = m.win ? `${m.win.round}:${m.win.match}` : null;
    const next_match_id = nextKey ? (idMap.get(nextKey) ?? null) : null;

    const p1 = typeof m.player1 === 'string' ? m.player1 : null;
    const p2 = typeof m.player2 === 'string' ? m.player2 : null;

    let status: MatchStatus = 'PENDING';
    let winner_id: string | null = null;

    const hasBye = (p1 !== null && p2 === null) || (p1 === null && p2 !== null);
    if (hasBye) {
      status = 'BYE';
      winner_id = p1 ?? p2;
    }

    outputMap.set(key, {
      id,
      tournament_id: tournamentId,
      round: m.round,
      match_number: m.match,
      player1_id: p1,
      player2_id: p2,
      status,
      next_match_id,
      winner_id,
    });
  }

  // Third pass: propagate BYE winners into the appropriate slot of the next match.
  // Convention for which slot to fill in the next match:
  //   odd match_number  → player1 slot
  //   even match_number → player2 slot
  for (const m of libMatches) {
    const key = `${m.round}:${m.match}`;
    const entry = outputMap.get(key)!;

    if (entry.status === 'BYE' && entry.winner_id !== null && m.win) {
      const nextKey = `${m.win.round}:${m.win.match}`;
      const nextEntry = outputMap.get(nextKey);
      if (nextEntry) {
        // Place the BYE winner in the free slot of the target match.
        if (nextEntry.player1_id === null) {
          nextEntry.player1_id = entry.winner_id;
        } else if (nextEntry.player2_id === null) {
          nextEntry.player2_id = entry.winner_id;
        }
        // Recalculate BYE status for the target match after propagation.
        const np1 = nextEntry.player1_id;
        const np2 = nextEntry.player2_id;
        if ((np1 !== null && np2 === null) || (np1 === null && np2 !== null)) {
          nextEntry.status = 'BYE';
          nextEntry.winner_id = np1 ?? np2;
        }
        // If both slots are now filled, it's a real match.
        if (np1 !== null && np2 !== null && nextEntry.status === 'BYE') {
          nextEntry.status = 'PENDING';
          nextEntry.winner_id = null;
        }
      }
    }
  }

  const result = Array.from(outputMap.values());
  result.sort((a, b) => a.round - b.round || a.match_number - b.match_number);
  return result;
}
