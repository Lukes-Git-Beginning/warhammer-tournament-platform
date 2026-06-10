import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendDm } from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';

const QueueJoinSchema = z.object({
  format: z.enum(['BO1', 'BO3', 'BO5']),
});

function queueKey(format: string) {
  return `rizzotto:queue:open_play:${format}`;
}

// Atomically push userId and try to match: returns [p1, p2] or null
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
      const parsed = QueueJoinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      if (!fastify.redis) {
        return reply.code(503).send({ error: 'ServiceUnavailable', message: 'Queue service unavailable', statusCode: 503 });
      }

      const { format } = parsed.data;
      const key = queueKey(format);

      // Check for duplicate queue entry
      const pos = await fastify.redis.lpos(key, userId);
      if (pos !== null) {
        return reply.code(409).send({ error: 'Conflict', message: 'Already in queue', statusCode: 409 });
      }

      const result = (await fastify.redis.eval(MATCH_SCRIPT, 1, key, userId)) as [string, string] | false | null;

      if (Array.isArray(result) && result.length === 2) {
        const [p1Id, p2Id] = result;

        const { matchId, mapName } = await createOpenPlayMatch(fastify.prisma, p1Id, p2Id);

        const [p1, p2] = await Promise.all([
          fastify.prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
          fastify.prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
        ]);

        const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
        const mapLine = mapName ? ` · Map: **${mapName}**` : '';
        const dm = (opp: string) => `Match found! ${format} vs **${opp}**${mapLine} — pick your faction → ${matchUrl}`;

        await Promise.allSettled([
          p1?.discord_id ? sendDm(p1.discord_id, dm(p2?.username ?? 'your opponent')) : Promise.resolve(),
          p2?.discord_id ? sendDm(p2.discord_id, dm(p1?.username ?? 'your opponent')) : Promise.resolve(),
        ]);

        return reply.code(200).send({ matched: true, match_id: matchId });
      }

      return reply.code(200).send({ matched: false, position: await fastify.redis.llen(key) });
    },
  );

  // DELETE /api/open-play/queue — leave queue
  fastify.delete(
    '/api/open-play/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const query = request.query as { format?: string };
      const format = query.format ?? 'BO1';

      if (!fastify.redis) {
        return reply.code(204).send();
      }

      await fastify.redis.lrem(queueKey(format), 0, userId);
      return reply.code(204).send();
    },
  );

  // GET /api/open-play/queue/status — queue position per format
  fastify.get(
    '/api/open-play/queue/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;

      if (!fastify.redis) {
        return reply.code(200).send({ queued: [] });
      }

      const formats = ['BO1', 'BO3', 'BO5'] as const;
      const queued: Array<{ format: string; position: number; total: number }> = [];

      for (const format of formats) {
        const key = queueKey(format);
        const pos = await fastify.redis.lpos(key, userId);
        if (pos !== null) {
          const total = await fastify.redis.llen(key);
          queued.push({ format, position: pos + 1, total });
        }
      }

      return reply.code(200).send({ queued });
    },
  );
};

export default openPlayQueueRoutes;
