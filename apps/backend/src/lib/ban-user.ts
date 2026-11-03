import type { FastifyInstance } from 'fastify';
import { cacheKey, invalidate } from './cache.js';
import { leaveOpenPlayQueue } from './open-play-queue-service.js';

/**
 * Ban a user: the account is soft-deleted until an admin lifts it (Admin → User Management), so he
 * can't log in, queue or play, and a running session ends. Returns null when he is already banned.
 */
export async function banUser(
  fastify: FastifyInstance,
  userId: string,
  actorId: string,
  context?: Record<string, string>,
): Promise<{ id: string; username: string; deleted_at: Date | null } | null> {
  const banned = await fastify.prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: userId, deleted_at: null }, data: { deleted_at: new Date() } });
    if (count === 0) return null;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, deleted_at: true } });
    await tx.auditLog.create({
      data: {
        entity_type: 'User',
        entity_id: u.id,
        action: 'BAN',
        actor_id: actorId,
        old_value: { deleted_at: null },
        new_value: { deleted_at: u.deleted_at?.toISOString() ?? null, ...context },
      },
    });
    return u;
  });
  if (!banned) return null;

  // Invalidate role cache so banned user can't keep using stale role
  if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
  if (fastify.redis) await invalidate(fastify.redis, `user:banned:${userId}`);
  await invalidate(fastify.redis, cacheKey('admin:stats', {}));
  // A banned player must not stay matchable.
  await leaveOpenPlayQueue(fastify, userId).catch(() => {});

  return banned;
}
