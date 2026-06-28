import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitStatusChange } from '../lib/emit.js';
import { InvalidActionError } from '../lib/draft-service.js';
import { completeMatch } from '../lib/complete-match.js';
import { canManageTournament } from '../lib/tournament-utils.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ReportResultSchema = z.object({
  winnerId: z.string().uuid().nullable(),
  score: z.string().max(64).optional(),
  player1FactionId: z.string().min(1).optional(),
  player2FactionId: z.string().min(1).optional(),
  map_id: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const matchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/matches/:id/result — legacy organizer/player override endpoint
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

      const { winnerId, score, player1FactionId, player2FactionId, map_id } = parsed.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          tournament: { select: { organizer_id: true, counts_for_leaderboard: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be updated`,
          statusCode: 422,
        });
      }

      const user = request.user;
      const isOrganizer = match.tournament ? user.sub === match.tournament.organizer_id : false;
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

      if (winnerId !== null && winnerId !== match.player1_id && winnerId !== match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'winnerId must be player1 or player2 of this match',
          statusCode: 422,
        });
      }

      await completeMatch(fastify, {
        matchId,
        winnerId,
        player1FactionId,
        player2FactionId,
        actorId: user.sub,
        score,
      });

      if (map_id && match.player1_id && match.player2_id) {
        // Upsert MatchGame as COMPLETED so GL computation uses it correctly
        await fastify.prisma.matchGame.upsert({
          where: { match_id_game_number: { match_id: matchId, game_number: 1 } },
          create: { match_id: matchId, game_number: 1, status: 'COMPLETED', winner_id: winnerId, played_at: new Date(), counts_for_leaderboard: match.tournament?.counts_for_leaderboard ?? true },
          update: { status: 'COMPLETED', winner_id: winnerId, played_at: new Date() },
        });
        const game = await fastify.prisma.matchGame.findUniqueOrThrow({
          where: { match_id_game_number: { match_id: matchId, game_number: 1 } },
          select: { id: true },
        });
        await fastify.prisma.matchMapDecision.upsert({
          where: { game_id: game.id },
          create: {
            game_id: game.id,
            mode: 'HOST_PRESET',
            coin_flip_seed: 'manual',
            top_player_id: match.player1_id,
            bottom_player_id: match.player2_id,
            bans_top: [],
            bans_bottom: [],
            active_pool: [],
            picked_map_id: map_id,
            decided_at: new Date(),
          },
          update: { picked_map_id: map_id },
        });
      }

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
      preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')],
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

      if (!match.tournament) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Cannot start an open play match via this endpoint',
          statusCode: 422,
        });
      }

      // HOST can only start matches in their own tournament (or be a co-host)
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', user.sub, user.role))) {
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
  // GET /api/matches/:id
  // Optional auth — returns enriched match details including player/faction
  // relations, scoring fields, and timing. Raw ID fields are preserved for
  // backwards compatibility with existing callers.
  // -------------------------------------------------------------------------
  fastify.get('/api/matches/:id', async (request, reply) => {
    const { id: matchId } = request.params as { id: string };

    const match = await fastify.prisma.match.findFirst({
      where: { id: matchId, deleted_at: null },
      select: {
        id: true,
        round: true,
        match_number: true,
        player1_id: true,
        player2_id: true,
        winner_id: true,
        player1_faction_id: true,
        player2_faction_id: true,
        status: true,
        result: true,
        phase: true,
        bracket_side: true,
        scheduled_time: true,
        played_at: true,
        score: true,
        player1_points: true,
        player2_points: true,
        counts_for_leaderboard: true,
        tournament: { select: { id: true, slug: true } },
        player1: { select: { id: true, username: true, avatar_url: true } },
        player2: { select: { id: true, username: true, avatar_url: true } },
        winner: { select: { id: true, username: true, avatar_url: true } },
        player1_faction: { select: { id: true, name: true, icon_url: true } },
        player2_faction: { select: { id: true, name: true, icon_url: true } },
      },
    });

    if (!match) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
    }

    return reply.code(200).send({
      id: match.id,
      tournament_id: match.tournament?.id ?? null,
      tournament_slug: match.tournament?.slug ?? null,
      round: match.round,
      match_number: match.match_number,
      status: match.status,
      result: match.result ?? null,
      phase: match.phase ?? null,
      bracket_side: match.bracket_side ?? null,
      scheduled_time: match.scheduled_time?.toISOString() ?? null,
      played_at: match.played_at?.toISOString() ?? null,
      score: match.score ?? null,
      player1_points: match.player1_points ?? null,
      player2_points: match.player2_points ?? null,
      counts_for_leaderboard: match.counts_for_leaderboard,
      // Raw ID fields — backwards compatible
      player1_id: match.player1_id,
      player2_id: match.player2_id,
      winner_id: match.winner_id,
      player1_faction_id: match.player1_faction_id,
      player2_faction_id: match.player2_faction_id,
      // Enriched relations
      player1: match.player1
        ? {
            id: match.player1.id,
            username: match.player1.username,
            avatar_url: match.player1.avatar_url ?? null,
          }
        : null,
      player2: match.player2
        ? {
            id: match.player2.id,
            username: match.player2.username,
            avatar_url: match.player2.avatar_url ?? null,
          }
        : null,
      winner: match.winner
        ? {
            id: match.winner.id,
            username: match.winner.username,
            avatar_url: match.winner.avatar_url ?? null,
          }
        : null,
      player1_faction: match.player1_faction
        ? {
            id: match.player1_faction.id,
            name: match.player1_faction.name,
            icon_url: match.player1_faction.icon_url ?? null,
          }
        : null,
      player2_faction: match.player2_faction
        ? {
            id: match.player2_faction.id,
            name: match.player2_faction.name,
            icon_url: match.player2_faction.icon_url ?? null,
          }
        : null,
    });
  });

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
  // PATCH /api/matches/:id/void — admin/mod/host can exclude a match from the leaderboard
  fastify.patch(
    '/api/matches/:id/void',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ void: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { counts_for_leaderboard: !parsed.data.void },
      });

      // Leaderboard cache (60s TTL) will naturally expire; no manual invalidation needed.
      return reply.code(200).send({ matchId, void: parsed.data.void });
    },
  );

  // POST /api/matches/:id/restore — admin/mod/host: reset a FORFEIT match back to PENDING
  fastify.post(
    '/api/matches/:id/restore',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, status: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.status !== 'FORFEIT' && match.status !== 'CANCELLED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only FORFEIT or CANCELLED matches can be restored', statusCode: 422 });
      }
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'PENDING', winner_id: null, result: null, score: null, player1_points: null, player2_points: null, played_at: null },
      });
      return reply.code(200).send({ matchId, status: 'PENDING' });
    },
  );

  // POST /api/matches/:id/cancel-match — admin/mod/host: cancel a match (excluded from standings)
  fastify.post(
    '/api/matches/:id/cancel-match',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', winner_id: null, result: null, score: null, player1_points: null, player2_points: null, played_at: null },
      });
      return reply.code(200).send({ matchId, status: 'CANCELLED' });
    },
  );

  // PATCH /api/matches/:id/fill-bye — assign a late joiner to a BYE slot, converting it to a real match
  fastify.patch(
    '/api/matches/:id/fill-bye',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId, deleted_at: null },
        select: { id: true, status: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const role = request.user?.role ?? '';
      const callerId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', callerId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      if (match.status !== 'BYE') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only BYE matches can be filled', statusCode: 422 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findUnique({
        where: { tournament_id_user_id: { tournament_id: match.tournament_id!, user_id: parsed.data.userId } },
        select: { id: true },
      });
      if (!participant) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'User is not a participant in this tournament', statusCode: 422 });
      }

      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { player2_id: parsed.data.userId, status: 'PENDING', winner_id: null },
      });

      if (fastify.io && match.tournament_id) {
        fastify.io.to(`bracket_${match.tournament_id}`).emit('bracket_update', { tournamentId: match.tournament_id! });
      }

      return reply.code(200).send({ matchId, status: 'PENDING' });
    },
  );
  // PATCH /api/matches/:id/swap-player — canManage: replace one player in a PENDING match
  fastify.patch(
    '/api/matches/:id/swap-player',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ oldPlayerId: z.string().uuid(), newPlayerId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, status: true, player1_id: true, player2_id: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.status !== 'PENDING') return reply.code(409).send({ error: 'Conflict', message: 'Can only swap players in PENDING matches', statusCode: 409 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      const { oldPlayerId, newPlayerId } = parsed.data;
      let updateData: { player1_id?: string; player2_id?: string };
      if (match.player1_id === oldPlayerId) updateData = { player1_id: newPlayerId };
      else if (match.player2_id === oldPlayerId) updateData = { player2_id: newPlayerId };
      else return reply.code(400).send({ error: 'BadRequest', message: 'oldPlayerId is not in this match', statusCode: 400 });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.update({ where: { id: matchId }, data: updateData });
        await tx.matchMapDecision.updateMany({ where: { game: { match_id: matchId }, top_player_id: oldPlayerId }, data: { top_player_id: newPlayerId } });
        await tx.matchMapDecision.updateMany({ where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId }, data: { bottom_player_id: newPlayerId } });
        await tx.matchFactionMatrix.updateMany({ where: { game: { match_id: matchId }, top_player_id: oldPlayerId }, data: { top_player_id: newPlayerId } });
        await tx.matchFactionMatrix.updateMany({ where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId }, data: { bottom_player_id: newPlayerId } });
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // DELETE /api/matches/:id — canManage: soft-delete a match
  fastify.delete(
    '/api/matches/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      await fastify.prisma.match.update({ where: { id: matchId }, data: { deleted_at: new Date() } });
      return reply.code(200).send({ ok: true });
    },
  );

  // POST /api/matches/:id/forfeit — canManage: forfeit a PENDING match in favour of the opponent
  fastify.post(
    '/api/matches/:id/forfeit',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ droppedPlayerId: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId required', statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, player1_id: true, player2_id: true, status: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match || !match.tournament_id) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      const { droppedPlayerId } = parsed.data;
      const winnerId = match.player1_id === droppedPlayerId ? match.player2_id : match.player2_id === droppedPlayerId ? match.player1_id : null;
      if (!winnerId) return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId is not in this match', statusCode: 400 });

      // B1: a match forfeit (match-drop) is match-scoped — it must NOT withdraw the
      // player from the whole tournament. They keep playing future rounds; only this
      // match is awarded to the opponent. (Withdraw is a separate explicit action.)
      await fastify.prisma.$transaction([
        fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'FORFEIT', winner_id: winnerId } }),
        fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } }),
      ]);
      return reply.code(200).send({ ok: true, winnerId });
    },
  );

  // POST /api/matches/:id/no-contest — canManage: B10 technical-abort double-bye.
  // Both players receive a bye point (1.0, no BH, see computeSwissStandings); the
  // match is awarded to no one and its games are voided. NOT a withdraw.
  fastify.post(
    '/api/matches/:id/no-contest',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { organizer_id: true } } },
      });
      if (!match || !match.tournament_id) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      await fastify.prisma.$transaction([
        fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'NO_CONTEST', winner_id: null } }),
        fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } }),
      ]);
      return reply.code(200).send({ ok: true });
    },
  );
};

export default matchRoutes;
