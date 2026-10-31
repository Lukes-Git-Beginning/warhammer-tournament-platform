import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { QUEUE_KEY, ALL_BATTLE_TYPES, ALL_QUEUE_MATCH_FORMATS } from '../lib/matchmaking-tick.js';
import { getStoredQueuePrefs, saveQueuePrefs, type StoredQueuePrefs } from '../lib/queue-prefs.js';
import { joinOpenPlayQueue, leaveOpenPlayQueue } from '../lib/open-play-queue-service.js';

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
import { cancelOpenPlayMatch } from '../lib/cancel-open-play-match.js';
import { slotsActiveAtWhere } from '../lib/availability-time.js';
import { isCompetitorMember } from '../lib/competitors.js';

const openPlayQueueRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/open-play/queue — join queue (all checks live in joinOpenPlayQueue, shared with Discord)
  fastify.post(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsedPrefs = QueueJoinSchema.safeParse(request.body ?? {});
      if (!parsedPrefs.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsedPrefs.error.message, statusCode: 400 });
      }
      const result = await joinOpenPlayQueue(fastify, request.user.sub, parsedPrefs.data);
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          error: result.error,
          message: result.message,
          statusCode: result.statusCode,
          ...(result.code === 'STEAM_REQUIRED' ? { code: result.code } : {}),
        });
      }
      if (result.matched) {
        return reply.code(200).send({ matched: true, match_id: result.matchId, fellBackTo1v1: result.fellBackTo1v1 });
      }
      return reply.code(200).send({ matched: false, position: result.position, fellBackTo1v1: result.fellBackTo1v1 });
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
      await leaveOpenPlayQueue(fastify, request.user.sub);
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
