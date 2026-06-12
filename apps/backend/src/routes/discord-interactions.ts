import type { FastifyPluginAsync } from 'fastify';
import { createVerify } from 'crypto';
import {
  notifyMatchFoundWithButtons,
  notifyResultPending,
  notifyCancelPending,
  notifyReplayReminder,
  notifyOpenPlayDispute,
} from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';
import { invalidate } from '../lib/cache.js';

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;

const QUEUE_KEY_HOSTS = 'rizzotto:queue:open_play:hosts'; // hash: discordId -> lobbyCode|""
const QUEUE_KEY_JOINERS = 'rizzotto:queue:open_play:joiners'; // list: discordId

// Legacy queue key — kept for in-flight entries during rollout
const QUEUE_KEY_LEGACY = 'rizzotto:queue:open_play';

// Atomic: push host into hash, try to pop a joiner. Returns [hostId, code, joinerId] or false.
const HOST_MATCH_SCRIPT = `
local hosts = KEYS[1]
local joiners = KEYS[2]
local hostId = ARGV[1]
local code = ARGV[2]
local joiner = redis.call('LPOP', joiners)
if joiner then
  return {hostId, code, joiner}
end
redis.call('HSET', hosts, hostId, code)
return false
`;

// Atomic: push joiner into list, try to pop a host. Returns [hostId, code, joinerId] or false.
const JOINER_MATCH_SCRIPT = `
local hosts = KEYS[1]
local joiners = KEYS[2]
local joinerId = ARGV[1]
local host = redis.call('HRANDFIELD', hosts)
if host then
  local code = redis.call('HGET', hosts, host)
  redis.call('HDEL', hosts, host)
  return {host, code or '', joinerId}
end
redis.call('RPUSH', joiners, joinerId)
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

async function invalidateScoringCaches(redis: import('ioredis').Redis | undefined): Promise<void> {
  if (!redis) return;
  await Promise.all([
    invalidate(redis, 'leaderboard:*'),
    invalidate(redis, 'factions:*'),
    invalidate(redis, 'meta:*'),
    invalidate(redis, 'rating-model:*'),
  ]);
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
        data?: { name?: string; custom_id?: string; options?: { name: string; value: string }[] };
        member?: { user: { id: string } };
        user?: { id: string };
      };

      if (interaction.type === PING) return reply.code(200).send({ type: PONG });

      const discordId = interaction.member?.user.id ?? interaction.user?.id;
      if (!discordId) return reply.code(200).send(ephemeral('Could not identify user.'));

      // -----------------------------------------------------------------------
      // Button interactions
      // -----------------------------------------------------------------------
      if (interaction.type === MESSAGE_COMPONENT) {
        const customId = interaction.data?.custom_id ?? '';
        const parts = customId.split(':');
        const action = parts[0];

        // op_declare:<win|loss|cancel>:<matchId>:<actorDiscordId>
        if (action === 'op_declare') {
          const [, outcome, matchId, actorDiscordId] = parts;
          if (!outcome || !matchId || !actorDiscordId) return reply.code(200).send(ephemeral('Invalid button.'));
          if (actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));

          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
            select: { id: true, status: true, player1_id: true, player2_id: true },
          });
          if (!match) return reply.code(200).send(ephemeral('Match not found.'));
          if (match.status !== 'ONGOING') {
            return reply.code(200).send(ephemeral('This match has already been resolved or is awaiting confirmation.'));
          }

          const actor = await fastify.prisma.user.findFirst({
            where: { discord_id: discordId, deleted_at: null },
            select: { id: true, username: true },
          });
          if (!actor) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

          const isPlayer1 = match.player1_id === actor.id;
          const isPlayer2 = match.player2_id === actor.id;
          if (!isPlayer1 && !isPlayer2) return reply.code(200).send(ephemeral('You are not a player in this match.'));

          const opponentId = isPlayer1 ? match.player2_id : match.player1_id;
          if (!opponentId) return reply.code(200).send(ephemeral('Opponent not found.'));

          const opponent = await fastify.prisma.user.findUnique({
            where: { id: opponentId },
            select: { discord_id: true, username: true },
          });
          if (!opponent?.discord_id) return reply.code(200).send(ephemeral('Opponent has no Discord linked.'));

          // Lock the match to prevent concurrent declarations
          await fastify.prisma.match.update({
            where: { id: matchId },
            data: { status: 'AWAITING_CONFIRMATION' },
          });

          if (outcome === 'cancel') {
            setImmediate(() => void notifyCancelPending(opponent.discord_id!, actor.username, matchId));
            return reply.code(200).send(ephemeral(`Cancellation request sent to **${opponent.username}**. Waiting for their response.`));
          }

          const winnerId = outcome === 'win' ? actor.id : opponentId;
          setImmediate(() => void notifyResultPending(opponent.discord_id!, actor.username, matchId, winnerId));
          return reply.code(200).send(ephemeral(`Result reported. Waiting for **${opponent.username}** to confirm.`));
        }

        // op_confirm:<matchId>:<winnerId>
        if (action === 'op_confirm') {
          const [, matchId, winnerId] = parts;
          if (!matchId || !winnerId) return reply.code(200).send(ephemeral('Invalid button.'));

          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
            select: { id: true, status: true, player1_id: true, player2_id: true },
          });
          if (!match) return reply.code(200).send(ephemeral('Match not found.'));
          if (match.status !== 'AWAITING_CONFIRMATION') {
            return reply.code(200).send(ephemeral('This match is not awaiting confirmation.'));
          }

          const confirmer = await fastify.prisma.user.findFirst({
            where: { discord_id: discordId, deleted_at: null },
            select: { id: true },
          });
          if (!confirmer) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));
          if (confirmer.id === winnerId) return reply.code(200).send(ephemeral('You cannot confirm your own result.'));

          const winner = await fastify.prisma.user.findUnique({
            where: { id: winnerId },
            select: { discord_id: true },
          });

          await fastify.prisma.$transaction(async (tx) => {
            await tx.match.update({
              where: { id: matchId },
              data: { status: 'COMPLETED', winner_id: winnerId, played_at: new Date() },
            });
            // counts_for_leaderboard=false until replay uploaded
            await tx.matchGame.updateMany({
              where: { match_id: matchId },
              data: { winner_id: winnerId, counts_for_leaderboard: false, status: 'COMPLETED', played_at: new Date() },
            });
          });

          await invalidateScoringCaches(fastify.redis);

          if (winner?.discord_id) {
            setImmediate(() => void notifyReplayReminder(winner.discord_id!, matchId));
          }

          return reply.code(200).send(ephemeral('Match confirmed! The winner has been notified to upload their replay.'));
        }

        // op_dispute:<matchId>:<winnerId>
        if (action === 'op_dispute') {
          const [, matchId] = parts;
          if (!matchId) return reply.code(200).send(ephemeral('Invalid button.'));

          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
            select: { id: true, status: true },
          });
          if (!match || match.status !== 'AWAITING_CONFIRMATION') {
            return reply.code(200).send(ephemeral('Nothing to dispute right now.'));
          }

          const disputer = await fastify.prisma.user.findFirst({
            where: { discord_id: discordId, deleted_at: null },
            select: { id: true, username: true },
          });
          if (!disputer) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

          await fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'DISPUTED' } });
          setImmediate(() => void notifyOpenPlayDispute(matchId, disputer.username));

          return reply.code(200).send(ephemeral('Dispute submitted. A moderator has been notified and will review the match.'));
        }

        // op_cancel_accept:<matchId>
        if (action === 'op_cancel_accept') {
          const [, matchId] = parts;
          if (!matchId) return reply.code(200).send(ephemeral('Invalid button.'));

          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
            select: { id: true, status: true },
          });
          if (!match || match.status !== 'AWAITING_CONFIRMATION') {
            return reply.code(200).send(ephemeral('Nothing to accept right now.'));
          }

          await fastify.prisma.$transaction(async (tx) => {
            await tx.match.update({ where: { id: matchId }, data: { status: 'CANCELLED' } });
            await tx.matchGame.updateMany({
              where: { match_id: matchId },
              data: { counts_for_leaderboard: false, status: 'COMPLETED' },
            });
          });

          return reply.code(200).send(ephemeral('Match cancelled. No result has been recorded.'));
        }

        // op_cancel_dispute:<matchId>:<opponentDiscordId>
        if (action === 'op_cancel_dispute') {
          const [, matchId] = parts;
          if (!matchId) return reply.code(200).send(ephemeral('Invalid button.'));

          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
            select: { id: true, status: true },
          });
          if (!match || match.status !== 'AWAITING_CONFIRMATION') {
            return reply.code(200).send(ephemeral('Nothing to dispute right now.'));
          }

          // Restore to ONGOING — cancel rejected
          await fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'ONGOING' } });
          return reply.code(200).send(ephemeral('Cancel rejected. Match is still active — report the result on the website if needed.'));
        }

        return reply.code(200).send(ephemeral('Unknown button.'));
      }

      // -----------------------------------------------------------------------
      // Slash commands
      // -----------------------------------------------------------------------
      if (interaction.type !== APPLICATION_COMMAND) {
        return reply.code(200).send(ephemeral('Unknown interaction type'));
      }

      const commandName = interaction.data?.name;
      const user = await fastify.prisma.user.findFirst({
        where: { discord_id: discordId, deleted_at: null },
        select: { id: true, username: true },
      });
      if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

      // /rizzotto unqueue
      if (commandName === 'unqueue') {
        if (fastify.redis) {
          await Promise.all([
            fastify.redis.hdel(QUEUE_KEY_HOSTS, discordId),
            fastify.redis.lrem(QUEUE_KEY_JOINERS, 0, discordId),
            fastify.redis.lrem(QUEUE_KEY_LEGACY, 0, user.id),
          ]);
        }
        return reply.code(200).send(ephemeral('Removed from the queue.'));
      }

      // /rizzotto queue [code]
      if (commandName === 'queue') {
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const lobbyCode = interaction.data?.options?.find((o) => o.name === 'code')?.value ?? '';

        const [inHosts, inJoiners] = await Promise.all([
          fastify.redis.hexists(QUEUE_KEY_HOSTS, discordId),
          fastify.redis.lpos(QUEUE_KEY_JOINERS, discordId),
        ]);
        if (inHosts || inJoiners !== null) {
          return reply.code(200).send(ephemeral("You're already in the queue. Use /rizzotto unqueue to leave."));
        }

        let matchResult: [string, string, string] | null = null;

        if (lobbyCode) {
          const raw = await fastify.redis.eval(HOST_MATCH_SCRIPT, 2, QUEUE_KEY_HOSTS, QUEUE_KEY_JOINERS, discordId, lobbyCode);
          if (Array.isArray(raw) && raw.length === 3) matchResult = raw as [string, string, string];
        } else {
          const raw = await fastify.redis.eval(JOINER_MATCH_SCRIPT, 2, QUEUE_KEY_HOSTS, QUEUE_KEY_JOINERS, discordId);
          if (Array.isArray(raw) && raw.length === 3) matchResult = raw as [string, string, string];
        }

        if (matchResult) {
          const [hostDiscordId, code, joinerDiscordId] = matchResult;

          const [hostUser, joinerUser] = await Promise.all([
            fastify.prisma.user.findFirst({ where: { discord_id: hostDiscordId, deleted_at: null }, select: { id: true, username: true } }),
            fastify.prisma.user.findFirst({ where: { discord_id: joinerDiscordId, deleted_at: null }, select: { id: true, username: true } }),
          ]);

          if (!hostUser || !joinerUser) {
            return reply.code(200).send(ephemeral('Match failed — a player is no longer registered. Please try again.'));
          }

          const { matchId, mapName } = await createOpenPlayMatch(fastify.prisma, hostUser.id, joinerUser.id);

          setImmediate(() => void notifyMatchFoundWithButtons(
            matchId,
            { discordId: hostDiscordId, username: hostUser.username },
            { discordId: joinerDiscordId, username: joinerUser.username },
            mapName,
          ));

          const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
          const opponentName = discordId === hostDiscordId ? joinerUser.username : hostUser.username;
          const codeLine = code && discordId === joinerDiscordId ? ` · Lobby code: **${code}**` : '';
          return reply.code(200).send(ephemeral(`Match found! vs **${opponentName}**${codeLine} → ${matchUrl}`));
        }

        const position = lobbyCode
          ? (await fastify.redis.hlen(QUEUE_KEY_HOSTS))
          : (await fastify.redis.llen(QUEUE_KEY_JOINERS));
        const waitMsg = lobbyCode
          ? `You're hosting (position ${position}). You'll get a DM when a joiner is found.`
          : `You're in the queue (position ${position}). You'll get a DM when a host is found.`;

        return reply.code(200).send(ephemeral(waitMsg));
      }

      return reply.code(200).send(ephemeral('Unknown command.'));
    },
  );
};

export default discordInteractionsRoutes;
