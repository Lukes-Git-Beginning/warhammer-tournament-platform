import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { createOpenPlayMatch } from './create-open-play-match.js';
import { notifyAvailabilityPing, notifyMatchFoundWithButtons } from './discord-notify.js';
import { logQueueActivity } from './queue-activity.js';

// -- Redis keys --------------------------------------------------------------
// Queue is a plain FIFO list; joined_at tracks real time-in-queue (used by the
// cleanup cron and for "oldest in queue"). Both are shared with the queue routes.
export const QUEUE_KEY = 'rizzotto:queue:open_play';
export const JOINED_AT_KEY = 'rizzotto:queue:open_play:joined_at';

// Wait-cycle matchmaking state (see runMatchmakingTick).
const HOLD_KEY = 'rizzotto:mm:hold';           // global 60s hold after a DM wave
const RATELIMIT_KEY = 'rizzotto:mm:ratelimit'; // min gap between DM waves
const CONTACTED_KEY = 'rizzotto:mm:contacted'; // SET of userIds pinged this wait-cycle
const TICK_LOCK_KEY = 'rizzotto:mm:tick:lock'; // mutex so ticks never overlap
const SNOOZE_PREFIX = 'rizzotto:availability:snooze:';

const HOLD_TTL = 60;
const RATELIMIT_TTL = 300;
const CONTACTED_TTL = 1800; // matches the 30-min queue-eviction window
const TICK_LOCK_TTL = 5;

// -- Lua scripts (Redis runs each atomically) --------------------------------

// Release the tick lock only if we still own it (token match). Guards against a
// slow tick deleting a lock a later tick has since acquired.
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

// Atomic dup-checked join. KEYS: [queue, joined_at]. ARGV: [userId, epochMs].
// Returns 1 if newly queued, 0 if already present.
export const JOIN_SCRIPT = `
if redis.call('LPOS', KEYS[1], ARGV[1]) then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return 1
`;

// FIFO match of the two oldest, unless a hold is active. KEYS: [queue, hold].
// Returns {p1, p2} or false. Does NOT touch joined_at — the caller clears it only
// after the match is durably created, so a failed create can safely requeue.
export const FIFO_MATCH_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return false
end
if redis.call('LLEN', KEYS[1]) < 2 then
  return false
end
local p1 = redis.call('LPOP', KEYS[1])
local p2 = redis.call('LPOP', KEYS[1])
if not p1 or not p2 then
  return false
end
return {p1, p2}
`;

// Remove and return the oldest queued user that is not the clicker. KEYS: [queue].
// ARGV: [clickerId]. Returns userId or false. Atomic across parallel [Match Now]
// clicks: two clickers get two different opponents (or one gets false).
export const POP_OLDEST_SCRIPT = `
local len = redis.call('LLEN', KEYS[1])
for i = 0, len - 1 do
  local candidate = redis.call('LINDEX', KEYS[1], i)
  if candidate ~= ARGV[1] then
    redis.call('LREM', KEYS[1], 1, candidate)
    return candidate
  end
