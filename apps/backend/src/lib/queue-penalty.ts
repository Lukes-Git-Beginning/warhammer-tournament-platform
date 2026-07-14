// #14 — Open Play queue-abuse penalty.
//
// A player who joins the queue and bails within SHORT_STINT_MS is "queue-ghosting".
// Do that ABUSE_THRESHOLD times inside the rolling ABUSE_WINDOW_MS and they earn a
// short TIMEOUT_MS cooldown (+ a friendly DM). Redis-backed so it survives restarts
// and shares the existing queue infra. The pure helpers are unit-tested without Redis.

import type { Redis } from 'ioredis';

export const SHORT_STINT_MS = 5 * 60 * 1000; // "left almost immediately"
export const ABUSE_THRESHOLD = 3; // short stints within the window before a penalty
export const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24h
export const TIMEOUT_MS = 30 * 60 * 1000; // cooldown length

const SHORTLEAVE_PREFIX = 'rizzotto:queue:shortleaves:';
const TIMEOUT_PREFIX = 'rizzotto:queue:timeout:';

/** A queue stint counts as abusive-short if the player bailed within SHORT_STINT_MS. */
export function isShortStint(joinedAtMs: number, leftAtMs: number): boolean {
  return leftAtMs >= joinedAtMs && leftAtMs - joinedAtMs < SHORT_STINT_MS;
}

/** N short stints inside the rolling window trip the penalty. */
export function reachedAbuseThreshold(shortStintCount: number): boolean {
  return shortStintCount >= ABUSE_THRESHOLD;
}

/** Remaining cooldown in seconds, or 0 if the player may queue. */
export async function getQueueTimeoutRemaining(redis: Redis, userId: string): Promise<number> {
  const ttl = await redis.ttl(`${TIMEOUT_PREFIX}${userId}`);
  return ttl > 0 ? ttl : 0;
}

/**
 * Record a voluntary queue leave. If it was a short stint that trips the
 * rolling-window threshold, set the cooldown and report it. Best-effort — never
 * throws, so it can't break the leave flow.
 */
export async function recordQueueLeave(
  redis: Redis,
  userId: string,
  joinedAtMs: number,
  leftAtMs: number,
): Promise<{ timedOut: boolean; remainingSec: number }> {
  if (!isShortStint(joinedAtMs, leftAtMs)) return { timedOut: false, remainingSec: 0 };
  try {
    const key = `${SHORTLEAVE_PREFIX}${userId}`;
    await redis.zremrangebyscore(key, 0, leftAtMs - ABUSE_WINDOW_MS);
    await redis.zadd(key, leftAtMs, String(leftAtMs));
    await redis.pexpire(key, ABUSE_WINDOW_MS);
    const count = await redis.zcard(key);
    if (reachedAbuseThreshold(count)) {
      await redis.set(`${TIMEOUT_PREFIX}${userId}`, '1', 'PX', TIMEOUT_MS);
      await redis.del(key); // reset the counter — the cooldown is the consequence
      return { timedOut: true, remainingSec: Math.ceil(TIMEOUT_MS / 1000) };
    }
  } catch {
    /* penalty tracking is non-critical — never break the user-facing leave */
  }
  return { timedOut: false, remainingSec: 0 };
}
