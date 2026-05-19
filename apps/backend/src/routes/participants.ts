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
    { preHandler: [fastify.authenticate, fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN')] },
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

      // Organizer check: if role is ORGANIZER, must own the tournament
      const user = request.user;
      if (
        user.role === 'ORGANIZER' &&
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

  // GET /api/tournaments/:slug/participants
  fastify.get('/api/tournaments/:slug/participants', async (request, reply) => {
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

    return { data: participants, total: participants.length };
  });
};

export default participantRoutes;
