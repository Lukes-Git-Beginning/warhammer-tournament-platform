import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@rizzotto/db';
import { cached, invalidate, cacheKey } from '../lib/cache.js';
import { runMatchmakingTick } from '../lib/matchmaking-tick.js';
import {
  isValidZone,
  localSlotNow,
  projectSlotToUtcCell,
  slotsActiveAtWhere,
} from '../lib/availability-time.js';
import { ALL_BATTLE_TYPES } from '../lib/queue-matching.js';
import {
  ALL_COMPETITOR_FORMATS,
  getTournamentNotifyPrefs,
  saveTournamentNotifyPrefs,
} from '../lib/tournament-notify-prefs.js';

// Slots are LOCAL time (weekday + hour in the user's own timezone) so they survive DST changes.
const SlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  context: z.enum(['TOURNAMENT', 'MATCHMAKING']),
});

const BulkUpsertSchema = z.object({
  slots: z.array(SlotSchema).max(7 * 24 * 2), // max 7 days × 24h × 2 contexts
  // Browser timezone (IANA). Stored on the user only when they have none yet.
  timezone: z.string().max(64).optional(),
});

const TournamentNotifyPrefsSchema = z.object({
  battleTypes: z.array(z.enum(ALL_BATTLE_TYPES)).min(1),
  competitorFormats: z.array(z.enum(ALL_COMPETITOR_FORMATS)).min(1),
});

/** Add `count` to a UTC raster cell in a keyed map. */
function addToCell(map: Map<string, number>, cell: { day_of_week: number; hour_utc: number }, count: number): void {
  const key = `${cell.day_of_week}:${cell.hour_utc}`;
  map.set(key, (map.get(key) ?? 0) + count);
}

