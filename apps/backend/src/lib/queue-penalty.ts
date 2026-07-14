// #14 — Open Play queue-abuse penalty, education-first escalation.
//
// A player who joins the queue and bails within SHORT_STINT_MS is "queue-ghosting".
// Doing that ABUSE_THRESHOLD times inside the rolling ABUSE_WINDOW_MS trips one
// escalation step. The consequence grows with the offense level:
//   L1 → warning DM only (no sanction)   L2 → 1h cooldown   L3 → 24h   L4+ → until an
// admin lifts it. Sanctions + staff notification start at L2. Redis-backed so it
// survives restarts and shares the queue infra; the pure helpers are unit-tested.

import type { Redis } from 'ioredis';

export const SHORT_STINT_MS = 5 * 60 * 1000; // "left almost immediately"
export const ABUSE_THRESHOLD = 3; // short stints within the window that trip one step
export const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24h
export const OFFENSE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // offense level decays after 30 clean days
// L4+ has no fixed length ("until an admin lifts it"); until an admin action exists,
// cap it at a long stand-in so it can't lock someone out forever by accident.
export const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** Cooldown length per offense level. L1 is 0 (warning only); sanctions start at L2. */
export function timeoutMsForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level === 2) return 60 * 60 * 1000; // 1h
  if (level === 3) return 24 * 60 * 60 * 1000; // 24h
  return MAX_TIMEOUT_MS; // L4+ — until an admin lifts it
}

/** A queue stint counts as abusive-short if the player bailed within SHORT_STINT_MS. */
export function isShortStint(joinedAtMs: number, leftAtMs: number): boolean {
  return leftAtMs >= joinedAtMs && leftAtMs - joinedAtMs < SHORT_STINT_MS;
}

/** N short stints inside the rolling window trip one escalation step. */
export function reachedAbuseThreshold(shortStintCount: number): boolean {
  return shortStintCount >= ABUSE_THRESHOLD;
}

const SHORTLEAVE_PREFIX = 'rizzotto:queue:shortleaves:';
const OFFENSE_PREFIX = 'rizzotto:queue:offenses:';
const TIMEOUT_PREFIX = 'rizzotto:queue:timeout:';

/** Remaining cooldown in seconds, or 0 if the player may queue. */
export async function getQueueTimeoutRemaining(redis: Redis, userId: string): Promise<number> {
  const ttl = await redis.ttl(`${TIMEOUT_PREFIX}${userId}`);
  return ttl > 0 ? ttl : 0;
}

export interface QueueLeaveOutcome {
  /** The 3-short-leaves pattern fired this leave. */
  tripped: boolean;
  /** Offense level (1 = first, warning-only). 0 when not tripped. */
  level: number;
  /** Cooldown applied in seconds. 0 for a warning-only first offense. */
  timeoutSec: number;
}

const NO_OUTCOME: QueueLeaveOutcome = { tripped: false, level: 0, timeoutSec: 0 };

/**
 * Record a voluntary queue leave. If it was a short stint that trips the rolling-window
 * threshold, escalate the offense level and apply the matching consequence. Best-effort —
 * never throws, so it can't break the leave flow.
 */
export async function recordQueueLeave(
  redis: Redis,
  userId: string,
  joinedAtMs: number,
  leftAtMs: number,
): Promise<QueueLeaveOutcome> {
  if (!isShortStint(joinedAtMs, leftAtMs)) return NO_OUTCOME;
  try {
    const shortLeaveKey = `${SHORTLEAVE_PREFIX}${userId}`;
    await redis.zremrangebyscore(shortLeaveKey, 0, leftAtMs - ABUSE_WINDOW_MS);
    await redis.zadd(shortLeaveKey, leftAtMs, String(leftAtMs));
    await redis.pexpire(shortLeaveKey, ABUSE_WINDOW_MS);
    const count = await redis.zcard(shortLeaveKey);
    if (!reachedAbuseThreshold(count)) return NO_OUTCOME;

    // Pattern tripped — reset the window and escalate the persistent offense level.
    await redis.del(shortLeaveKey);
    const offenseKey = `${OFFENSE_PREFIX}${userId}`;
    const level = await redis.incr(offenseKey);
    await redis.pexpire(offenseKey, OFFENSE_TTL_MS);

    const timeoutMs = timeoutMsForLevel(level);
    if (timeoutMs > 0) {
      await redis.set(`${TIMEOUT_PREFIX}${userId}`, '1', 'PX', timeoutMs);
    }
    return { tripped: true, level, timeoutSec: Math.ceil(timeoutMs / 1000) };
  } catch {
    /* penalty tracking is non-critical — never break the user-facing leave */
  }
  return NO_OUTCOME;
}
