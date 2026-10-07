import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logQueueActivity } from '../lib/queue-activity.js';
import {
  QUEUE_KEY,
  JOINED_AT_KEY,
  JOIN_SCRIPT,
  QUEUE_PREFS_KEY,
  ALL_BATTLE_TYPES,
  ALL_QUEUE_MATCH_FORMATS,
  runMatchmakingTick,
} from '../lib/matchmaking-tick.js';
import {
  findQueueableTeam,
  getStoredQueuePrefs,
  resolveStoredActor,
  saveQueuePrefs,
  type StoredQueuePrefs,
} from '../lib/queue-prefs.js';

// Queue join preferences: battle types (multi-select), series lengths (Bo1/Bo3 multi-select) and
// team size. For 2v2 the CAPTAIN queues on behalf of their ACTIVE team (team-as-actor, committed
// duo). Every omitted field falls back to the player's STORED settings (UserQueuePref).
const QueueJoinSchema = z.object({
  battleTypes: z.array(z.enum(ALL_BATTLE_TYPES)).min(1).optional(),
  matchFormats: z.array(z.enum(ALL_QUEUE_MATCH_FORMATS)).min(1).optional(),
  competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).optional(),
  // 2v2: which of the captain's active teams to queue. Omitted → the stored/first valid team.
  // Must be an ACTIVE team the requester captains.
  teamId: z.string().uuid().optional(),
  // true = the Open Play page's selection becomes the player's stored settings. Never set by the
  // Discord availability offers, which join with a one-off restriction.
  save: z.boolean().optional(),
});

// PUT body for the stored settings (all four are always sent by the Open Play page).
const QueuePrefsSchema = z.object({
  battleTypes: z.array(z.enum(ALL_BATTLE_TYPES)).min(1),
  matchFormats: z.array(z.enum(ALL_QUEUE_MATCH_FORMATS)).min(1),
  competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']),
  teamId: z.string().uuid().nullable(),
});
import { getQueueTimeoutRemaining, recordQueueLeave } from '../lib/queue-penalty.js';
import { cancelOpenPlayMatch } from '../lib/cancel-open-play-match.js';
import { slotsActiveAtWhere } from '../lib/availability-time.js';
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

      // Settings = the request body where given, else the player's stored settings.
      const body = parsedPrefs.data;
      const stored = await getStoredQueuePrefs(fastify.prisma, userId);
      const effective: StoredQueuePrefs = {
        battleTypes: body.battleTypes ?? stored.battleTypes,
        matchFormats: body.matchFormats ?? stored.matchFormats,
        competitorFormat: body.competitorFormat ?? stored.competitorFormat,
        teamId: body.teamId ?? (body.competitorFormat === 'TWO_V_TWO' ? null : stored.teamId),
      };

      // The queued id is the ACTOR: the user for 1v1, the captain's ACTIVE team for 2v2
      // (team-as-actor — the captain queues the committed duo).
      let queueId = userId;
      let format: 'ONE_V_ONE' | 'TWO_V_TWO' = 'ONE_V_ONE';
      let fellBackTo1v1 = false;
      if (body.competitorFormat === 'TWO_V_TWO') {
        // Explicit 2v2 request: an invalid team is an error the player has to see.
        const teamId = await findQueueableTeam(fastify.prisma, userId, body.teamId);
        if (!teamId) {
          const message = body.teamId
            ? 'That team is not an active team you captain with two accepted members'
            : 'You must be the captain of an active team with two accepted members to queue for 2v2';
          return reply.code(400).send({ error: 'BadRequest', message, statusCode: 400 });
        }
        queueId = teamId;
        format = 'TWO_V_TWO';
        effective.teamId = teamId;
      } else if (effective.competitorFormat === 'TWO_V_TWO') {
        // 2v2 came from the stored settings: if the team is no longer valid, play 1v1 this time
        // (the stored preference is left untouched).
        const actor = await resolveStoredActor(fastify.prisma, userId, effective);
        queueId = actor.queueId;
        format = actor.format;
        fellBackTo1v1 = actor.fellBackTo1v1;
      }
      const prefs = {
        format,
        battleTypes: effective.battleTypes,
        matchFormats: effective.matchFormats,
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

      // Open Play page: this selection becomes the player's stored settings.
      if (body.save) await saveQueuePrefs(fastify.prisma, userId, effective);

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
        if (match) return reply.code(200).send({ matched: true, match_id: match.id, fellBackTo1v1 });
      }

      const position = await fastify.redis.llen(QUEUE_KEY);
      return reply.code(200).send({ matched: false, position, fellBackTo1v1 });
    },
  );

  // GET /api/open-play/queue/prefs — the player's stored queue settings (defaults for new players).
  fastify.get(
    '/api/open-play/queue/prefs',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      return reply.code(200).send(await getStoredQueuePrefs(fastify.prisma, request.user.sub));
    },
  );

  // PUT /api/open-play/queue/prefs — replace the stored settings. They apply to every way into the
  // queue (Open Play page, "Queue again", landing page, Discord buttons) until changed again.
  fastify.put(
    '/api/open-play/queue/prefs',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = QueuePrefsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }
      const prefs: StoredQueuePrefs = {
        battleTypes: [...new Set(parsed.data.battleTypes)],
        matchFormats: [...new Set(parsed.data.matchFormats)],
        competitorFormat: parsed.data.competitorFormat,
        teamId: parsed.data.teamId,
      };
      await saveQueuePrefs(fastify.prisma, request.user.sub, prefs);
      return reply.code(200).send(prefs);
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
  // MATCHMAKING availability for the current hour on their own clock (paused players excluded).
  fastify.get('/api/open-play/queue/count', async (_request, reply) => {
    const activeWhere = await slotsActiveAtWhere(fastify.prisma, new Date());
    const [queue, availableNow, playingMatches] = await Promise.all([
      fastify.redis ? fastify.redis.llen(QUEUE_KEY) : Promise.resolve(0),
      activeWhere
        ? fastify.prisma.availabilitySlot.count({
            where: { AND: [activeWhere, { context: 'MATCHMAKING', user: { availability_paused: false } }] },
          })
        : Promise.resolve(0),
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
