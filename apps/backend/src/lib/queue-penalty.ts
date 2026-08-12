// #14 — Open Play queue-abuse penalty, education-first escalation with gradual decay.
//
// A player who joins the queue and bails within SHORT_STINT_MS is "queue-ghosting".
// Doing that ABUSE_THRESHOLD times inside the rolling ABUSE_WINDOW_MS trips one
// escalation step. The consequence grows with the offense level:
//   L1 → warning DM only (no sanction)   L2 → 1h cooldown   L3 → 24h   L4 → 7 days
//   L5+ → permanent, until an admin lifts it. Sanctions + staff notification start at L2.
//
// The level is NOT a hard counter: it DECAYS one step per DECAY_PERIOD_MS of clean
// behaviour, so an occasional slip fades out while a habitual offender escalates.
// Redis-backed so it survives restarts; the pure helpers are unit-tested.

import type { Redis } from 'ioredis';

export const SHORT_STINT_MS = 5 * 60 * 1000; // "left almost immediately"
export const ABUSE_THRESHOLD = 3; // short stints within the window that trip one step
export const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24h
export const DECAY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // one level forgiven per 7 clean days
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // L4 cooldown
// L5+ is "permanent — until an admin lifts it" (via resetQueuePenaltyToWarned). Stored as a long
// finite TTL (a year) so the cooldown check, which reads the key's TTL, keeps working; an admin
// clears it early. Effectively permanent for a habitual offender.
export const PERMANENT_TIMEOUT_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Cooldown length per offense level — the escalation ladder:
 *   L1 = warning only (0)  ·  L2 = 1h  ·  L3 = 24h  ·  L4 = 7 days  ·  L5+ = permanent.
 * Sanctions (and staff notification) start at L2.
 */
export function timeoutMsForLevel(level: number): number {
  if (level <= 1) return 0; // L1 — warning only
  if (level === 2) return 60 * 60 * 1000; // L2 — 1h
  if (level === 3) return 24 * 60 * 60 * 1000; // L3 — 24h
  if (level === 4) return SEVEN_DAYS_MS; // L4 — 7 days
  return PERMANENT_TIMEOUT_MS; // L5+ — permanent, until an admin lifts it
}

/** A queue stint counts as abusive-short if the player bailed within SHORT_STINT_MS. */
export function isShortStint(joinedAtMs: number, leftAtMs: number): boolean {
  return leftAtMs >= joinedAtMs && leftAtMs - joinedAtMs < SHORT_STINT_MS;
}

/** N short stints inside the rolling window trip one escalation step. */
export function reachedAbuseThreshold(shortStintCount: number): boolean {
  return shortStintCount >= ABUSE_THRESHOLD;
}

/**
 * The offense level after decay: drop one step per full DECAY_PERIOD_MS of clean time
 * since the last offense. Floors at 0.
 */
export function decayedLevel(storedLevel: number, lastOffenseMs: number, nowMs: number): number {
  if (storedLevel <= 0) return 0;
  const steps = Math.floor(Math.max(0, nowMs - lastOffenseMs) / DECAY_PERIOD_MS);
  return Math.max(0, storedLevel - steps);
}

const SHORTLEAVE_PREFIX = 'rizzotto:queue:shortleaves:';
const OFFENSE_PREFIX = 'rizzotto:queue:offense:'; // hash { level, ts }
const TIMEOUT_PREFIX = 'rizzotto:queue:timeout:';

/** Remaining cooldown in seconds, or 0 if the player may queue. */
export async function getQueueTimeoutRemaining(redis: Redis, userId: string): Promise<number> {
  const ttl = await redis.ttl(`${TIMEOUT_PREFIX}${userId}`);
  return ttl > 0 ? ttl : 0;
}

/** Admin view: the player's current cooldown (seconds) + effective (decayed) offense level. */
export async function getQueuePenaltyState(
  redis: Redis,
  userId: string,
  nowMs: number,
): Promise<{ cooldownSec: number; level: number }> {
  const [cooldownSec, offense] = await Promise.all([
    getQueueTimeoutRemaining(redis, userId),
    redis.hgetall(`${OFFENSE_PREFIX}${userId}`),
  ]);
  const storedLevel = offense.level ? Number(offense.level) : 0;
  const ts = offense.ts ? Number(offense.ts) : nowMs;
  return { cooldownSec, level: decayedLevel(storedLevel, ts, nowMs) };
}

