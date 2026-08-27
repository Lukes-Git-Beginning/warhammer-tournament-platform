import type { FastifyPluginAsync } from 'fastify';
import { canManageTournament } from '../lib/tournament-utils.js';

/**
 * Tournament event log — host/admin forensics timeline. Reads the append-only TournamentEvent
 * log (written by lib/tournament-events.ts) so "what happened when" is a query, not detective work.
 */
const tournamentEventRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/tournaments/:slug/events — most-recent-first lifecycle log for the tournament.
  fastify.get(
    '/api/tournaments/:slug/events',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const { sub: userId, role } = request.user;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can view the event log', statusCode: 403 });
      }

      const events = await fastify.prisma.tournamentEvent.findMany({
        where: { tournament_id: tournament.id },
        orderBy: { created_at: 'desc' },
        take: 500,
      });

      // Resolve actor + subject usernames in a single round-trip.
      const userIds = [...new Set(events.flatMap((e) => [e.actor_id, e.subject_id]).filter((x): x is string => !!x))];
      const users = userIds.length
        ? await fastify.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.username]));

      return reply.code(200).send({
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          actor: e.actor,
          actorId: e.actor_id,
          actorName: e.actor_id ? (nameById.get(e.actor_id) ?? null) : null,
          subjectId: e.subject_id,
          subjectName: e.subject_id ? (nameById.get(e.subject_id) ?? null) : null,
          payload: e.payload,
          createdAt: e.created_at.toISOString(),
        })),
      });
    },
  );
};

export default tournamentEventRoutes;