end
return false
`;

// -- Pure eligibility filter (unit-testable without Redis) --------------------

export interface EligibleCandidate {
  id: string;
  discord_id: string | null;
}

/**
 * From the users with MATCHMAKING availability this hour, keep those who should
 * get a fresh queue DM: has a linked Discord account, not already in the queue,
 * not already contacted this wait-cycle, not snoozed, not in an active match.
 */
export function selectEligibleRecipients(
  candidates: EligibleCandidate[],
  opts: {
    queued: Set<string>;
    contacted: Set<string>;
    snoozed: Set<string>;
    inActiveMatch: Set<string>;
  },
): EligibleCandidate[] {
  return candidates.filter(
    (c) =>
      c.discord_id !== null &&
      !opts.queued.has(c.id) &&
      !opts.contacted.has(c.id) &&
      !opts.snoozed.has(c.id) &&
      !opts.inActiveMatch.has(c.id),
  );
}

// -- Tick --------------------------------------------------------------------

/**
 * Central matchmaking step. Called on every relevant event (queue join, hourly
 * roll-over, live availability, match end) and by a 10s fallback interval.
 *
 * 1. Mutex — only one tick runs at a time.
 * 2. Empty queue → clear the wait-cycle state and stop.
 * 3. DM phase (rate-limited to one wave / 300s): ping newly-eligible available
 *    players, then set the 300s rate-limit and the 60s hold.
 * 4. Match phase (only if no hold): FIFO-match queued players in pairs.
 */
export async function runMatchmakingTick(fastify: FastifyInstance): Promise<void> {
  const redis = fastify.redis;
  if (!redis) return;

  const token = randomUUID();
  const acquired = await redis.set(TICK_LOCK_KEY, token, 'EX', TICK_LOCK_TTL, 'NX');
  if (acquired !== 'OK') return; // another tick is running

  try {
    const queueLen = await redis.llen(QUEUE_KEY);
    if (queueLen === 0) {
      await redis.del(CONTACTED_KEY, HOLD_KEY);
      return;
    }

    const rateLimited = await redis.exists(RATELIMIT_KEY);
    if (!rateLimited) {
      await maybeSendDmWave(fastify, queueLen);
    }

    const holdActive = await redis.exists(HOLD_KEY);
    if (!holdActive) {
      await drainQueue(fastify);
    }
  } catch (err) {
    fastify.log.error({ err }, '[matchmaking-tick] tick failed');
  } finally {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, TICK_LOCK_KEY, token).catch(() => {});
  }
}

/**
 * Send one DM wave to newly-eligible available players, if any. Sets the
 * wait-cycle state (contacted / rate-limit / hold) BEFORE dispatching the DMs so
 * a slow or failed DM can never delay the hold or leak a duplicate wave; the DMs
 * themselves are best-effort (fire-and-forget).
 */
async function maybeSendDmWave(fastify: FastifyInstance, queueLen: number): Promise<void> {
  const redis = fastify.redis!;
  const prisma = fastify.prisma;

  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const hour = now.getUTCHours();

  const slots = await prisma.availabilitySlot.findMany({
    where: { day_of_week: day, hour_utc: hour, context: 'MATCHMAKING' },
    include: { user: { select: { id: true, discord_id: true } } },
  });
  if (slots.length === 0) return;

  const candidates: EligibleCandidate[] = slots.map((s) => s.user);

  const [queuedMembers, contactedMembers] = await Promise.all([
    redis.lrange(QUEUE_KEY, 0, -1),
    redis.smembers(CONTACTED_KEY),
  ]);
  const queued = new Set(queuedMembers);
  const contacted = new Set(contactedMembers);

  // Cheap pre-filter before the snooze (Redis) + active-match (DB) checks.
  const prelim = candidates.filter((c) => c.discord_id && !queued.has(c.id) && !contacted.has(c.id));
  if (prelim.length === 0) return;
  const prelimIds = prelim.map((c) => c.id);

  const [snoozeFlags, activeMatches, liveTournaments] = await Promise.all([
    Promise.all(prelimIds.map((id) => redis.exists(`${SNOOZE_PREFIX}${id}`))),
    // #1: a player directly in ANY open/unreported match (tournament or Open Play).
    prisma.match.findMany({
      where: {
        status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
        deleted_at: null,
        OR: [{ player1_id: { in: prelimIds } }, { player2_id: { in: prelimIds } }],
      },
      select: { player1_id: true, player2_id: true },
    }),
    // #1: tournaments that have a live match right now (any players) — used to mute
    // their participants who are merely BETWEEN rounds in a running real-time session.
    prisma.match.findMany({
      where: {
        status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
        deleted_at: null,
        tournament_id: { not: null },
      },
      select: { tournament_id: true },
      distinct: ['tournament_id'],
    }),
  ]);

  const snoozed = new Set(prelimIds.filter((_, i) => snoozeFlags[i] === 1));
  const inActiveMatch = new Set<string>();
  for (const m of activeMatches) {
    if (m.player1_id) inActiveMatch.add(m.player1_id);
    if (m.player2_id) inActiveMatch.add(m.player2_id);
  }

  // #1 (real-time tournaments): also mute checked-in participants of any tournament with
  // a live match right now — they're just between rounds in an active session. During a
  // multi-day tournament's downtime there are no live matches, so they stay pingable
  // (and mid-session breaks like lunch free up naturally too).
  const liveTournamentIds = liveTournaments
    .map((t) => t.tournament_id)
    .filter((id): id is string => id !== null);
  if (liveTournamentIds.length > 0) {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournament_id: { in: liveTournamentIds }, user_id: { in: prelimIds }, status: 'CHECKED_IN' },
      select: { user_id: true },
    });
    for (const p of participants) inActiveMatch.add(p.user_id);
  }

  const eligible = selectEligibleRecipients(candidates, { queued, contacted, snoozed, inActiveMatch });
  if (eligible.length === 0) return;

  await redis.sadd(CONTACTED_KEY, ...eligible.map((e) => e.id));
  await redis.expire(CONTACTED_KEY, CONTACTED_TTL);
  await redis.set(RATELIMIT_KEY, '1', 'EX', RATELIMIT_TTL);
  await redis.set(HOLD_KEY, '1', 'EX', HOLD_TTL);

  const recipients = eligible.map((e) => e.discord_id!);
  setImmediate(() =>
    void Promise.allSettled(recipients.map((discordId) => notifyAvailabilityPing(discordId, queueLen))),
  );
}

/** FIFO-match queued players in pairs while no hold is active. */
async function drainQueue(fastify: FastifyInstance): Promise<void> {
  const redis = fastify.redis!;
  const prisma = fastify.prisma;

  for (;;) {
    const result = (await redis.eval(FIFO_MATCH_SCRIPT, 2, QUEUE_KEY, HOLD_KEY)) as
      | [string, string]
      | false
      | null;
    if (!Array.isArray(result) || result.length !== 2) break;
    const [p1Id, p2Id] = result;

    let matchId: string;
    let mapName: string | null;
    try {
      ({ matchId, mapName } = await createOpenPlayMatch(prisma, p1Id, p2Id, 'QUEUE'));
    } catch (err) {
      // Requeue front-first so nobody is dropped, then stop this drain.
      await redis.lpush(QUEUE_KEY, p2Id, p1Id);
      fastify.log.error({ err, p1Id, p2Id }, '[matchmaking-tick] match creation failed; requeued');
      break;
    }

    await redis.hdel(JOINED_AT_KEY, p1Id, p2Id);
    await announceMatch(fastify, matchId, mapName, p1Id, p2Id);
  }
}

/** Best-effort post-match side effects: DM both players and log the activity. */
async function announceMatch(
  fastify: FastifyInstance,
  matchId: string,
  mapName: string | null,
  p1Id: string,
  p2Id: string,
): Promise<void> {
  const prisma = fastify.prisma;
  try {
    const [p1, p2] = await Promise.all([
      prisma.user.findUnique({ where: { id: p1Id }, select: { username: true, discord_id: true } }),
      prisma.user.findUnique({ where: { id: p2Id }, select: { username: true, discord_id: true } }),
    ]);
    if (p1?.discord_id && p2?.discord_id) {
      setImmediate(() =>
        void notifyMatchFoundWithButtons(
          matchId,
          { discordId: p1.discord_id!, username: p1.username },
          { discordId: p2.discord_id!, username: p2.username },
          mapName,
        ),
      );
    }
    await Promise.all([
      logQueueActivity(prisma, 'MATCH', p1Id, { matchId, opponentId: p2Id }),
      logQueueActivity(prisma, 'MATCH', p2Id, { matchId, opponentId: p1Id }),
    ]);
  } catch (err) {
    fastify.log.error({ err, matchId }, '[matchmaking-tick] announce failed (non-fatal)');
  }
}

/** Clear the "already contacted" set so a new wait-cycle starts fresh. */
export async function resetContactedSet(fastify: FastifyInstance): Promise<void> {
  if (fastify.redis) await fastify.redis.del(CONTACTED_KEY).catch(() => {});
}
