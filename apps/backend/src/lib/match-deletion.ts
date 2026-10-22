import type { FastifyInstance } from 'fastify';
import { emitBracketUpdate } from './emit.js';
import { recordTournamentEvent, type TournamentEventActor } from './tournament-events.js';
import { runBalancedPairingTick } from './balanced-liechtenstein-service.js';
import { runLiechtensteinPairingTick } from './liechtenstein-service.js';

export interface DeletedMatch {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  status: string;
  player1_id: string | null;
  player2_id: string | null;
}

/**
 * Follow-up after a host or admin soft-deletes a tournament match: log it, push the bracket to
 * viewers and let the ASAP engines re-pair the freed players right away instead of on the next
 * reconciler minute. Each tick is a no-op for other formats. Fire-and-forget, never throws.
 */
export function afterMatchDeleted(
  fastify: FastifyInstance,
  match: DeletedMatch,
  actor: TournamentEventActor,
  actorId: string,
): void {
  const tournamentId = match.tournament_id;
  void recordTournamentEvent({
    tournamentId,
    type: 'match_deleted',
    actor,
    actorId,
    payload: {
      matchId: match.id,
      round: match.round,
      matchNumber: match.match_number,
      status: match.status,
      player1Id: match.player1_id,
      player2Id: match.player2_id,
    },
  });
  emitBracketUpdate(fastify.io, tournamentId);
  void runBalancedPairingTick(fastify, tournamentId);
  void runLiechtensteinPairingTick(fastify, tournamentId);
}
