import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { verify as cryptoVerify, createPublicKey } from 'crypto';
import { sendDm } from '../lib/discord-notify.js';
import { nextMidnightIn } from '../lib/site-time.js';
import { decodeOffer } from '../lib/queue-matching.js';
import { claimQueueOffer } from '../lib/queue-offer.js';
import { resolveCompetitors } from '../lib/competitors.js';
import { joinOpenPlayQueue } from '../lib/open-play-queue-service.js';
import { handleOpenPlayInteraction, type Interaction } from '../lib/discord-open-play-interactions.js';

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

// Discord's deferred-response pattern: acknowledge within 3s (type 5), then PATCH @original.
function makeDeferredPatch(appId: string, iToken: string) {
  return async (content: string, components?: object[]) => {
    try {
      await fetch(`https://discord.com/api/v10/webhooks/${appId}/${iToken}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(components ? { content, components } : { content }),
      });
    } catch (err) {
      console.error('[discord-interactions] patch deferred error:', err);
    }
  };
}

// Join the Open Play queue from a Discord button (Queue Again / opt-in) with the player's STORED
// settings, through the same joinOpenPlayQueue as the site (cooldown, active match, Steam, …).
async function joinQueueViaDiscord(
  fastify: FastifyInstance,
  userId: string,
): Promise<ReturnType<typeof ephemeral>> {
  const result = await joinOpenPlayQueue(fastify, userId, {});
  if (!result.ok) return ephemeral(result.code === 'QUEUED' ? "You're already in the queue." : result.message);
  if (result.matched) {
    const match = await fastify.prisma.match.findUnique({ where: { id: result.matchId }, select: { player1_id: true, player2_id: true } });
    const opponentId = match?.player1_id === result.queueId ? match?.player2_id : match?.player1_id;
    const opponent = opponentId ? (await resolveCompetitors(fastify.prisma, [opponentId])).get(opponentId) : null;
    const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${result.matchId}`;
    return ephemeral(`Match found! vs **${opponent?.username ?? 'opponent'}** → ${matchUrl}`);
  }
  return ephemeral(`You're in the queue (position ${result.position}). You'll get a DM when a match is found.`);
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

      const interaction = JSON.parse(rawBody) as Interaction;

      if (interaction.type === PING) return reply.code(200).send({ type: PONG });

      // Discord Open Play: /join, the join DM, the ticker and the match card.
      const openPlay = await handleOpenPlayInteraction(fastify, interaction);
      if (openPlay) return reply.code(200).send(openPlay);

      if (interaction.type !== MESSAGE_COMPONENT) return reply.code(200).send(ephemeral('Unknown interaction type'));

      const discordId = interaction.member?.user.id ?? interaction.user?.id;
      if (!discordId) return reply.code(200).send(ephemeral('Could not identify user.'));

      const customId = interaction.data?.custom_id ?? '';
      const parts = customId.split(':');
      const action = parts[0];

      // op_queue:<actorDiscordId> — Queue Again button
      if (action === 'op_queue') {
        const [, actorDiscordId] = parts;
        if (actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const user = await fastify.prisma.user.findFirst({
          where: { discord_id: discordId, deleted_at: null },
          select: { id: true },
        });
        if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

        return reply.code(200).send(await joinQueueViaDiscord(fastify, user.id));
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
          select: { id: true, timezone: true },
        });
        if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

        let ttl: number;
        let label: string;
        if (duration === '1h') { ttl = 3600; label = '1 hour'; }
        else if (duration === '4h') { ttl = 4 * 3600; label = '4 hours'; }
        else {
          // "Today" ends at midnight in the USER's own timezone (site time if unknown), not UTC.
          const now = new Date();
          const midnight = nextMidnightIn(user.timezone, now);
          ttl = Math.max(60, Math.floor((midnight.getTime() - now.getTime()) / 1000));
          label = 'the rest of today';
        }

        await fastify.redis.setex(`rizzotto:availability:snooze:${user.id}`, ttl, '1');
        return reply.code(200).send(ephemeral(`Got it — no more queue pings for ${label}. Your availability is still saved.`));
      }

      // av_join:<actorDiscordId> — [Match Now] from OLD availability DMs (the wave sends av_offer
      // since v2.18). It paired the clicker with the oldest queuer as a Domination 1v1 Bo1 match,
      // whatever both had queued for, so it is retired: point the player to the current entries.
      if (action === 'av_join') {
        return reply.code(200).send(ephemeral('This button is from an older message. Use /join, or join on rizzotto.gg/open-play.'));
      }

      // av_offer:<actorDiscordId>:<battle type letter>:<format digit>:<team size> — "Join: Conquest
      // 1v1 Bo1" from the availability DM. Pairs the clicker with a waiting entry that fits exactly
      // that offer. Never joins the queue and never changes the stored queue settings; if the offer
      // is gone the player just gets the "nobody in the queue" message and nothing stays behind.
      if (action === 'av_offer') {
        const [, actorDiscordId, ...offerParts] = parts;
        if (!actorDiscordId || actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));
        const offer = decodeOffer(offerParts);
        if (!offer) return reply.code(200).send(ephemeral('Invalid button.'));

        const patchDeferred = makeDeferredPatch(interaction.application_id, interaction.token);
        setImmediate(() => void (async () => {
          try {
            const user = await fastify.prisma.user.findFirst({
              where: { discord_id: discordId, deleted_at: null },
              select: { id: true },
            });
            if (!user) { await patchDeferred('You need to log in at rizzotto.gg first.'); return; }
            const result = await claimQueueOffer(fastify, user.id, offer);
            if (result.status === 'matched') {
              const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${result.matchId}`;
              await patchDeferred(`Match found! vs **${result.opponentName}** → ${matchUrl}`);
            } else if (result.status === 'blocked') {
              await patchDeferred(result.message);
            } else {
              await patchDeferred("Nobody's in the queue right now.");
            }
          } catch (err) {
            console.error('[discord-interactions] av_offer error:', err);
            await patchDeferred('Something went wrong. Please join the queue on rizzotto.gg directly.');
          }
        })());
        return reply.code(200).send({ type: 5, data: { flags: 64 } });
      }

      // av_optin:<actorDiscordId> — "Join Queue" from the empty-queue opt-in message.
      if (action === 'av_optin') {
        const [, actorDiscordId] = parts;
        if (!actorDiscordId || actorDiscordId !== discordId) return reply.code(200).send(ephemeral('This button is not for you.'));
        if (!fastify.redis) return reply.code(200).send(ephemeral('Queue service is temporarily unavailable.'));

        const user = await fastify.prisma.user.findFirst({
          where: { discord_id: discordId, deleted_at: null },
          select: { id: true },
        });
        if (!user) return reply.code(200).send(ephemeral('You need to log in at rizzotto.gg first.'));

        return reply.code(200).send(await joinQueueViaDiscord(fastify, user.id));
      }

      return reply.code(200).send(ephemeral('Unknown button.'));
    },
  );
};

export default discordInteractionsRoutes;
