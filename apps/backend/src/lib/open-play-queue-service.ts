import type { FastifyInstance } from 'fastify';
import { logQueueActivity } from './queue-activity.js';
import { QUEUE_KEY, JOINED_AT_KEY, JOIN_SCRIPT, QUEUE_PREFS_KEY, runMatchmakingTick } from './matchmaking-tick.js';
import type { QueueBattleType, QueueCompetitorFormat, QueueMatchFormat } from './queue-matching.js';
import {
  findQueueableTeam,
  getStoredQueuePrefs,
  resolveStoredActor,
  saveQueuePrefs,
  type StoredQueuePrefs,
} from './queue-prefs.js';
import { getQueueTimeoutRemaining, recordQueueLeave } from './queue-penalty.js';
import { notifyQueueTimeout, notifyQueueWarning, notifyQueueAbuseToStaff } from './discord-notify.js';
import { refreshJoinDm, syncTicker } from './discord-open-play.js';

/**
 * The one way into the Open Play queue, shared by the Open Play page (HTTP) and every Discord entry
 * (join DM, "Queue again", the empty-queue opt-in). Every omitted field falls back to the player's
 * stored settings. Runs all join checks, so no entry point can skip one (a Discord button used to
 * bypass the strike cooldown and the active-match check).
 */
export interface QueueJoinRequest {
  battleTypes?: QueueBattleType[];
  matchFormats?: QueueMatchFormat[];
  competitorFormat?: QueueCompetitorFormat;
  /** 2v2: which of the captain's active teams to queue. Omitted → the stored/first valid team. */
  teamId?: string;
  /** true = this selection becomes the player's stored settings. */
  save?: boolean;
}

export type QueueJoinResult =
  | { ok: true; matched: true; matchId: string; queueId: string; fellBackTo1v1: boolean }
  | { ok: true; matched: false; position: number; queueId: string; fellBackTo1v1: boolean; settings: StoredQueuePrefs }
  | { ok: false; statusCode: number; error: string; message: string; code?: 'STEAM_REQUIRED' | 'COOLDOWN' | 'QUEUED' | 'ACTIVE_MATCH' };

function fail(statusCode: number, error: string, message: string, code?: Extract<QueueJoinResult, { ok: false }>['code']): QueueJoinResult {
  return { ok: false, statusCode, error, message, ...(code ? { code } : {}) };
}

