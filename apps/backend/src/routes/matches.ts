import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitMatchResult, emitBracketUpdate, emitStatusChange } from '../lib/emit.js';
import { invalidate } from '../lib/cache.js';
import { InvalidActionError } from '../lib/draft-service.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ReportResultSchema = z.object({
  winnerId: z.string().uuid().nullable(),
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

      // Winner must be one of the two players (null = draw)
      if (winnerId !== null && winnerId !== match.player1_id && winnerId !== match.player2_id) {
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

      // Winner/loser faction IDs for stats (null for draw)
      const winnerFactionId = winnerId === null
        ? null
        : winnerId === match.player1_id ? effectiveP1FactionId : effectiveP2FactionId;
      const loserFactionId = winnerId === null
        ? null
        : loserId === match.player1_id ? effectiveP1FactionId : effectiveP2FactionId;

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

        // e) MatchupStats update (alphabetical symmetry: faction_a_id < faction_b_id by string sort)
        if (activeSeason && effectiveP1FactionId && effectiveP2FactionId) {
          const sorted = [effectiveP1FactionId, effectiveP2FactionId].sort();
          const aId = sorted[0]!;
          const bId = sorted[1]!;
          const isDraw = winnerId === null;
          const winnerIsA = winnerFactionId === aId;

          await tx.matchupStats.upsert({
            where: {
              faction_a_id_faction_b_id_season_id: {
                faction_a_id: aId,
                faction_b_id: bId,
                season_id: activeSeason.id,
              },
            },
            create: {
              faction_a_id: aId,
              faction_b_id: bId,
              season_id: activeSeason.id,
              faction_a_wins: !isDraw && winnerIsA ? 1 : 0,
              faction_b_wins: !isDraw && !winnerIsA ? 1 : 0,
              draws: isDraw ? 1 : 0,
            },
            update: isDraw
              ? { draws: { increment: 1 } }
              : winnerIsA
                ? { faction_a_wins: { increment: 1 } }
                : { faction_b_wins: { increment: 1 } },
          });
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

      // Invalidate faction and meta caches after successful transaction
      if (fastify.redis) {
        await Promise.all([
          invalidate(fastify.redis, 'factions:*'),
          invalidate(fastify.redis, 'meta:*'),
        ]);
      }

      // Emit socket events after successful transaction
      emitMatchResult(fastify.io, {
        tournamentId: match.tournament_id,
        matchId,
        winnerId,
        score: score ?? null,
        nextMatchId: match.next_match_id ?? null,
      });

      emitBracketUpdate(fastify.io, match.tournament_id);

      request.log.info({ matchId, winnerId }, 'Match result reported');
      return reply.code(200).send({ matchId, winnerId, score: score ?? null });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/matches/:id/start
  // Organizer / Moderator / Admin: set match PENDING→ONGOING, start draft if enabled.
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/matches/:id/start',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN')],
    },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const user = request.user;

      // Load match with tournament + draft info
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        include: {
          tournament: {
            select: {
              id: true,
              organizer_id: true,
              status: true,
              draft_enabled: true,
              draft_preset_id: true,
            },
          },
          draft: {
            select: { id: true, status: true },
          },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      // ORGANIZER can only start matches in their own tournament
      const isModOrAdmin = user.role === 'MODERATOR' || user.role === 'ADMIN';
      const isOwnOrganizer = user.sub === match.tournament.organizer_id;

      if (!isModOrAdmin && !isOwnOrganizer) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not the organizer of this tournament',
          statusCode: 403,
        });
      }

      // Tournament must be ONGOING (bracket generated)
      if (match.tournament.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament not in ONGOING status',
          statusCode: 422,
        });
      }

      // Validate: draft_enabled with no preset
      if (match.tournament.draft_enabled && !match.tournament.draft_preset_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament has draft enabled but no preset configured',
          statusCode: 422,
        });
      }

      // Idempotency: if already ONGOING and draft exists, return existing
      if (match.status === 'ONGOING') {
        const draftId = match.draft?.id ?? null;
        return reply.code(200).send({
          match_id: matchId,
          status: 'ONGOING',
          draft_id: draftId,
        });
      }

      // Validate: match must be PENDING
      if (match.status !== 'PENDING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be started`,
          statusCode: 422,
        });
      }

      // Validate: both players must be assigned
      if (!match.player1_id || !match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Cannot start match without both players',
          statusCode: 422,
        });
      }

      // Update match status to ONGOING
      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'ONGOING' },
      });

      // Emit status change
      emitStatusChange(fastify.io, {
        tournamentId: match.tournament.id,
        status: 'ONGOING',
      });

      // Start draft if enabled
      let draftId: string | null = null;

      if (match.tournament.draft_enabled && match.tournament.draft_preset_id) {
        // Check idempotency: existing draft for this match?
        const existingDraft = await fastify.prisma.draft.findUnique({
          where: { match_id: matchId },
          select: { id: true },
        });

        if (existingDraft) {
          draftId = existingDraft.id;
        } else {
          try {
            const result = await fastify.draftService.startDraft({
              matchId,
              presetId: match.tournament.draft_preset_id,
              hostUserId: match.player1_id,
              guestUserId: match.player2_id,
              allFactionIds: [], // service caches faction IDs
            });
            draftId = result.draftId;
          } catch (err) {
            if (err instanceof InvalidActionError) {
              return reply.code(422).send({
                error: 'UnprocessableEntity',
                message: (err as Error).message,
                statusCode: 422,
              });
            }
            throw err;
          }
        }
      }

      request.log.info({ matchId, draftId }, 'Match started');

      return reply.code(200).send({
        match_id: matchId,
        status: 'ONGOING',
        draft_id: draftId,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/matches/:id/draft
  // Optional auth — lookup the current draft for a match (frontend convenience).
  // -------------------------------------------------------------------------
  fastify.get('/api/matches/:id/draft', async (request, reply) => {
    const { id: matchId } = request.params as { id: string };

    // Optional auth
    try {
      await request.jwtVerify();
    } catch {
      // anonymous — still allowed to look up draft metadata
    }

    // Check match exists
    const match = await fastify.prisma.match.findFirst({
      where: { id: matchId, deleted_at: null },
      select: { id: true },
    });

    if (!match) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Match "${matchId}" not found`,
        statusCode: 404,
      });
    }

    const draft = await fastify.prisma.draft.findUnique({
      where: { match_id: matchId },
      select: { id: true, status: true },
    });

    return reply.code(200).send({
      draft_id: draft?.id ?? null,
      status: draft?.status ?? null,
    });
  });
};

export default matchRoutes;
