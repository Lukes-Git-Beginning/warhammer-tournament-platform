import type { FastifyInstance } from 'fastify';
import { createOpenPlayMatch } from './create-open-play-match.js';
import { resolveCompetitors } from './competitors.js';
import {
  QUEUE_KEY,
  JOINED_AT_KEY,
  QUEUE_PREFS_KEY,
  announceMatch,
  runMatchmakingTick,
} from './matchmaking-tick.js';
import {
  compatiblePairings,
  parseQueuePrefs,
  type QueueEntry,
  type QueueOffer,
  type QueuePrefs,
} from './queue-matching.js';
import { findQueueableTeam, getStoredQueuePrefs } from './queue-prefs.js';
import { getQueueTimeoutRemaining } from './queue-penalty.js';

export type ClaimOfferResult =
  | { status: 'matched'; matchId: string; opponentName: string }
  /** The offered match is gone (nobody compatible is waiting any more). The player is NOT queued. */
  | { status: 'gone' }
  | { status: 'blocked'; message: string };

/**
 * Take an availability-DM offer: pair the player directly with the longest-waiting queue entry
 * that fits exactly the offered (battle type, team size, series length). The player never enters
 * the queue — if the offer disappeared in the meantime nothing is left behind — and their stored
 * queue settings are not touched. Pairing directly (instead of join + tick) keeps this working
 * during the post-DM hold that pauses the regular tick.
 */
export async function claimQueueOffer(
  fastify: FastifyInstance,
  userId: string,
  offer: QueueOffer,
): Promise<ClaimOfferResult> {
  const redis = fastify.redis!;
  const prisma = fastify.prisma;

  const stored = await getStoredQueuePrefs(prisma, userId);
  let queueId = userId;
  if (offer.size === 2) {
    const teamId = await findQueueableTeam(prisma, userId, stored.teamId);
    if (!teamId) {
      return {
        status: 'blocked',
        message: 'You need to be the captain of an active team with two accepted members for 2v2.',
      };
    }
    queueId = teamId;
  }
  const format = offer.size === 2 ? 'TWO_V_TWO' : 'ONE_V_ONE';

  if ((await redis.lpos(QUEUE_KEY, queueId)) !== null) {
    return { status: 'blocked', message: "You're already in the queue." };
  }
  const cooldownSec = await getQueueTimeoutRemaining(redis, userId);
  if (cooldownSec > 0) {
    return {
      status: 'blocked',
      message: `You're on a short queue cooldown. Try again in about ${Math.ceil(cooldownSec / 60)} min.`,
    };
  }
  const activeMatch = await prisma.match.findFirst({
    where: {
      type: 'OPEN_PLAY',
      status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
      deleted_at: null,
      OR: [{ player1_id: queueId }, { player2_id: queueId }],
    },
    select: { id: true },
  });
  if (activeMatch) return { status: 'blocked', message: 'You already have an active Open Play match.' };

  // Exactly the offered restriction (Siege ignores the format list; it is always Bo2).
  const mine: QueuePrefs = {
    format,
    battleTypes: [offer.battleType],
    matchFormats: offer.matchFormat === 'BO3' ? ['BO3'] : ['BO1'],
  };

  const ids = await redis.lrange(QUEUE_KEY, 0, -1);
  if (ids.length === 0) return { status: 'gone' };
  const prefsRaw = await redis.hmget(QUEUE_PREFS_KEY, ...ids);
  const waiting: QueueEntry[] = ids
    .map((id, i) => ({ id, prefs: parseQueuePrefs(prefsRaw[i]) }))
    .filter((e) => e.id !== queueId);

  for (const entry of waiting) {
    const fits = compatiblePairings(mine, entry.prefs).some(
      (p) => p.battleType === offer.battleType && p.matchFormat === offer.matchFormat,
    );
    if (!fits) continue;
    // Atomic claim: only one concurrent clicker/tick gets the entry.
    if ((await redis.lrem(QUEUE_KEY, 1, entry.id)) !== 1) continue;

    let created: { matchId: string; mapName: string | null };
    try {
      const r = await createOpenPlayMatch(
        prisma, entry.id, queueId, 'AVAILABILITY', offer.battleType, format, offer.matchFormat,
      );
      created = { matchId: r.matchId, mapName: r.mapName };
    } catch (err) {
      // Match creation failed: put the waiting entry back at the front.
      await redis.lpush(QUEUE_KEY, entry.id);
      fastify.log.error({ err, entryId: entry.id }, '[queue-offer] match creation failed; requeued');
      return { status: 'blocked', message: 'Something went wrong. Please try again.' };
    }

    await redis.hdel(JOINED_AT_KEY, entry.id);
    await redis.hdel(QUEUE_PREFS_KEY, entry.id);
    await announceMatch(fastify, created.matchId, created.mapName, entry.id, queueId, format);

    const opponent = (await resolveCompetitors(prisma, [entry.id])).get(entry.id);
    // Fresh tick — the queue may still hold others to pair or ping.
    setImmediate(() => void runMatchmakingTick(fastify));
    return { status: 'matched', matchId: created.matchId, opponentName: opponent?.username ?? 'opponent' };
  }

  return { status: 'gone' };
}
