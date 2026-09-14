import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logQueueActivity } from '../lib/queue-activity.js';
import {
  QUEUE_KEY,
  JOINED_AT_KEY,
  JOIN_SCRIPT,
  QUEUE_PREFS_KEY,
  ALL_BATTLE_TYPES,
  runMatchmakingTick,
} from '../lib/matchmaking-tick.js';

// Queue join preferences: which battle types the player will accept (multi-select) + team size.
// For 2v2 the CAPTAIN queues on behalf of their ACTIVE team (team-as-actor, committed duo).
const QueueJoinSchema = z.object({
  battleTypes: z.array(z.enum(ALL_BATTLE_TYPES)).min(1).optional(),
  competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).optional(),
});
import { getQueueTimeoutRemaining, recordQueueLeave } from '../lib/queue-penalty.js';
import { cancelOpenPlayMatch } from '../lib/cancel-open-play-match.js';
import { isCompetitorMember } from '../lib/competitors.js';
import { notifyQueueTimeout, notifyQueueWarning, notifyQueueAbuseToStaff } from '../lib/discord-notify.js';

const openPlayQueueRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/open-play/queue — join queue
  fastify.post(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;

      const parsedPrefs = QueueJoinSchema.safeParse(request.body ?? {});
      if (!parsedPrefs.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsedPrefs.error.message, statusCode: 400 });
      }
      if (!fastify.redis) {
        return reply.code(503).send({ error: 'ServiceUnavailable', message: 'Queue service unavailable', statusCode: 503 });
      }

      const format: 'ONE_V_ONE' | 'TWO_V_TWO' = parsedPrefs.data.competitorFormat ?? 'ONE_V_ONE';

      // The queued id is the ACTOR: the user for 1v1, the captain's ACTIVE team for 2v2
      // (team-as-actor — the captain queues the committed duo).
      let queueId = userId;
      if (format === 'TWO_V_TWO') {
        const team = await fastify.prisma.team.findFirst({
          where: { captain_id: userId, status: 'ACTIVE' },
          select: { id: true, members: { select: { accepted_at: true } } },
        });
        if (!team) {
          return reply.code(400).send({ error: 'BadRequest', message: 'You must be the captain of an active team to queue for 2v2', statusCode: 400 });
        }
        if (team.members.filter((m) => m.accepted_at !== null).length < 2) {
          return reply.code(400).send({ error: 'BadRequest', message: 'Your team needs two accepted members to queue', statusCode: 400 });
        }
        queueId = team.id;
      }
      const prefs = {
        format,
        battleTypes: parsedPrefs.data.battleTypes ?? [...ALL_BATTLE_TYPES],
      };

      // #14: reject a re-join while the queue-abuse cooldown is still running.
      const cooldownSec = await getQueueTimeoutRemaining(fastify.redis, userId);
      if (cooldownSec > 0) {
        return reply.code(429).send({
          error: 'TooManyRequests',
          message: `You're on a short queue cooldown for leaving too many times in quick succession. Try again in about ${Math.ceil(cooldownSec / 60)} min.`,
          statusCode: 429,
        });
      }

      const pos = await fastify.redis.lpos(QUEUE_KEY, queueId);
      if (pos !== null) {
        return reply.code(409).send({ error: 'Conflict', message: 'Already in queue', statusCode: 409 });
      }

      const activeMatch = await fastify.prisma.match.findFirst({
        where: {
          type: 'OPEN_PLAY',
          status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
          deleted_at: null,
          OR: [{ player1_id: queueId }, { player2_id: queueId }],
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
        JOIN_SCRIPT, 2, QUEUE_KEY, JOINED_AT_KEY, queueId, String(Date.now()),
      )) as number;
      if (joined !== 1) {
        return reply.code(409).send({ error: 'Conflict', message: 'Already in queue', statusCode: 409 });
      }

      // Record the actor's battle-type / team-size selection for preference-aware matching.
      await fastify.redis.hset(QUEUE_PREFS_KEY, queueId, JSON.stringify(prefs));

      await logQueueActivity(fastify.prisma, 'JOIN', userId);
      await runMatchmakingTick(fastify);

      // The tick removes matched players from the queue — if we're gone, we matched.
      const stillQueued = await fastify.redis.lpos(QUEUE_KEY, queueId);
      if (stillQueued === null) {
        const match = await fastify.prisma.match.findFirst({
          where: {
            type: 'OPEN_PLAY',
            status: 'ONGOING',
            deleted_at: null,
            OR: [{ player1_id: queueId }, { player2_id: queueId }],
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
      // The queued id is the user (1v1) or the captain's ACTIVE team (2v2) — clear both.
      const leaveTeam = fastify.redis
        ? await fastify.prisma.team.findFirst({ where: { captain_id: userId, status: 'ACTIVE' }, select: { id: true } })
        : null;
      const candidates = leaveTeam ? [userId, leaveTeam.id] : [userId];
      // Read the join timestamp before clearing it, to measure the stint (#14).
      let joinedAtRaw: string | null = null;
      let removed = 0;
      if (fastify.redis) {
        for (const id of candidates) {
          const ja = await fastify.redis.hget(JOINED_AT_KEY, id);
          const r = await fastify.redis.lrem(QUEUE_KEY, 0, id);
          if (r > 0) {
            removed += r;
            joinedAtRaw = ja;
          }
          await fastify.redis.hdel(JOINED_AT_KEY, id);
          await fastify.redis.hdel(QUEUE_PREFS_KEY, id);
        }
      }
      if (removed > 0) {
        await logQueueActivity(fastify.prisma, 'LEAVE', userId);
        // #14: a short stint counts toward the abuse threshold; every 3 within 24h trips
        // one escalation step — education-first: L1 warns only, sanctions start at L2.
        if (fastify.redis && joinedAtRaw) {
          const outcome = await recordQueueLeave(fastify.redis, userId, Number(joinedAtRaw), Date.now());
          if (outcome.tripped) {
            // Surface the escalation in the admin Queue Activity tab (with the level).
            await logQueueActivity(
              fastify.prisma,
              outcome.timeoutSec > 0 ? 'TIMEOUT' : 'WARNING',
              userId,
              { level: outcome.level },
            );
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

      // Queued id = the user (1v1) or the captain's ACTIVE team (2v2) — check both.
      const statusTeam = await fastify.prisma.team.findFirst({ where: { captain_id: userId, status: 'ACTIVE' }, select: { id: true } });
      const candidates = statusTeam ? [userId, statusTeam.id] : [userId];
      const total = await fastify.redis.llen(QUEUE_KEY);
      let pos: number | null = null;
      for (const id of candidates) {
        const p = await fastify.redis.lpos(QUEUE_KEY, id);
        if (p !== null) {
          pos = p;
          break;
        }
      }
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
    const [queue, availableNow, playingMatches] = await Promise.all([
      fastify.redis ? fastify.redis.llen(QUEUE_KEY) : Promise.resolve(0),
      fastify.prisma.availabilitySlot.count({
        where: { day_of_week: day, hour_utc: hour, context: 'MATCHMAKING' },
      }),
      // #7: how many are currently playing an Open Play match (2 players per ongoing match).
      fastify.prisma.match.count({
        where: { type: 'OPEN_PLAY', status: 'ONGOING', deleted_at: null },
      }),
    ]);
    return reply.code(200).send({ queue, availableNow, playing: playingMatches * 2 });
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
        select: { id: true, player1_id: true, player2_id: true, competitor_format: true },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Active Open Play match not found', statusCode: 404 });
      }
      // 2v2: any member of either team may cancel; 1v1: identity against the slot.
      const isPlayer = await isCompetitorMember(fastify.prisma, userId, match, match.competitor_format === 'TWO_V_TWO');
      const isAdmin = request.user.role === 'ADMIN' || request.user.role === 'MODERATOR';
      if (!isPlayer && !isAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your match', statusCode: 403 });
      }

      await cancelOpenPlayMatch(fastify, match);

      return reply.code(200).send({ ok: true });
    },
  );

  // GET /api/open-play/my-match — returns the user's active Open Play match, if any
  fastify.get(
    '/api/open-play/my-match',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      // A 2v2 member's active match is keyed by their TEAM id — include member teams.
      const memberTeams = await fastify.prisma.teamMember.findMany({
        where: { user_id: userId, team: { status: 'ACTIVE' } },
        select: { team_id: true },
      });
      const ids = [userId, ...memberTeams.map((m) => m.team_id)];
      const match = await fastify.prisma.match.findFirst({
        where: {
          type: 'OPEN_PLAY',
          status: 'ONGOING',
          deleted_at: null,
          OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }],
        },
        select: { id: true },
        orderBy: { created_at: 'desc' },
      });
      return reply.code(200).send({ match_id: match?.id ?? null });
    },
  );
};

export default openPlayQueueRoutes;
