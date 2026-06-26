import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitParticipantChange, emitBracketUpdate } from '../lib/emit.js';
import { canManageTournament, createLateJoinerBye } from '../lib/tournament-utils.js';

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
          faction_allowlist: { select: { faction_id: true } },
          restricted_factions: { select: { faction_id: true } },
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

      // Validate faction if provided
      if (parsed.data.faction_id) {
        const faction = await fastify.prisma.faction.findUnique({
          where: { id: parsed.data.faction_id },
          select: { id: true },
        });
        if (!faction) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 });
        }
        const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
        if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
          return reply.code(400).send({ error: 'BadRequest', message: 'Faction is not permitted in this tournament', statusCode: 400 });
        }
        // Restricted factions are intentionally pickable — they are nerfed, not
        // banned. Games involving them are excluded from the leaderboard at match
        // completion (see lib/match-games.ts), never blocked at pick time.
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

      // Host check: if role is HOST, must own the tournament (or be a co-host)
      const user = request.user;
      if (!(await canManageTournament(fastify.prisma, tournament.id, user.sub, user.role))) {
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

      // If checked in after the bracket already started, give the late joiner a
      // BYE in the current Swiss round so they're folded into later rounds. Non-fatal.
      try {
        const bye = await createLateJoinerBye(fastify.prisma, tournament.id, parsed.data.user_id);
        if (bye) emitBracketUpdate(fastify.io, tournament.id);
      } catch (err) {
        request.log.warn({ err, slug }, 'Failed to create late-joiner BYE');
      }

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
      if (!isSelf && !(await canManageTournament(fastify.prisma, tournament.id, callerId, callerRole))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, deleted_at: null },
      });
      if (!participant) {
        return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      }
      if (participant.status === 'DISQUALIFIED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Participant has already been dropped', statusCode: 409 });
      }
      if (participant.status === 'WITHDREW') {
        return reply.code(409).send({ error: 'Conflict', message: 'Participant has already withdrawn', statusCode: 409 });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { status: 'WITHDREW' },
        });

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'participant_drop',
            actor_id: callerId,
            new_value: { userId, isSelf },
          },
        });
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'withdrew' });

      return reply.code(200).send({ dropped: true });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/tournaments/:slug/participants/:userId/undrop
  // Restore a WITHDREW participant to CHECKED_IN and reset any never-played
  // playoff matches that were forfeited/cancelled solely because of the drop.
  // Swiss FORFEIT rows and already-played matches are left untouched.
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

      if (!(await canManageTournament(fastify.prisma, tournament.id, currentUserId ?? '', role ?? ''))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, deleted_at: null },
        select: { id: true, status: true },
      });
      if (!participant) return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      if (participant.status === 'DISQUALIFIED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot undrop a disqualified player', statusCode: 422 });
      }

      // Reset any never-played playoff matches that were only forfeited/cancelled
      // because of the drop. Without this the SF rows stay FORFEIT/CANCELLED
      // (showing the player as OUT) and advance-playoffs would propagate phantom
      // players into the GF / third-place node. Conservative scope: playoff phase,
      // winner-less or forfeited, and never actually played. Swiss FORFEIT rows
      // are left untouched (they correctly reflect the missed round in standings).
      const droppedPlayoffMatches = await fastify.prisma.match.findMany({
        where: {
          tournament_id: tournament.id,
          deleted_at: null,
          status: { in: ['FORFEIT', 'CANCELLED'] },
          played_at: null,
          phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
        select: { id: true },
      });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { status: 'CHECKED_IN' },
        });
        if (droppedPlayoffMatches.length > 0) {
          await tx.match.updateMany({
            where: { id: { in: droppedPlayoffMatches.map((m) => m.id) } },
            data: {
              status: 'PENDING',
              winner_id: null,
              result: null,
              score: null,
              player1_points: null,
              player2_points: null,
              played_at: null,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'participant_undrop',
            actor_id: currentUserId,
            new_value: { userId, matchesRestored: droppedPlayoffMatches.length },
          },
        });
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'registered' });
      if (droppedPlayoffMatches.length > 0) {
        emitBracketUpdate(fastify.io, tournament.id);
      }

      return reply.code(200).send({ undroped: true, matchesRestored: droppedPlayoffMatches.length });
    },
  );
};

export default participantRoutes;
