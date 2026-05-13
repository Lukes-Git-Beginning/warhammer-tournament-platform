import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey, invalidate } from '../lib/cache.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const AuditLogQuerySchema = PaginationSchema.extend({
  entity_type: z.string().optional(),
  actor_id: z.string().uuid().optional(),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply requireRole('ADMIN') to all routes in this scope
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole('ADMIN'));

  // GET /api/admin/audit-log
  fastify.get('/api/admin/audit-log', async (request, reply) => {
    const parsed = AuditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { page, pageSize, entity_type, actor_id } = parsed.data;

    const where: Record<string, unknown> = {};
    if (entity_type) where.entity_type = entity_type;
    if (actor_id) where.actor_id = actor_id;

    const [total, entries] = await Promise.all([
      fastify.prisma.auditLog.count({ where }),
      fastify.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, username: true, avatar_url: true } },
        },
      }),
    ]);

    return {
      entries: entries.map((e) => ({
        id: e.id,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        action: e.action,
        actor: e.actor
          ? { id: e.actor.id, username: e.actor.username, avatar_url: e.actor.avatar_url }
          : null,
        old_value: e.old_value,
        new_value: e.new_value,
        created_at: e.created_at.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });

  // GET /api/admin/stats — aggregate KPIs (cached 60s)
  fastify.get('/api/admin/stats', async () => {
    return cached(
      fastify.redis,
      cacheKey('admin:stats', {}),
      async () => {
        const [
          activeUsers,
          totalTournaments,
          activeTournaments,
          completedTournaments,
          totalMatches,
          activeSeason,
        ] = await Promise.all([
          fastify.prisma.user.count({ where: { deleted_at: null } }),
          fastify.prisma.tournament.count({ where: { deleted_at: null } }),
          fastify.prisma.tournament.count({ where: { deleted_at: null, status: { in: ['ONGOING', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED'] } } }),
          fastify.prisma.tournament.count({ where: { status: 'COMPLETED' } }),
          fastify.prisma.match.count(),
          fastify.prisma.season.findFirst({ where: { is_active: true } }),
        ]);

        let topFactions: Array<{ faction_id: string; name: string; matches_played: number; wins: number }> = [];
        if (activeSeason) {
          const top = await fastify.prisma.factionStats.findMany({
            where: { season_id: activeSeason.id },
            orderBy: { matches_played: 'desc' },
            take: 5,
            include: { faction: { select: { id: true, name: true } } },
          });
          topFactions = top.map((f) => ({
            faction_id: f.faction_id,
            name: f.faction.name,
            matches_played: f.matches_played,
            wins: f.wins,
          }));
        }

        return {
          users: { active: activeUsers },
          tournaments: { total: totalTournaments, active: activeTournaments, completed: completedTournaments },
          matches: { total: totalMatches },
          top_factions: topFactions,
          season: activeSeason ? { id: activeSeason.id, name: activeSeason.name } : null,
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // POST /api/admin/users/:id/ban
  fastify.post<{ Params: { id: string } }>('/api/admin/users/:id/ban', async (request, reply) => {
    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, deleted_at: true } });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    if (user.deleted_at) return reply.code(409).send({ error: 'Conflict', message: 'User already banned', statusCode: 409 });

    const banned = await fastify.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { deleted_at: new Date() },
        select: { id: true, username: true, deleted_at: true },
      });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: u.id,
          action: 'BAN',
          actor_id: request.user.sub,
          old_value: { deleted_at: null },
          new_value: { deleted_at: u.deleted_at?.toISOString() ?? null },
        },
      });
      return u;
    });

    // Invalidate role cache so banned user can't keep using stale role
    if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
    await invalidate(fastify.redis, cacheKey('admin:stats', {}));

    return { id: banned.id, username: banned.username, deleted_at: banned.deleted_at?.toISOString() ?? null };
  });

  // DELETE /api/admin/users/:id/ban — unban
  fastify.delete<{ Params: { id: string } }>('/api/admin/users/:id/ban', async (request, reply) => {
    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true, deleted_at: true } });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    if (!user.deleted_at) return reply.code(409).send({ error: 'Conflict', message: 'User not banned', statusCode: 409 });

    const unbanned = await fastify.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { deleted_at: null },
        select: { id: true, username: true, deleted_at: true },
      });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: u.id,
          action: 'UNBAN',
          actor_id: request.user.sub,
          old_value: { deleted_at: user.deleted_at?.toISOString() },
          new_value: { deleted_at: null },
        },
      });
      return u;
    });

    if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
    await invalidate(fastify.redis, cacheKey('admin:stats', {}));

    return { id: unbanned.id, username: unbanned.username };
  });
};

export default adminRoutes;
