import type { FastifyPluginAsync } from 'fastify';
import { notifyMatchFoundWithButtons } from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';

const QUEUE_KEY = 'rizzotto:queue:open_play';

// Atomically push userId and try to match: returns [p1, p2] or false
const MATCH_SCRIPT = `
local queue = KEYS[1]
local userId = ARGV[1]
redis.call('RPUSH', queue, userId)
local len = redis.call('LLEN', queue)
if len >= 2 then
  local p1 = redis.call('LPOP', queue)
  local p2 = redis.call('LPOP', queue)
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

      const result = (await fastify.redis.eval(MATCH_SCRIPT, 1, QUEUE_KEY, userId)) as [string, string] | false | null;

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

        return reply.code(200).send({ matched: true, match_id: matchId });
      }

      return reply.code(200).send({ matched: false, position: await fastify.redis.llen(QUEUE_KEY) });
    },
  );

  // DELETE /api/open-play/queue — leave queue
  fastify.delete(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      if (fastify.redis) await fastify.redis.lrem(QUEUE_KEY, 0, userId);
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
