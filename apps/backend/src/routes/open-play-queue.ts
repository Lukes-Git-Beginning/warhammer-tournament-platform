import type { FastifyPluginAsync } from 'fastify';
import { notifyMatchFoundWithButtons, notifyAvailabilityPing } from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';
import { logQueueActivity } from '../lib/queue-activity.js';

const QUEUE_KEY = 'rizzotto:queue:open_play';
// userId → epoch-ms join time. Lets the cleanup cron measure real time-in-queue
// instead of the (unrelated) User.updated_at timestamp.
const JOINED_AT_KEY = 'rizzotto:queue:open_play:joined_at';

const FOR_GRABS_PREFIX = 'rizzotto:availability:for_grabs:';
const FOR_GRABS_TTL = 60;

// Atomically push userId and try to match: returns [p1, p2] or false.
// Skips matching if either candidate has an active for_grabs reservation key
// (set when DMs go out so notified users get a 60s window to respond first).
const MATCH_SCRIPT = `
local queue = KEYS[1]
local userId = ARGV[1]
local prefix = ARGV[2]
redis.call('RPUSH', queue, userId)
local len = redis.call('LLEN', queue)
if len >= 2 then
  local p1 = redis.call('LINDEX', queue, 0)
  local p2 = redis.call('LINDEX', queue, 1)
  if redis.call('EXISTS', prefix .. p1) == 1 or redis.call('EXISTS', prefix .. p2) == 1 then
    return false
  end
  redis.call('LPOP', queue)
  redis.call('LPOP', queue)
  return {p1, p2}
end
return false
`;

const openPlayQueueRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/open-play/queue — join queue
  fastify.post(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;

      if (!fastify.redis) {
        return reply.code(503).send({ error: 'ServiceUnavailable', message: 'Queue service unavailable', statusCode: 503 });
      }

      const pos = await fastify.redis.lpos(QUEUE_KEY, userId);
      if (pos !== null) {
        return reply.code(409).send({ error: 'Conflict', message: 'Already in queue', statusCode: 409 });
      }

      const activeMatch = await fastify.prisma.match.findFirst({
        where: {
          type: 'OPEN_PLAY',
          status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
          deleted_at: null,
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
        select: { id: true },
      });
      if (activeMatch) {
        return reply.code(409).send({ error: 'Conflict', message: 'You already have an active Open Play match', statusCode: 409 });
      }

      const result = (await fastify.redis.eval(MATCH_SCRIPT, 1, QUEUE_KEY, userId, FOR_GRABS_PREFIX)) as [string, string] | false | null;

      if (Array.isArray(result) && result.length === 2) {
        const [p1Id, p2Id] = result;

        const { matchId, mapName } = await createOpenPlayMatch(fastify.prisma, p1Id, p2Id);

        const [p1, p2] = await Promise.all([
          fastify.prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
          fastify.prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
        ]);

        if (p1?.discord_id && p2?.discord_id) {
          setImmediate(() => void notifyMatchFoundWithButtons(
            matchId,
            { discordId: p1.discord_id!, username: p1.username },
            { discordId: p2.discord_id!, username: p2.username },
            mapName,
          ));
        }

        await Promise.all([
          logQueueActivity(fastify.prisma, 'MATCH', p1Id, { matchId, opponentId: p2Id }),
          logQueueActivity(fastify.prisma, 'MATCH', p2Id, { matchId, opponentId: p1Id }),
        ]);

        await fastify.redis.hdel(JOINED_AT_KEY, p1Id, p2Id);
        return reply.code(200).send({ matched: true, match_id: matchId });
      }

      const position = await fastify.redis.llen(QUEUE_KEY);
      await fastify.redis.hset(JOINED_AT_KEY, userId, Date.now());

      // When the first player enters an empty queue, DM users who have MATCHMAKING
      // availability for the current UTC hour (and aren't snoozed or already queued).
      if (position === 1) {
        // Reserve the joining user for DM recipients for 60s
        await fastify.redis.setex(`${FOR_GRABS_PREFIX}${userId}`, FOR_GRABS_TTL, '1');

        const redis = fastify.redis;
        const prisma = fastify.prisma;
        setImmediate(() => void (async () => {
          try {
            const now = new Date();
            const day = (now.getUTCDay() + 6) % 7;
            const hour = now.getUTCHours();
            const slots = await prisma.availabilitySlot.findMany({
              where: {
                day_of_week: day,
                hour_utc: hour,
                context: 'MATCHMAKING',
                user_id: { not: userId },
              },
              include: { user: { select: { id: true, discord_id: true } } },
            });
            const queueMembers = new Set(await redis.lrange(QUEUE_KEY, 0, -1));
            await Promise.allSettled(slots.map(async ({ user }) => {
              if (!user.discord_id || queueMembers.has(user.id)) return;
              const snoozed = await redis.get(`rizzotto:availability:snooze:${user.id}`);
              if (snoozed) return;
              await notifyAvailabilityPing(user.discord_id, position, userId);
            }));
          } catch { /* fire and forget */ }
        })());
      }

      await logQueueActivity(fastify.prisma, 'JOIN', userId);

      return reply.code(200).send({ matched: false, position });
    },
  );

  // DELETE /api/open-play/queue — leave queue
  fastify.delete(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const removed = fastify.redis ? await fastify.redis.lrem(QUEUE_KEY, 0, userId) : 0;
      if (fastify.redis) await fastify.redis.hdel(JOINED_AT_KEY, userId);
      if (removed > 0) await logQueueActivity(fastify.prisma, 'LEAVE', userId);
      return reply.code(204).send();
    },
  );

  // GET /api/open-play/queue/status
  fastify.get(
    '/api/open-play/queue/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;

      if (!fastify.redis) return reply.code(200).send({ inQueue: false, position: null, total: 0 });

      const [pos, total] = await Promise.all([
        fastify.redis.lpos(QUEUE_KEY, userId),
        fastify.redis.llen(QUEUE_KEY),
      ]);
      if (pos === null) return reply.code(200).send({ inQueue: false, position: null, total });
      return reply.code(200).send({ inQueue: true, position: pos + 1, total });
    },
  );

  // GET /api/open-play/queue/count — public live-activity counts for the landing page.
  // No auth, no user-specific fields: just the queue size and how many players have
  // MATCHMAKING availability for the current UTC hour.
  fastify.get('/api/open-play/queue/count', async (_request, reply) => {
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const hour = now.getUTCHours();
    const [queue, availableNow] = await Promise.all([
      fastify.redis ? fastify.redis.llen(QUEUE_KEY) : Promise.resolve(0),
      fastify.prisma.availabilitySlot.count({
        where: { day_of_week: day, hour_utc: hour, context: 'MATCHMAKING' },
      }),
    ]);
    return reply.code(200).send({ queue, availableNow });
  });

  // POST /api/open-play/matches/:id/cancel — either player can cancel.
  // A game with a reported result is statistically real and is finalized to that
  // result; only games without a reported result are recorded as draws.
  fastify.post(
    '/api/open-play/matches/:id/cancel',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user.sub;

      const match = await fastify.prisma.match.findFirst({
        where: { id, type: 'OPEN_PLAY', status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] }, deleted_at: null },
        select: { id: true, player1_id: true, player2_id: true },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Active Open Play match not found', statusCode: 404 });
      }
      const isPlayer = match.player1_id === userId || match.player2_id === userId;
      const isAdmin = request.user.role === 'ADMIN' || request.user.role === 'MODERATOR';
      if (!isPlayer && !isAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your match', statusCode: 403 });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });
        // A reported-but-unconfirmed game is statistically real — finalize it to its
        // reported result instead of overwriting it with a draw.
        const reportedGames = await tx.matchGame.findMany({
          where: { match_id: id, status: 'PENDING', winner_id: null, reported_winner_id: { not: null } },
          select: { id: true, reported_winner_id: true },
        });
        for (const game of reportedGames) {
          await tx.matchGame.update({
            where: { id: game.id },
            data: { winner_id: game.reported_winner_id, status: 'COMPLETED', counts_for_leaderboard: true, played_at: new Date() },
          });
        }
        // Remaining games without a reported result become completed draws —
        // counts for leaderboard so cancel ≠ free pass.
        await tx.matchGame.updateMany({
          where: { match_id: id, status: 'PENDING', winner_id: null, reported_winner_id: null },
          data: { status: 'COMPLETED', counts_for_leaderboard: true },
        });
      });

      await Promise.all([
        match.player1_id
          ? logQueueActivity(fastify.prisma, 'CANCEL', match.player1_id, { matchId: id, opponentId: match.player2_id })
          : Promise.resolve(),
        match.player2_id
          ? logQueueActivity(fastify.prisma, 'CANCEL', match.player2_id, { matchId: id, opponentId: match.player1_id })
          : Promise.resolve(),
      ]);

      return reply.code(200).send({ ok: true });
    },
  );

  // GET /api/open-play/my-match — returns the user's active Open Play match, if any
  fastify.get(
    '/api/open-play/my-match',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const match = await fastify.prisma.match.findFirst({
        where: {
          type: 'OPEN_PLAY',
          status: 'ONGOING',
          deleted_at: null,
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
        select: { id: true },
        orderBy: { created_at: 'desc' },
      });
      return reply.code(200).send({ match_id: match?.id ?? null });
    },
  );
};

export default openPlayQueueRoutes;
