import type { FastifyPluginAsync } from 'fastify';
import { createVerify } from 'crypto';
import { sendDm } from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;

const QUEUE_KEY = 'rizzotto:queue:open_play';

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

function verifyDiscordSignature(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  try {
    const verify = createVerify('ed25519');
    verify.update(timestamp + body);
    return verify.verify(Buffer.from(publicKey, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function ephemeral(content: string) {
  return { type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: 64 } };
}

const discordInteractionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/discord/interactions',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) return reply.code(503).send({ error: 'Service not configured' });

      const signature = request.headers['x-signature-ed25519'] as string | undefined;
      const timestamp = request.headers['x-signature-timestamp'] as string | undefined;
      if (!signature || !timestamp) return reply.code(401).send({ error: 'Missing signature headers' });

      const rawBody = JSON.stringify(request.body);
      if (!verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const interaction = request.body as {
        type: number;
        data?: { name: string };
        member?: { user: { id: string } };
        user?: { id: string };
      };

      if (interaction.type === PING) return reply.code(200).send({ type: PONG });
      if (interaction.type !== APPLICATION_COMMAND) return reply.code(200).send(ephemeral('Unknown interaction type'));

      const commandName = interaction.data?.name;
      const discordId = interaction.member?.user.id ?? interaction.user?.id;
      if (!discordId) return reply.code(200).send(ephemeral('Could not identify user.'));

      const user = await fastify.prisma.user.findFirst({
        where: { discord_id: discordId, deleted_at: null },
        select: { id: true, username: true },
      });
      if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

      // /rizzotto unqueue
      if (commandName === 'unqueue') {
        if (fastify.redis) await fastify.redis.lrem(QUEUE_KEY, 0, user.id);
        return reply.code(200).send(ephemeral('Removed from the queue.'));
      }

      // /rizzotto queue
      if (commandName === 'queue') {
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const existing = await fastify.redis.lpos(QUEUE_KEY, user.id);
        if (existing !== null) {
          return reply.code(200).send(ephemeral('You\'re already in the queue. Use /rizzotto unqueue to leave.'));
        }

        const result = (await fastify.redis.eval(MATCH_SCRIPT, 1, QUEUE_KEY, user.id)) as [string, string] | false | null;

        if (Array.isArray(result) && result.length === 2) {
          const [p1Id, p2Id] = result;
          const { matchId, mapName } = await createOpenPlayMatch(fastify.prisma, p1Id, p2Id);

          const [p1, p2] = await Promise.all([
            fastify.prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
            fastify.prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
          ]);

          const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
          const mapLine = mapName ? ` · Map: **${mapName}**` : '';
          const opponent = p1Id === user.id ? p2 : p1;

          setImmediate(() => {
            const dm = (opp: string) => `Match found! Open Play vs **${opp}**${mapLine} — pick your faction → ${matchUrl}`;
            void (p1?.discord_id ? sendDm(p1.discord_id, dm(p2?.username ?? '?')) : Promise.resolve());
            void (p2?.discord_id ? sendDm(p2.discord_id, dm(p1?.username ?? '?')) : Promise.resolve());
          });

          return reply.code(200).send(ephemeral(`Match found! vs **${opponent?.username ?? 'your opponent'}**${mapLine} → ${matchUrl}`));
        }

        const queueLength = await fastify.redis.llen(QUEUE_KEY);
        return reply.code(200).send(ephemeral(`You're in the queue (position ${queueLength}). You'll get a DM when a match is found.`));
      }

      return reply.code(200).send(ephemeral('Unknown command.'));
    },
  );
};

export default discordInteractionsRoutes;
