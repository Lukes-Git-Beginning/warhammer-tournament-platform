import type { FastifyPluginAsync } from 'fastify';
import { verify as cryptoVerify, createPublicKey } from 'crypto';
import {
  notifyResultPending,
  notifyCancelPending,
  notifyReplayReminder,
  notifyMatchCancelledBothPlayers,
  notifyOpenPlayDispute,
  notifyMatchFoundWithButtons,
  sendDm,
} from '../lib/discord-notify.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';
import { invalidate } from '../lib/cache.js';

const QUEUE_KEY = 'rizzotto:queue:open_play';
const FOR_GRABS_PREFIX = 'rizzotto:availability:for_grabs:';
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

const PING = 1;
const MESSAGE_COMPONENT = 3;
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;

// Discord signs each interaction with Ed25519. Node's streaming createVerify()
// does NOT support Ed25519 — it throws "Invalid digest" — so the one-shot
// crypto.verify() must be used. Discord exposes the public key as a raw 32-byte
// hex string; wrap it in an SPKI DER envelope to build a usable KeyObject.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function ed25519PublicKeyFromHex(publicKeyHex: string) {
  const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function verifyDiscordSignature(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(timestamp + body),
      ed25519PublicKeyFromHex(publicKey),
      Buffer.from(signature, 'hex'),
    );
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
  // Keep body as raw buffer so Discord's Ed25519 signature can be verified over
  // the exact original bytes. Using 'buffer' (not 'string') is more reliable across
  // Fastify versions since string encoding can vary.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  fastify.post(
    '/api/discord/interactions',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) return reply.code(503).send({ error: 'Service not configured' });

      const signature = request.headers['x-signature-ed25519'] as string | undefined;
      const timestamp = request.headers['x-signature-timestamp'] as string | undefined;
      if (!signature || !timestamp) return reply.code(401).send({ error: 'Missing signature headers' });

      // Body arrives as Buffer (parseAs: 'buffer') — convert to UTF-8 string.
      // Log the body type so we can diagnose parsing issues in server logs.
      const bodyRaw = request.body;
      const rawBody = Buffer.isBuffer(bodyRaw)
        ? bodyRaw.toString('utf-8')
        : typeof bodyRaw === 'string'
          ? bodyRaw
          : JSON.stringify(bodyRaw);
      fastify.log.info({ bodyType: typeof bodyRaw, isBuffer: Buffer.isBuffer(bodyRaw) }, '[discord] body received');

      if (!verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
        fastify.log.warn({ bodyType: typeof bodyRaw, isBuffer: Buffer.isBuffer(bodyRaw) }, '[discord] signature verification failed');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
      fastify.log.info('[discord] signature ok');

      const interaction = JSON.parse(rawBody) as {
        type: number;
        token: string;
        application_id: string;
        data?: { custom_id?: string };
        member?: { user: { id: string } };
        user?: { id: string };
      };

      if (interaction.type === PING) return reply.code(200).send({ type: PONG });
      if (interaction.type !== MESSAGE_COMPONENT) return reply.code(200).send(ephemeral('Unknown interaction type'));

      const discordId = interaction.member?.user.id ?? interaction.user?.id;
      if (!discordId) return reply.code(200).send(ephemeral('Could not identify user.'));

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

        await fastify.prisma.match.update({
          where: { id: matchId },
          data: { status: 'AWAITING_CONFIRMATION' },
        });

        if (outcome === 'cancel') {
          setImmediate(() => void notifyCancelPending(opponent.discord_id!, discordId, matchId));
          return reply.code(200).send(ephemeral(`Cancellation request sent to **${opponent.username}**. Waiting for their response.`));
        }

        const winnerId = outcome === 'win' ? actor.id : opponentId;
        setImmediate(() => void notifyResultPending(opponent.discord_id!, discordId, matchId, winnerId));
        return reply.code(200).send(ephemeral(`Result reported. Waiting for **${opponent.username}** to confirm.`));
      }

      // op_confirm:<matchId>:<winnerId>
      if (action === 'op_confirm') {
        const [, matchId, winnerId] = parts;
        if (!matchId || !winnerId) return reply.code(200).send(ephemeral('Invalid button.'));

        const match = await fastify.prisma.match.findFirst({
          where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
          select: { id: true, status: true },
        });
        if (!match || match.status !== 'AWAITING_CONFIRMATION') {
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
        setImmediate(() => void notifyOpenPlayDispute(matchId, discordId));

        return reply.code(200).send(ephemeral('Dispute submitted. A moderator has been notified and will review the match.'));
      }

      // op_cancel_accept:<matchId>
      if (action === 'op_cancel_accept') {
        const [, matchId] = parts;
        if (!matchId) return reply.code(200).send(ephemeral('Invalid button.'));

        const match = await fastify.prisma.match.findFirst({
          where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
          select: { id: true, status: true, player1_id: true, player2_id: true },
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

        // Notify both players with Queue Again button
        const [p1, p2] = await Promise.all([
          match.player1_id ? fastify.prisma.user.findUnique({ where: { id: match.player1_id }, select: { discord_id: true } }) : null,
          match.player2_id ? fastify.prisma.user.findUnique({ where: { id: match.player2_id }, select: { discord_id: true } }) : null,
        ]);
        if (p1?.discord_id && p2?.discord_id) {
          setImmediate(() => void notifyMatchCancelledBothPlayers(p1.discord_id!, p2.discord_id!));
        }

        return reply.code(200).send(ephemeral('Match cancelled. No result has been recorded.'));
      }

      // op_queue:<actorDiscordId> — Queue Again button
      if (action === 'op_queue') {
        const [, actorDiscordId] = parts;
        if (actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const user = await fastify.prisma.user.findFirst({
          where: { discord_id: discordId, deleted_at: null },
          select: { id: true, username: true },
        });
        if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

        const existing = await fastify.redis.lpos(QUEUE_KEY, user.id);
        if (existing !== null) return reply.code(200).send(ephemeral("You're already in the queue."));

        const result = await fastify.redis.eval(MATCH_SCRIPT, 1, QUEUE_KEY, user.id, FOR_GRABS_PREFIX) as [string, string] | false | null;

        if (Array.isArray(result) && result.length === 2) {
          const [p1Id, p2Id] = result;
          const [p1, p2] = await Promise.all([
            fastify.prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
            fastify.prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
          ]);
          const { matchId, mapName } = await createOpenPlayMatch(fastify.prisma, p1Id, p2Id);
          if (p1?.discord_id && p2?.discord_id) {
            setImmediate(() => void notifyMatchFoundWithButtons(
              matchId,
              { discordId: p1.discord_id!, username: p1.username },
              { discordId: p2.discord_id!, username: p2.username },
              mapName,
            ));
          }
          const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
          const opponent = p1Id === user.id ? p2 : p1;
          return reply.code(200).send(ephemeral(`Match found! vs **${opponent?.username ?? 'opponent'}** → ${matchUrl}`));
        }

        const position = await fastify.redis.llen(QUEUE_KEY);
        return reply.code(200).send(ephemeral(`You're in the queue (position ${position}). You'll get a DM when a match is found.`));
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

        await fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'ONGOING' } });
        return reply.code(200).send(ephemeral('Cancel rejected. Match is still active — report the result on the website if needed.'));
      }

      // sc_ready:<matchupId>:<clickerDiscordId> — "I'm Ready" button from 1h reminder
      if (action === 'sc_ready') {
        const [, matchupId, clickerDiscordId] = parts;
        if (!matchupId || !clickerDiscordId) return reply.code(200).send(ephemeral('Invalid button.'));
        if (clickerDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));

        const matchup = await fastify.prisma.scheduledMatchup.findUnique({
          where: { id: matchupId },
          include: {
            proposer: { select: { id: true, username: true, discord_id: true } },
            accepted_by: { select: { id: true, username: true, discord_id: true } },
          },
        });

        if (!matchup || matchup.status !== 'ACCEPTED') {
          return reply.code(200).send(ephemeral('This challenge is no longer active.'));
        }

        const isProposer = matchup.proposer.discord_id === discordId;
        const isAcceptor = matchup.accepted_by?.discord_id === discordId;
        if (!isProposer && !isAcceptor) return reply.code(200).send(ephemeral('This button is not for you.'));

        const clicker = isProposer ? matchup.proposer : matchup.accepted_by!;
        const other = isProposer ? matchup.accepted_by : matchup.proposer;

        if (!other?.discord_id) return reply.code(200).send(ephemeral('Could not find your opponent.'));

        const ts = Math.floor(matchup.proposed_at.getTime() / 1000);
        setImmediate(() => void sendDm(
          other.discord_id!,
          `✅ **${clicker.username}** confirmed they'll be ready for your match <t:${ts}:R>!`,
        ));

        return reply.code(200).send(ephemeral(`✅ Confirmed! **${other.username}** has been notified.`));
      }

      // av_snooze:<duration>:<actorDiscordId> — snooze availability pings
      if (action === 'av_snooze') {
        const [, duration, actorDiscordId] = parts;
        if (!duration || !actorDiscordId) return reply.code(200).send(ephemeral('Invalid button.'));
        if (actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Service temporarily unavailable.'));

        const user = await fastify.prisma.user.findFirst({
          where: { discord_id: discordId, deleted_at: null },
          select: { id: true },
        });
        if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

        let ttl: number;
        let label: string;
        if (duration === '1h') { ttl = 3600; label = '1 hour'; }
        else if (duration === '4h') { ttl = 4 * 3600; label = '4 hours'; }
        else {
          const now = new Date();
          const midnight = new Date(now);
          midnight.setUTCHours(24, 0, 0, 0);
          ttl = Math.max(60, Math.floor((midnight.getTime() - now.getTime()) / 1000));
          label = 'the rest of today';
        }

        await fastify.redis.setex(`rizzotto:availability:snooze:${user.id}`, ttl, '1');
        return reply.code(200).send(ephemeral(`Got it — no more queue pings for ${label}. Your availability is still saved.`));
      }

      // av_join:<actorDiscordId>:<originUserId> — direct match from availability ping DM.
      // Uses Discord's deferred response pattern (type 5) to avoid the 3s timeout window:
      // we acknowledge immediately, then do all async work, then PATCH the deferred message.
      if (action === 'av_join') {
        const [, actorDiscordId, originUserId] = parts;
        if (!actorDiscordId || actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const { token: iToken, application_id: appId } = interaction;
        const patchDeferred = async (content: string) => {
          try {
            await fetch(`https://discord.com/api/v10/webhooks/${appId}/${iToken}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            });
          } catch (err) {
            console.error('[discord-interactions] patch deferred error:', err);
          }
        };

        // Kick off background work before replying so state is captured in the closure.
        const redis = fastify.redis;
        const prisma = fastify.prisma;
        setImmediate(() => void (async () => {
          try {
            const grabKey = originUserId ? `${FOR_GRABS_PREFIX}${originUserId}` : null;
            const GET_DEL_SCRIPT = `local v=redis.call('GET',KEYS[1]) if v then redis.call('DEL',KEYS[1]) end return v`;

            const [user, claimed] = await Promise.all([
              prisma.user.findFirst({
                where: { discord_id: discordId, deleted_at: null },
                select: { id: true, username: true },
              }),
              grabKey
                ? redis.eval(GET_DEL_SCRIPT, 1, grabKey) as Promise<string | null>
                : Promise.resolve(null),
            ]);

            if (!user) { await patchDeferred('You need to log in at rizzotto.gg first.'); return; }
            if (user.id === originUserId) { await patchDeferred("That's your own queue slot."); return; }

            if (claimed && originUserId) {
              const [removed, origin] = await Promise.all([
                redis.lrem(QUEUE_KEY, 1, originUserId),
                prisma.user.findUnique({ where: { id: originUserId }, select: { username: true, discord_id: true } }),
              ]);
              if (removed > 0) {
                const { matchId, mapName } = await createOpenPlayMatch(prisma, originUserId, user.id);
                if (origin?.discord_id) {
                  setImmediate(() => void notifyMatchFoundWithButtons(
                    matchId,
                    { discordId: origin.discord_id!, username: origin.username },
                    { discordId: discordId, username: user.username },
                    mapName,
                  ));
                }
                const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
                await patchDeferred(`Match found! vs **${origin?.username ?? 'opponent'}** → ${matchUrl}`);
                return;
              }
            }

            const existing = await redis.lpos(QUEUE_KEY, user.id);
            if (existing !== null) { await patchDeferred("You're already in the queue."); return; }

            const result = await redis.eval(MATCH_SCRIPT, 1, QUEUE_KEY, user.id, FOR_GRABS_PREFIX) as [string, string] | false | null;

            if (Array.isArray(result) && result.length === 2) {
              const [p1Id, p2Id] = result;
              const [p1, p2] = await Promise.all([
                prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
                prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
              ]);
              const { matchId, mapName } = await createOpenPlayMatch(prisma, p1Id, p2Id);
              if (p1?.discord_id && p2?.discord_id) {
                setImmediate(() => void notifyMatchFoundWithButtons(
                  matchId,
                  { discordId: p1.discord_id!, username: p1.username },
                  { discordId: p2.discord_id!, username: p2.username },
                  mapName,
                ));
              }
              const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
              const opponent = p1Id === user.id ? p2 : p1;
              await patchDeferred(`Match found! vs **${opponent?.username ?? 'opponent'}** → ${matchUrl}`);
              return;
            }

            const position = await redis.llen(QUEUE_KEY);
            await patchDeferred(`You're in the queue (position ${position}). You'll get a DM when a match is found.`);
          } catch (err) {
            console.error('[discord-interactions] av_join error:', err);
            await patchDeferred('Something went wrong. Please join the queue on rizzotto.gg directly.');
          }
        })());

        // Acknowledge immediately — Discord's 3s window is never an issue with this pattern.
        return reply.code(200).send({ type: 5, data: { flags: 64 } });
      }

      return reply.code(200).send(ephemeral('Unknown button.'));
    },
  );
};

export default discordInteractionsRoutes;
