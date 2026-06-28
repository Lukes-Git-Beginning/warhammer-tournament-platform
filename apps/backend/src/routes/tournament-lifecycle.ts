/**
 * Tournament lifecycle endpoints — Q3: Army-List Lock.
 *
 * POST /api/tournaments/:tournamentId/lock-lists
 *   Locks all participant army-list submissions for a tournament.
 *   Only callable by the tournament host or ADMIN/MODERATOR.
 */

import type { FastifyPluginAsync } from 'fastify';
import { emitListsLocked } from '../lib/emit.js';
import { canManageTournament } from '../lib/tournament-utils.js';

// Allowed statuses for locking (DRAFT and COMPLETED are excluded per spec)
const LOCKABLE_STATUSES = new Set([
  'OPEN_REGISTRATION',
  'REGISTRATION_CLOSED',
  'ONGOING',
]);

const tournamentLifecycleRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/tournaments/:tournamentId/lock-lists
  fastify.post(
    '/api/tournaments/:tournamentId/lock-lists',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tournamentId } = request.params as { tournamentId: string };
      const user = request.user;

      // Load tournament
      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id: tournamentId, deleted_at: null },
        select: {
          id: true,
          host_id: true,
          status: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${tournamentId}" not found`,
          statusCode: 404,
        });
      }

      // Auth: only host, co-host, MODERATOR, or ADMIN
      if (!(await canManageTournament(fastify.prisma, tournament.id, user.sub, user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament host or an admin/moderator may lock army lists',
          statusCode: 403,
        });
      }

      // Status guard: DRAFT and COMPLETED are not lockable
      if (!LOCKABLE_STATUSES.has(tournament.status)) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `Cannot lock army lists for a tournament in status "${tournament.status}". Allowed statuses: OPEN_REGISTRATION, REGISTRATION_CLOSED, ONGOING`,
          statusCode: 400,
        });
      }

      // Lock all participants that are not yet locked
      const lockedAt = new Date();
      const result = await fastify.prisma.tournamentParticipant.updateMany({
        where: {
          tournament_id: tournament.id,
          lists_locked_at: null,
          deleted_at: null,
        },
        data: {
          lists_locked_at: lockedAt,
        },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Tournament',
          entity_id: tournament.id,
          action: 'lists_locked',
          actor_id: user.sub,
          new_value: {
            locked_at: lockedAt.toISOString(),
            affected_participants: result.count,
          },
        },
      });

      // Socket broadcast
      emitListsLocked(fastify.io, {
        tournament_id: tournament.id,
        locked_at: lockedAt.toISOString(),
        affected_participants: result.count,
      });

      request.log.info(
        { tournamentId: tournament.id, affected: result.count },
        'Army lists locked for tournament',
      );

      return reply.code(200).send({
        tournament_id: tournament.id,
        locked_at: lockedAt.toISOString(),
        affected_participants: result.count,
      });
    },
  );
};

export default tournamentLifecycleRoutes;