const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/availability/heatmap?context=TOURNAMENT|MATCHMAKING — public, anonymous aggregate.
  // No context → combined (any availability). With context → that calendar only.
  fastify.get('/api/availability/heatmap', async (request, reply) => {
    const q = z.object({ context: z.enum(['TOURNAMENT', 'MATCHMAKING']).optional() }).safeParse(request.query);
    const context = q.success ? q.data.context : undefined;
    // Paused players are temporarily not matchable, so they must not inflate the availability counts.
    const contextFilter = context
      ? Prisma.sql`AND s.context = ${context}::"AvailabilityContext"`
      : Prisma.empty;
    const data = await cached(
      fastify.redis,
      cacheKey('availability:heatmap', { context: context ?? 'all' }),
      async () => {
        // Slots are local time per user: project each (zone, weekday, hour) bucket onto the UTC
        // raster for the CURRENT week (DST-correct), then aggregate. One user lives in one zone,
        // so summing per-zone distinct counts never double-counts.
        const rows = await fastify.prisma.$queryRaw<
          { timezone: string | null; day_of_week: number; hour_local: number; count: bigint }[]
        >`
          SELECT u.timezone, s.day_of_week, s.hour_local, COUNT(DISTINCT s.user_id)::int AS count
          FROM "AvailabilitySlot" s
          JOIN "User" u ON u.id = s.user_id
          WHERE u.availability_paused = false ${contextFilter}
          GROUP BY u.timezone, s.day_of_week, s.hour_local
        `;
        const now = new Date();
        const cells = new Map<string, number>();
        for (const r of rows) {
          const cell = projectSlotToUtcCell({ day_of_week: r.day_of_week, hour: r.hour_local }, r.timezone, now);
          addToCell(cells, cell, Number(r.count));
        }
        return [...cells.entries()].map(([key, count]) => {
          const [day, hour] = key.split(':').map(Number);
          return { day_of_week: day, hour_utc: hour, count };
        });
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
        where: {
          user: { availability_paused: false },
          ...(q.data.context ? { context: q.data.context } : {}),
        },
        select: { day_of_week: true, hour_local: true, user: { select: { username: true, timezone: true } } },
      });
      // Local slots → UTC raster cells of the current week (same projection as the public heatmap).
      const now = new Date();
      const byCell = new Map<string, string[]>();
      for (const r of rows) {
        const cell = projectSlotToUtcCell({ day_of_week: r.day_of_week, hour: r.hour_local }, r.user.timezone, now);
        const key = `${cell.day_of_week}:${cell.hour_utc}`;
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

  // GET /api/availability/now — public, returns the MATCHMAKING slot count that is "on" right now,
  // each player judged by their own local wall clock. day_of_week/hour_utc echo the current UTC cell.
  fastify.get('/api/availability/now', async (_request, reply) => {
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const hour = now.getUTCHours();
    const activeWhere = await slotsActiveAtWhere(fastify.prisma, now);
    const count = activeWhere
      ? await fastify.prisma.availabilitySlot.count({
          where: { AND: [activeWhere, { context: 'MATCHMAKING', user: { availability_paused: false } }] },
        })
      : 0;
    return reply.code(200).send({ count, day_of_week: day, hour_utc: hour });
  });

  // GET /api/availability/me — authenticated
  fastify.get(
    '/api/availability/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const [user, rows] = await Promise.all([
        fastify.prisma.user.findUnique({ where: { id: userId }, select: { availability_paused: true, timezone: true } }),
        fastify.prisma.availabilitySlot.findMany({
          where: { user_id: userId },
          select: { id: true, day_of_week: true, hour_local: true, context: true, created_at: true },
          orderBy: [{ day_of_week: 'asc' }, { hour_local: 'asc' }],
        }),
      ]);
      const slots = rows.map(({ hour_local, ...r }) => ({ ...r, hour: hour_local }));
      return reply.code(200).send({ slots, paused: user?.availability_paused ?? false, timezone: user?.timezone ?? null });
    },
  );

  // GET /api/availability/tournament-prefs — which tournaments the player wants the availability DM
  // for (battle types + team sizes). Defaults to everything when nothing is stored.
  fastify.get(
    '/api/availability/tournament-prefs',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      return reply.code(200).send(await getTournamentNotifyPrefs(fastify.prisma, request.user.sub));
    },
  );

  // PUT /api/availability/tournament-prefs — replace the stored tournament DM filter (at least one of each).
  fastify.put(
    '/api/availability/tournament-prefs',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = TournamentNotifyPrefsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }
      const prefs = {
        battleTypes: [...new Set(parsed.data.battleTypes)],
        competitorFormats: [...new Set(parsed.data.competitorFormats)],
      };
      await saveTournamentNotifyPrefs(fastify.prisma, request.user.sub, prefs);
      return reply.code(200).send(prefs);
    },
  );

  // PUT /api/availability/paused — authenticated: temporarily stop being matchable (excluded from the
  // matchmaking DM wave, the tournament DMs, "available now" count and heatmap) WITHOUT deleting any
  // calendar slots.
  fastify.put(
    '/api/availability/paused',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = z.object({ paused: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }
      await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: { availability_paused: parsed.data.paused },
      });
      if (fastify.redis) await invalidate(fastify.redis, 'availability:heatmap*');
      return reply.code(200).send({ paused: parsed.data.paused });
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

      // Remember the browser zone when the user has none yet (never overwrite an explicit choice).
      const browserZone = isValidZone(parsed.data.timezone) ? parsed.data.timezone : null;
      const current = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
      let zone = current?.timezone ?? null;
      if (!zone && browserZone) {
        await fastify.prisma.user.update({ where: { id: userId }, data: { timezone: browserZone } });
        zone = browserZone;
      }

      await fastify.prisma.$transaction([
        fastify.prisma.availabilitySlot.deleteMany({ where: { user_id: userId } }),
        fastify.prisma.availabilitySlot.createMany({
          data: parsed.data.slots.map((s) => ({
            user_id: userId,
            day_of_week: s.day_of_week,
            hour_local: s.hour,
            context: s.context,
          })),
        }),
      ]);

      if (fastify.redis) await invalidate(fastify.redis, 'availability:heatmap*');

      // If the user just added MATCHMAKING availability for the current hour on THEIR clock,
      // they may now be an eligible recipient for a waiting queue — nudge the tick.
      const local = localSlotNow(new Date(), zone);
      const addedCurrentHour = parsed.data.slots.some(
        (s) => s.context === 'MATCHMAKING' && s.day_of_week === local.day_of_week && s.hour === local.hour,
      );
      if (addedCurrentHour && fastify.redis) {
        setImmediate(() => void runMatchmakingTick(fastify));
      }

      const rows = await fastify.prisma.availabilitySlot.findMany({
        where: { user_id: userId },
        select: { id: true, day_of_week: true, hour_local: true, context: true },
        orderBy: [{ day_of_week: 'asc' }, { hour_local: 'asc' }],
      });
      const slots = rows.map(({ hour_local, ...r }) => ({ ...r, hour: hour_local }));
      return reply.code(200).send({ slots, timezone: zone });
    },
  );
};

export default availabilityRoutes;