export async function joinOpenPlayQueue(
  fastify: FastifyInstance,
  userId: string,
  body: QueueJoinRequest,
): Promise<QueueJoinResult> {
  const redis = fastify.redis;
  if (!redis) return fail(503, 'ServiceUnavailable', 'Queue service unavailable');

  // Registration: an account that isn't banned (soft-deleted) with a linked Steam account.
  const user = await fastify.prisma.user.findFirst({
    where: { id: userId, deleted_at: null },
    select: { id: true, steam_link: { select: { user_id: true } } },
  });
  if (!user) return fail(403, 'Forbidden', 'Your account cannot join the queue');
  if (!user.steam_link) return fail(403, 'Forbidden', 'Connect Steam to continue', 'STEAM_REQUIRED');

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
  let format: QueueCompetitorFormat = 'ONE_V_ONE';
  let fellBackTo1v1 = false;
  if (body.competitorFormat === 'TWO_V_TWO') {
    // Explicit 2v2 request: an invalid team is an error the player has to see.
    const teamId = await findQueueableTeam(fastify.prisma, userId, body.teamId);
    if (!teamId) {
      const message = body.teamId
        ? 'That team is not an active team you captain with two accepted members'
        : 'You must be the captain of an active team with two accepted members to queue for 2v2';
      return fail(400, 'BadRequest', message);
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
  const prefs = { format, battleTypes: effective.battleTypes, matchFormats: effective.matchFormats };

  // #14: reject a re-join while the queue-abuse cooldown (or a no-show strike) is still running.
  const cooldownSec = await getQueueTimeoutRemaining(redis, userId);
  if (cooldownSec > 0) {
    return fail(
      429,
      'TooManyRequests',
      `You're on a short queue cooldown for leaving too many times in quick succession. Try again in about ${Math.ceil(cooldownSec / 60)} min.`,
      'COOLDOWN',
    );
  }

  if ((await redis.lpos(QUEUE_KEY, queueId)) !== null) return fail(409, 'Conflict', 'Already in queue', 'QUEUED');

  const activeMatch = await fastify.prisma.match.findFirst({
    where: {
      type: 'OPEN_PLAY',
      status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
      deleted_at: null,
      OR: [{ player1_id: queueId }, { player2_id: queueId }],
    },
    select: { id: true },
  });
  if (activeMatch) return fail(409, 'Conflict', 'You already have an active Open Play match', 'ACTIVE_MATCH');

  // Join the queue atomically (dup-checked), then run one synchronous matchmaking tick so an
  // instant FIFO match — or a fresh DM wave + hold — happens before we answer.
  const joined = (await redis.eval(JOIN_SCRIPT, 2, QUEUE_KEY, JOINED_AT_KEY, queueId, String(Date.now()))) as number;
  if (joined !== 1) return fail(409, 'Conflict', 'Already in queue', 'QUEUED');

  // Record the actor's battle-type / team-size selection for preference-aware matching.
  await redis.hset(QUEUE_PREFS_KEY, queueId, JSON.stringify(prefs));
  if (body.save) await saveQueuePrefs(fastify.prisma, userId, effective);

  await logQueueActivity(fastify.prisma, 'JOIN', userId);
  await runMatchmakingTick(fastify);

  // The tick removes matched players from the queue — if we're gone, we matched.
  if ((await redis.lpos(QUEUE_KEY, queueId)) === null) {
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
    if (match) return { ok: true, matched: true, matchId: match.id, queueId, fellBackTo1v1 };
  }

  const position = await redis.llen(QUEUE_KEY);
  return { ok: true, matched: false, position, queueId, fellBackTo1v1, settings: effective };
}

/**
 * Leave the Open Play queue (Open Play page or Discord). A short stint counts toward the queue-abuse
 * threshold (#14), exactly as before. Returns whether the player was queued.
 */
export async function leaveOpenPlayQueue(fastify: FastifyInstance, userId: string): Promise<boolean> {
  const redis = fastify.redis;
  if (!redis) return false;
  // The queued id is the user (1v1) or the captain's ACTIVE team (2v2) — clear both.
  const leaveTeam = await fastify.prisma.team.findFirst({ where: { captain_id: userId, status: 'ACTIVE' }, select: { id: true } });
  const candidates = leaveTeam ? [userId, leaveTeam.id] : [userId];
  // Read the join timestamp before clearing it, to measure the stint (#14).
  let joinedAtRaw: string | null = null;
  let removed = 0;
  for (const id of candidates) {
    const ja = await redis.hget(JOINED_AT_KEY, id);
    const r = await redis.lrem(QUEUE_KEY, 0, id);
    if (r > 0) {
      removed += r;
      joinedAtRaw = ja;
    }
    await redis.hdel(JOINED_AT_KEY, id);
    await redis.hdel(QUEUE_PREFS_KEY, id);
  }
  if (removed === 0) return false;

  // Discord: the ticker post goes, and a join DM that still says "in the queue" shows the settings.
  void syncTicker(fastify);
  void refreshJoinDm(fastify, userId);
  await logQueueActivity(fastify.prisma, 'LEAVE', userId);
  // #14: a short stint counts toward the abuse threshold; every 3 within 24h trips one escalation
  // step — education-first: L1 warns only, sanctions start at L2.
  if (joinedAtRaw) {
    const outcome = await recordQueueLeave(redis, userId, Number(joinedAtRaw), Date.now());
    if (outcome.tripped) {
      // Surface the escalation in the admin Queue Activity tab (with the level).
      await logQueueActivity(fastify.prisma, outcome.timeoutSec > 0 ? 'TIMEOUT' : 'WARNING', userId, { level: outcome.level });
      const u = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { username: true, discord_id: true } });
      if (u?.discord_id) {
        if (outcome.timeoutSec > 0) void notifyQueueTimeout(u.discord_id, outcome.timeoutSec);
        else void notifyQueueWarning(u.discord_id);
      }
      // Sanctions (level ≥ 2) also notify staff.
      if (outcome.level >= 2) void notifyQueueAbuseToStaff(u?.username ?? userId, outcome.level, outcome.timeoutSec);
    }
  }
  return true;
}
