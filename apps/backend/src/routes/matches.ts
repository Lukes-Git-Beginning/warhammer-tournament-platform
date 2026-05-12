import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ReportResultSchema = z.object({
  winnerId: z.string().uuid(),
  score: z.string().max(64).optional(),
  player1FactionId: z.string().min(1).optional(),
  player2FactionId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const matchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/matches/:id/result
  fastify.post(
    '/api/matches/:id/result',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const parsed = ReportResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { winnerId, score, player1FactionId, player2FactionId } = parsed.data;

      // Load match + tournament
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          next_match_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
          tournament: { select: { organizer_id: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      // Status check
      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be updated`,
          statusCode: 422,
        });
      }

      // Authorization check
      const user = request.user;
      const isOrganizer = user.sub === match.tournament.organizer_id;
      const isModOrAdmin = user.role === 'MODERATOR' || user.role === 'ADMIN';
      const isPlayer1 = match.player1_id !== null && user.sub === match.player1_id;
      const isPlayer2 = match.player2_id !== null && user.sub === match.player2_id;

      if (!isOrganizer && !isModOrAdmin && !isPlayer1 && !isPlayer2) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not authorized to report the result for this match',
          statusCode: 403,
        });
      }

      // Winner must be one of the two players
      if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'winnerId must be player1 or player2 of this match',
          statusCode: 422,
        });
      }

      const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

      // Determine faction IDs to use (passed or from existing match data)
      const effectiveP1FactionId = player1FactionId ?? match.player1_faction_id ?? null;
      const effectiveP2FactionId = player2FactionId ?? match.player2_faction_id ?? null;

      // Winner/loser faction IDs for stats
      const winnerFactionId = winnerId === match.player1_id ? effectiveP1FactionId : effectiveP2FactionId;
      const loserFactionId = loserId === match.player1_id ? effectiveP1FactionId : effectiveP2FactionId;

      // Find active season (optional — FactionStats update only when season exists)
      const activeSeason = await fastify.prisma.season.findFirst({
        where: { is_active: true },
        select: { id: true },
      });

      // Execute transaction
      await fastify.prisma.$transaction(async (tx) => {
        // a) Update match
        await tx.match.update({
          where: { id: matchId },
          data: {
            winner_id: winnerId,
            score: score ?? null,
            status: 'COMPLETED',
            ...(player1FactionId ? { player1_faction_id: player1FactionId } : {}),
            ...(player2FactionId ? { player2_faction_id: player2FactionId } : {}),
          },
        });

        // b) Advance winner to next match if applicable
        if (match.next_match_id) {
          const nextMatch = await tx.match.findUnique({
            where: { id: match.next_match_id },
            select: { id: true, player1_id: true, player2_id: true },
          });
          if (nextMatch) {
            if (nextMatch.player1_id === null) {
              await tx.match.update({
                where: { id: nextMatch.id },
                data: { player1_id: winnerId },
              });
            } else {
              await tx.match.update({
                where: { id: nextMatch.id },
                data: { player2_id: winnerId },
              });
            }
          }
        }

        // c) FactionStats update (only when active season exists)
        if (activeSeason) {
          const seasonId = activeSeason.id;

          // Both factions: increment matches_played
          const factionIdsToUpdate = [winnerFactionId, loserFactionId].filter(
            (f): f is string => f !== null,
          );

          for (const factionId of factionIdsToUpdate) {
            const isWinner = factionId === winnerFactionId;
            await tx.factionStats.upsert({
              where: { faction_id_season_id: { faction_id: factionId, season_id: seasonId } },
              create: {
                faction_id: factionId,
                season_id: seasonId,
                matches_played: 1,
                wins: isWinner ? 1 : 0,
                losses: isWinner ? 0 : 1,
                draws: 0,
                pick_count: 0,
                ban_count: 0,
              },
              update: {
                matches_played: { increment: 1 },
                ...(isWinner ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
              },
            });
          }
        }

        // d) Audit log
        await tx.auditLog.create({
          data: {
            entity_type: 'Match',
            entity_id: matchId,
            action: 'match_result',
            actor_id: user.sub,
            new_value: {
              winnerId,
              loserId,
              score: score ?? null,
              player1FactionId: player1FactionId ?? null,
              player2FactionId: player2FactionId ?? null,
            },
          },
        });
      });

      // Emit socket events after successful transaction
      fastify.io
        .to(`tournament_${match.tournament_id}`)
        .emit('match_result', {
          matchId,
          winnerId,
          score: score ?? '',
        });

      fastify.io
        .to(`tournament_${match.tournament_id}`)
        .emit('bracket_update', { tournamentId: match.tournament_id });

      request.log.info({ matchId, winnerId }, 'Match result reported');
      return reply.code(200).send({ matchId, winnerId, score: score ?? null });
    },
  );
};

export default matchRoutes;
