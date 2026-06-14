import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitParticipantChange } from '../lib/emit.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RegisterSchema = z.object({
  faction_id: z.string().min(1).optional(),
});

const CheckinSchema = z.object({
  user_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const participantRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/tournaments/:slug/register
  fastify.post(
    '/api/tournaments/:slug/register',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: {
          id: true,
          status: true,
          max_participants: true,
          _count: {
            select: {
              participants: {
                where: {
                  status: { in: ['REGISTERED', 'CHECKED_IN'] },
                  deleted_at: null,
                },
              },
            },
          },
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      if (tournament.status !== 'OPEN_REGISTRATION') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament is not currently accepting registrations',
          statusCode: 422,
        });
      }

      if (
        tournament.max_participants !== null &&
        tournament.max_participants !== undefined &&
        tournament._count.participants >= tournament.max_participants
      ) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament is full',
          statusCode: 422,
        });
      }

      // Validate faction exists if provided
      if (parsed.data.faction_id) {
        const faction = await fastify.prisma.faction.findUnique({
          where: { id: parsed.data.faction_id },
          select: { id: true },
        });
        if (!faction) {
          return reply.code(400).send({
            error: 'BadRequest',
            message: `Faction "${parsed.data.faction_id}" does not exist`,
            statusCode: 400,
          });
        }
      }

      try {
        const participant = await fastify.prisma.tournamentParticipant.create({
          data: {
            tournament_id: tournament.id,
            user_id: request.user.sub,
            faction_id: parsed.data.faction_id,
            status: 'REGISTERED',
          },
          select: {
            id: true,
            tournament_id: true,
            user_id: true,
            faction_id: true,
            status: true,
            registered_at: true,
          },
        });

        await fastify.prisma.auditLog.create({
          data: {
            entity_type: 'TournamentParticipant',
            entity_id: participant.id,
            action: 'register',
            actor_id: request.user.sub,
            new_value: { tournament_id: tournament.id, user_id: request.user.sub },
          },
        });

        emitParticipantChange(fastify.io, {
          tournamentId: tournament.id,
          userId: request.user.sub,
          action: 'registered',
        });

        request.log.info({ slug, userId: request.user.sub }, 'User registered for tournament');
        return reply.code(201).send(participant);
      } catch (err: unknown) {
        // Prisma unique constraint violation
        if (
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You are already registered for this tournament',
            statusCode: 409,
          });
        }
        throw err;
      }
    },
  );

  // POST /api/tournaments/:slug/withdraw
  fastify.post(
    '/api/tournaments/:slug/withdraw',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      // Self-withdraw is only allowed before the tournament starts. Once it is
      // ONGOING/COMPLETED, a player must be dropped by an organizer (which
      // forfeits open matches and keeps the bracket consistent).
      if (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message:
            'Cannot withdraw once the tournament has started — contact an organizer to be dropped',
          statusCode: 422,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'You are not registered for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'WITHDREW') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You have already withdrawn from this tournament',
          statusCode: 409,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'WITHDREW' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'withdraw',
          actor_id: request.user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'WITHDREW' },
        },
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: request.user.sub,
        action: 'withdrew',
      });

      request.log.info({ slug, userId: request.user.sub }, 'User withdrew from tournament');
      return reply.code(200).send({ message: 'Withdrawal successful' });
    },
  );

  // POST /api/tournaments/:slug/checkin
  fastify.post(
    '/api/tournaments/:slug/checkin',
    { preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const parsed = CheckinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, organizer_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      // Host check: if role is HOST, must own the tournament
      const user = request.user;
      if (
        user.role === 'HOST' &&
        user.sub !== tournament.organizer_id
      ) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to check in participants for this tournament',
          statusCode: 403,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: parsed.data.user_id,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Participant not found for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'CHECKED_IN') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Participant is already checked in',
          statusCode: 409,
        });
      }

      if (participant.status === 'DISQUALIFIED' || participant.status === 'WITHDREW') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Cannot check in a participant with status ${participant.status}`,
          statusCode: 422,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'CHECKED_IN' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'checkin',
          actor_id: user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'CHECKED_IN' },
        },
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: parsed.data.user_id,
        action: 'checked_in',
      });

      request.log.info({ slug, targetUserId: parsed.data.user_id }, 'Participant checked in');
      return reply.code(200).send({ message: 'Check-in successful' });
    },
  );

  // POST /api/tournaments/:slug/checkin/self
  // Self-service check-in: open when start_date - 1h <= now < start_date.
  // Uses audit-log to track when check-in window was first opened (no schema change needed).
  fastify.post(
    '/api/tournaments/:slug/checkin/self',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, start_date: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      if (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') {
        return reply.code(409).send({
          error: 'Conflict',
          code: 'TOURNAMENT_ALREADY_STARTED',
          message: 'Tournament has already started — check-in is no longer available',
          statusCode: 409,
        });
      }

      const now = new Date();
      const oneHourBefore = new Date(tournament.start_date.getTime() - 60 * 60 * 1000);

      // Check-in window: [start_date - 1h, start_date)
      const checkinOpen = now >= oneHourBefore && now < tournament.start_date;

      if (!checkinOpen) {
        return reply.code(409).send({
          error: 'Conflict',
          code: 'CHECKIN_NOT_OPEN',
          message: 'Check-in is not currently open for this tournament',
          statusCode: 409,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'You are not registered for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'CHECKED_IN') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You are already checked in',
          statusCode: 409,
        });
      }

      if (participant.status !== 'REGISTERED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Cannot check in with participant status "${participant.status}"`,
          statusCode: 422,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'CHECKED_IN' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'self_checkin',
          actor_id: request.user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'CHECKED_IN' },
        },
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: request.user.sub,
        action: 'checked_in',
      });

      request.log.info({ slug, userId: request.user.sub }, 'User self-checked-in');
      return reply.code(200).send({ message: 'Check-in successful' });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/tournaments/:slug/participants/me
  // Auth-required — returns the current user's participant status for a tournament.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/api/tournaments/:slug/participants/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: {
          status: true,
          registered_at: true,
          faction_id: true,
          lists_locked_at: true,
        },
      });

      if (!participant) {
        // Not registered — return null status (not an error)
        return reply.code(200).send({ status: null });
      }

      return reply.code(200).send({
        status: participant.status,
        registered_at: participant.registered_at,
        faction_id: participant.faction_id ?? null,
        checked_in_at: participant.status === 'CHECKED_IN' ? participant.lists_locked_at : null,
      });
    },
  );

  // GET /api/tournaments/:slug/participants
  fastify.get('/api/tournaments/:slug/participants', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true, mode: true, status: true },
    });

    if (!tournament) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Tournament "${slug}" not found`,
        statusCode: 404,
      });
    }

    const participants = await fastify.prisma.tournamentParticipant.findMany({
      where: { tournament_id: tournament.id, deleted_at: null },
      select: {
        id: true,
        status: true,
        registered_at: true,
        lists_locked_at: true,
        user: { select: { id: true, username: true, avatar_url: true } },
        faction: { select: { id: true, name: true, color_hex: true } },
      },
      orderBy: { registered_at: 'asc' },
    });

    const started = tournament.status === 'ONGOING' || tournament.status === 'COMPLETED';
    const maskFactions = (tournament.mode === 'SFT' || tournament.mode === 'BPT') && !started;

    const data = maskFactions
      ? participants.map((p) => ({ ...p, faction: null }))
      : participants;

    return { data, total: data.length };
  });

  // ---------------------------------------------------------------------------
  // POST /api/tournaments/:slug/participants/:userId/drop
  // Drop a participant mid-tournament. Callable by the player themselves OR by
  // organizer/moderator/admin. Sets status WITHDREW, forfeits any open match,
  // and voids (deletes) unfinished MatchGames with no winner yet.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/drop',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const callerId = request.user.sub;
      const callerRole = request.user.role;

      const isSelf = callerId === userId;
      const isStaff = callerRole === 'HOST' || callerRole === 'MODERATOR' || callerRole === 'ADMIN';

      if (!isSelf && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not authorised to drop this participant', statusCode: 403 });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, organizer_id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (tournament.status !== 'ONGOING') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Can only drop participants from an ongoing tournament', statusCode: 422 });
      }
      if (callerRole === 'HOST' && !isSelf && tournament.organizer_id !== callerId) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, deleted_at: null },
      });
      if (!participant) {
        return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      }
      if (participant.status === 'WITHDREW' || participant.status === 'DISQUALIFIED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Participant has already been dropped', statusCode: 409 });
      }

      // Find the player's open match (PENDING or ONGOING, not yet decided)
      const openMatches = await fastify.prisma.match.findMany({
        where: {
          tournament_id: tournament.id,
          deleted_at: null,
          status: { in: ['PENDING', 'ONGOING'] },
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
        include: {
          games: { where: { status: { not: 'COMPLETED' } }, select: { id: true } },
        },
      });

      let matchesForfeited = 0;
      let gamesVoided = 0;

      // Load WITHDREW status for all opponents involved (for double-drop detection)
      const opponentIds = [...new Set(openMatches.flatMap((m) =>
        [m.player1_id, m.player2_id].filter((id): id is string => !!id && id !== userId)
      ))];
      const withdrawnOpponents = new Set(
        opponentIds.length > 0
          ? (await fastify.prisma.tournamentParticipant.findMany({
              where: { tournament_id: tournament.id, user_id: { in: opponentIds }, status: 'WITHDREW' },
              select: { user_id: true },
            })).map((p) => p.user_id)
          : []
      );

      await fastify.prisma.$transaction(async (tx) => {
        // Mark participant as withdrawn
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { status: 'WITHDREW' },
        });

        for (const match of openMatches) {
          const opponent = match.player1_id === userId ? match.player2_id : match.player1_id;

          // Void (delete) any unfinished games
          if (match.games.length > 0) {
            await tx.matchGame.deleteMany({ where: { id: { in: match.games.map((g) => g.id) } } });
            gamesVoided += match.games.length;
          }

          if (opponent && withdrawnOpponents.has(opponent)) {
            // Both players dropped — cancel the match so neither gets an unearned win
            await tx.match.update({
              where: { id: match.id },
              data: { status: 'CANCELLED', winner_id: null },
            });
          } else {
            // Forfeit the match in favour of the opponent
            await tx.match.update({
              where: { id: match.id },
              data: { status: 'FORFEIT', winner_id: opponent },
            });
            matchesForfeited++;
          }
        }

        // Backward check: if this player already has FORFEIT wins against opponents who
        // are also now WITHDREW (i.e. opponent dropped before us), cancel those too.
        const staleForfeitWins = await tx.match.findMany({
          where: {
            tournament_id: tournament.id,
            status: 'FORFEIT',
            winner_id: userId,
          },
          select: { id: true, player1_id: true, player2_id: true },
        });
        for (const m of staleForfeitWins) {
          const loser = m.player1_id === userId ? m.player2_id : m.player1_id;
          if (!loser) continue;
          const loserParticipant = await tx.tournamentParticipant.findFirst({
            where: { tournament_id: tournament.id, user_id: loser, status: 'WITHDREW' },
            select: { id: true },
          });
          if (loserParticipant) {
            await tx.match.update({
              where: { id: m.id },
              data: { status: 'CANCELLED', winner_id: null },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'participant_drop',
            actor_id: callerId,
            new_value: { userId, isSelf, matchesForfeited, gamesVoided },
          },
        });
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'withdrew' });

      return reply.code(200).send({ dropped: true, matchesForfeited, gamesVoided });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/tournaments/:slug/participants/:userId/undrop
  // Restore a WITHDREW participant to CHECKED_IN. Does NOT auto-restore FORFEIT
  // matches — admin handles those separately via match restore/cancel endpoints.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/undrop',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const currentUserId = request.user?.sub;
      const role = request.user?.role;

      const tournament = await fastify.prisma.tournament.findUnique({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, organizer_id: true },
      });
      if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (tournament.status !== 'ONGOING') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Tournament is not ongoing', statusCode: 422 });
      }

      const isAdminOrMod = role === 'ADMIN' || role === 'MODERATOR';
      const isOrganizer = currentUserId === tournament.organizer_id;
      if (!isAdminOrMod && !isOrganizer) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findUnique({
        where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: userId } },
        select: { status: true },
      });
      if (!participant) return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      if (participant.status !== 'WITHDREW') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Player has not withdrawn', statusCode: 422 });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: userId } },
        data: { status: 'CHECKED_IN' },
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'registered' });

      return reply.code(200).send({ undroped: true });
    },
  );
};

export default participantRoutes;