/**
 * Admin action: lift any active cooldown and drop the offense record back to level 1
 * (the "warned" baseline) — NOT a full pardon. The warning stays on record, so the
 * next offense goes straight to the short timeout (level 2). The level then decays
 * normally from here.
 */
export async function resetQueuePenaltyToWarned(
  redis: Redis,
  userId: string,
  nowMs: number,
): Promise<void> {
  const offenseKey = `${OFFENSE_PREFIX}${userId}`;
  await Promise.all([
    redis.del(`${TIMEOUT_PREFIX}${userId}`), // lift the active cooldown
    redis.del(`${SHORTLEAVE_PREFIX}${userId}`), // fresh accumulation window
  ]);
  await redis.hset(offenseKey, 'level', '1', 'ts', String(nowMs));
  await redis.pexpire(offenseKey, 2 * DECAY_PERIOD_MS); // level 1 decays to 0 in ~7 clean days
}

export interface QueueLeaveOutcome {
  /** The 3-short-leaves pattern fired this leave. */
  tripped: boolean;
  /** Offense level after decay (1 = first, warning-only). 0 when not tripped. */
  level: number;
  /** Cooldown applied in seconds. 0 for a warning-only first offense. */
  timeoutSec: number;
}

const NO_OUTCOME: QueueLeaveOutcome = { tripped: false, level: 0, timeoutSec: 0 };

/**
 * Record a voluntary queue leave. If it was a short stint that trips the rolling-window
 * threshold, decay the stored level, escalate by one, and apply the matching consequence.
 * Best-effort — never throws, so it can't break the leave flow.
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

    // Pattern tripped — reset the window, decay the stored level, then escalate by one.
    await redis.del(shortLeaveKey);
    const offenseKey = `${OFFENSE_PREFIX}${userId}`;
    const stored = await redis.hgetall(offenseKey);
    const prevLevel = stored.level ? Number(stored.level) : 0;
    const prevTs = stored.ts ? Number(stored.ts) : leftAtMs;
    const level = decayedLevel(prevLevel, prevTs, leftAtMs) + 1;

    await redis.hset(offenseKey, 'level', String(level), 'ts', String(leftAtMs));
    // Keep the memory alive at least until the level would fully decay (+ a buffer).
    await redis.pexpire(offenseKey, level * DECAY_PERIOD_MS + DECAY_PERIOD_MS);

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

/**
 * Directly escalate the queue penalty by ONE step for a single discrete offence that is itself
 * abusive — e.g. an Open Play blind-pick no-show (letting the faction-pick deadline pass and
 * forcing the match to be cancelled). Unlike recordQueueLeave this does NOT wait for the
 * 3-short-stints pattern: one no-show = one step. It shares the SAME offense record + stages, so
 * no-shows and queue-ghosting accumulate together and decay together. First offence → level 1
 * (warning only); repeats climb to L2 (1h) / L3 (24h). Best-effort — never throws.
 */
export async function escalateQueuePenalty(
  redis: Redis,
  userId: string,
  nowMs: number,
): Promise<QueueLeaveOutcome> {
  try {
    const offenseKey = `${OFFENSE_PREFIX}${userId}`;
    const stored = await redis.hgetall(offenseKey);
    const prevLevel = stored.level ? Number(stored.level) : 0;
    const prevTs = stored.ts ? Number(stored.ts) : nowMs;
    const level = decayedLevel(prevLevel, prevTs, nowMs) + 1;
    await redis.hset(offenseKey, 'level', String(level), 'ts', String(nowMs));
    await redis.pexpire(offenseKey, level * DECAY_PERIOD_MS + DECAY_PERIOD_MS);
    const timeoutMs = timeoutMsForLevel(level);
    if (timeoutMs > 0) {
      await redis.set(`${TIMEOUT_PREFIX}${userId}`, '1', 'PX', timeoutMs);
    }
    return { tripped: true, level, timeoutSec: Math.ceil(timeoutMs / 1000) };
  } catch {
    /* penalty tracking is non-critical */
  }
  return NO_OUTCOME;
}
