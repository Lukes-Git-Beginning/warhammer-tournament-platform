import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@rizzotto/db';
import { cached, invalidate, cacheKey } from '../lib/cache.js';
import { runMatchmakingTick } from '../lib/matchmaking-tick.js';

const SlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  hour_utc: z.number().int().min(0).max(23),
  context: z.enum(['TOURNAMENT', 'MATCHMAKING']),
});

const BulkUpsertSchema = z.object({
  slots: z.array(SlotSchema).max(7 * 24 * 2), // max 7 days × 24h × 2 contexts
});

const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/availability/heatmap?context=TOURNAMENT|MATCHMAKING — public, anonymous aggregate.
  // No context → combined (any availability). With context → that calendar only.
  fastify.get('/api/availability/heatmap', async (request, reply) => {
    const q = z.object({ context: z.enum(['TOURNAMENT', 'MATCHMAKING']).optional() }).safeParse(request.query);
    const context = q.success ? q.data.context : undefined;
    const whereClause = context
      ? Prisma.sql`WHERE context = ${context}::"AvailabilityContext"`
      : Prisma.empty;
    const data = await cached(
      fastify.redis,
      cacheKey('availability:heatmap', { context: context ?? 'all' }),
      async () => {
        const rows = await fastify.prisma.$queryRaw<
          { day_of_week: number; hour_utc: number; count: bigint }[]
        >`
          SELECT day_of_week, hour_utc, COUNT(DISTINCT user_id)::int AS count
          FROM "AvailabilitySlot"
          ${whereClause}
          GROUP BY day_of_week, hour_utc
        `;
        return rows.map((r) => ({
          day_of_week: r.day_of_week,
          hour_utc: r.hour_utc,
          count: Number(r.count),
        }));
      },
      { ttlSeconds: 300 },
    );
    return reply.code(200).send({ slots: data });
  });

  // GET /api/availability/heatmap/named?context=… — #12: STAFF ONLY.
  // Same buckets as the public heatmap, but with the names of who is available per
  // slot. The public endpoint above stays anonymous (counts only); names are gated.
  fastify.get(
    '/api/availability/heatmap/named',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'MODERATOR')] },
    async (request, reply) => {
      const q = z.object({ context: z.enum(['TOURNAMENT', 'MATCHMAKING']).optional() }).safeParse(request.query);
      if (!q.success) {
        return reply.code(400).send({ error: 'BadRequest', message: q.error.message, statusCode: 400 });
      }
      const rows = await fastify.prisma.availabilitySlot.findMany({
        where: q.data.context ? { context: q.data.context } : {},
        select: { day_of_week: true, hour_utc: true, user: { select: { username: true } } },
      });
      const byCell = new Map<string, string[]>();
      for (const r of rows) {
        const key = `${r.day_of_week}:${r.hour_utc}`;
        const arr = byCell.get(key);
        if (arr) arr.push(r.user.username);
        else byCell.set(key, [r.user.username]);
      }
      const slots = [...byCell.entries()].map(([key, names]) => {
        const [day, hour] = key.split(':').map(Number);
        return { day_of_week: day, hour_utc: hour, names: names.sort((a, b) => a.localeCompare(b)) };
      });
      return reply.code(200).send({ slots });
    },
  );

  // GET /api/availability/now — public, returns MATCHMAKING slot count for current UTC hour
  fastify.get('/api/availability/now', async (_request, reply) => {
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const hour = now.getUTCHours();
    const count = await fastify.prisma.availabilitySlot.count({
      where: { day_of_week: day, hour_utc: hour, context: 'MATCHMAKING' },
    });
    return reply.code(200).send({ count, day_of_week: day, hour_utc: hour });
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

      // If the user just added MATCHMAKING availability for the current UTC hour,
      // they may now be an eligible recipient for a waiting queue — nudge the tick.
      const now = new Date();
      const day = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
      const hour = now.getUTCHours();
      const addedCurrentHour = parsed.data.slots.some(
        (s) => s.context === 'MATCHMAKING' && s.day_of_week === day && s.hour_utc === hour,
      );
      if (addedCurrentHour && fastify.redis) {
        setImmediate(() => void runMatchmakingTick(fastify));
      }

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
