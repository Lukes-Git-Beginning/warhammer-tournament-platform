import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, invalidate, cacheKey } from '../lib/cache.js';

const SlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  hour_utc: z.number().int().min(0).max(23),
  context: z.enum(['TOURNAMENT', 'MATCHMAKING']),
});

const BulkUpsertSchema = z.object({
  slots: z.array(SlotSchema).max(7 * 24 * 2), // max 7 days × 24h × 2 contexts
});

const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/availability/heatmap — public, anonymous aggregate
  fastify.get('/api/availability/heatmap', async (_request, reply) => {
    const data = await cached(
      fastify.redis,
      cacheKey('availability:heatmap', {}),
      async () => {
        const rows = await fastify.prisma.availabilitySlot.groupBy({
          by: ['day_of_week', 'hour_utc', 'context'],
          _count: { id: true },
        });
        return rows.map((r) => ({
          day_of_week: r.day_of_week,
          hour_utc: r.hour_utc,
          context: r.context,
          count: r._count.id,
        }));
      },
      { ttlSeconds: 300 },
    );
    return reply.code(200).send({ slots: data });
  });

  // GET /api/availability/me — authenticated
  fastify.get(
    '/api/availability/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const slots = await fastify.prisma.availabilitySlot.findMany({
        where: { user_id: userId },
        select: { id: true, day_of_week: true, hour_utc: true, context: true, created_at: true },
        orderBy: [{ day_of_week: 'asc' }, { hour_utc: 'asc' }],
      });
      return reply.code(200).send({ slots });
    },
  );

  // PUT /api/availability/slots — authenticated, bulk upsert (replaces all slots for user)
  fastify.put(
    '/api/availability/slots',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const parsed = BulkUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.availabilitySlot.deleteMany({ where: { user_id: userId } }),
        fastify.prisma.availabilitySlot.createMany({
          data: parsed.data.slots.map((s) => ({
            user_id: userId,
            day_of_week: s.day_of_week,
            hour_utc: s.hour_utc,
            context: s.context,
          })),
        }),
      ]);

      if (fastify.redis) await invalidate(fastify.redis, 'availability:heatmap*');

      const slots = await fastify.prisma.availabilitySlot.findMany({
        where: { user_id: userId },
        select: { id: true, day_of_week: true, hour_utc: true, context: true },
        orderBy: [{ day_of_week: 'asc' }, { hour_utc: 'asc' }],
      });
      return reply.code(200).send({ slots });
    },
  );
};

export default availabilityRoutes;
