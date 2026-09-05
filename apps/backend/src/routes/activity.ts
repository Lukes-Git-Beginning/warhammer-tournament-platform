import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// Records site access for the admin access log: a PAGE_VIEW per navigation, plus a
// derived VISIT (first activity after a 30-minute quiet gap). The user, IP and
// user-agent are stamped server-side so the client cannot spoof them. The frontend
// fires this fire-and-forget on each route change.

const ActivitySchema = z.object({
  path: z.string().min(1).max(512),
  page: z.string().max(128).optional(),
});

const activityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/activity', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = ActivitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const userId = request.user.sub;
    const { path, page } = parsed.data;
    const ip = request.ip;
    const userAgent = request.headers['user-agent'] ?? null;

    if (fastify.redis) {
      try {
        // Collapse rapid duplicate hits on the same path (React re-renders, double effects).
        const last = await fastify.redis.get(`activity:last:${userId}`);
        if (last === path) return reply.code(204).send();
        await fastify.redis.set(`activity:last:${userId}`, path, 'EX', 3);
        // Derive a VISIT: first activity after a 30-minute quiet gap.
        const fresh = await fastify.redis.set(`activity:visit:${userId}`, '1', 'EX', 1800, 'NX');
        if (fresh === 'OK') {
          await fastify.prisma.accessEvent.create({
            data: { user_id: userId, type: 'VISIT', ip, user_agent: userAgent },
          });
        }
      } catch {
        // Redis hiccup — fall through and still record the page view.
      }
    }

    await fastify.prisma.accessEvent.create({
      data: { user_id: userId, type: 'PAGE_VIEW', page: page ?? null, path, ip, user_agent: userAgent },
    });
    return reply.code(204).send();
  });
};

export default activityRoutes;
