import type { FastifyPluginAsync } from 'fastify';
import { logQueueActivity } from '../lib/queue-activity.js';
import {
  QUEUE_KEY,
  JOINED_AT_KEY,
  JOIN_SCRIPT,
  runMatchmakingTick,
  resetContactedSet,
} from '../lib/matchmaking-tick.js';
import { getQueueTimeoutRemaining, recordQueueLeave } from '../lib/queue-penalty.js';
import { notifyQueueTimeout, notifyQueueWarning, notifyQueueAbuseToStaff } from '../lib/discord-notify.js';

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

      // #14: reject a re-join while the queue-abuse cooldown is still running.
      const cooldownSec = await getQueueTimeoutRemaining(fastify.redis, userId);
      if (cooldownSec > 0) {
        return reply.code(429).send({
          error: 'TooManyRequests',
          message: `You're on a short queue cooldown for leaving too many times in quick succession. Try again in about ${Math.ceil(cooldownSec / 60)} min.`,
          statusCode: 429,
        });
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

      // Join the queue atomically (dup-checked), then run one synchronous
      // matchmaking tick so an instant FIFO match — or a fresh DM wave + hold —
      // happens before we reply. If the tick paired this user off, report it.
      const joined = (await fastify.redis.eval(
        JOIN_SCRIPT, 2, QUEUE_KEY, JOINED_AT_KEY, userId, String(Date.now()),
      )) as number;
      if (joined !== 1) {
        return reply.code(409).send({ error: 'Conflict', message: 'Already in queue', statusCode: 409 });
      }

      await logQueueActivity(fastify.prisma, 'JOIN', userId);
      await runMatchmakingTick(fastify);

      // The tick removes matched players from the queue — if we're gone, we matched.
      const stillQueued = await fastify.redis.lpos(QUEUE_KEY, userId);
      if (stillQueued === null) {
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
        if (match) return reply.code(200).send({ matched: true, match_id: match.id });
      }

      const position = await fastify.redis.llen(QUEUE_KEY);
      return reply.code(200).send({ matched: false, position });
    },
  );

  // DELETE /api/open-play/queue — leave queue
  fastify.delete(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      // Read the join timestamp before clearing it, to measure the stint (#14).
      const joinedAtRaw = fastify.redis ? await fastify.redis.hget(JOINED_AT_KEY, userId) : null;
      const removed = fastify.redis ? await fastify.redis.lrem(QUEUE_KEY, 0, userId) : 0;
      if (fastify.redis) await fastify.redis.hdel(JOINED_AT_KEY, userId);
      if (removed > 0) {
        await logQueueActivity(fastify.prisma, 'LEAVE', userId);
        // #14: a short stint counts toward the abuse threshold; every 3 within 24h trips
        // one escalation step — education-first: L1 warns only, sanctions start at L2.
        if (fastify.redis && joinedAtRaw) {
          const outcome = await recordQueueLeave(fastify.redis, userId, Number(joinedAtRaw), Date.now());
          if (outcome.tripped) {
            const u = await fastify.prisma.user.findUnique({
              where: { id: userId },
              select: { username: true, discord_id: true },
            });
            if (u?.discord_id) {
              if (outcome.timeoutSec > 0) void notifyQueueTimeout(u.discord_id, outcome.timeoutSec);
              else void notifyQueueWarning(u.discord_id);
            }
            // Sanctions (level ≥ 2) also notify staff.
            if (outcome.level >= 2) void notifyQueueAbuseToStaff(u?.username ?? userId, outcome.level, outcome.timeoutSec);
          }
        }
      }
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
        // #19: remaining games without a reported result are CANCELLED and do NOT
        // count — a cancelled match fabricates no game/result. status CANCELLED drops
        // them from Meta (which filters COMPLETED) and counts_for_leaderboard=false
        // keeps them out of the leaderboard/faction stats. Queue abuse is handled by
        // the escalating queue penalty (#14), not by fake counting draws.
        await tx.matchGame.updateMany({
          where: { match_id: id, status: 'PENDING', winner_id: null, reported_winner_id: null },
          data: { status: 'CANCELLED', counts_for_leaderboard: false },
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

      // A match ending frees both players — start a fresh wait-cycle DM wave.
      await resetContactedSet(fastify);
      setImmediate(() => void runMatchmakingTick(fastify));

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
