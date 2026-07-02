/**
 * Open Play matchmaking tick tests.
 *
 * Three layers:
 *  1. selectEligibleRecipients() — pure filter, no Redis/DB.
 *  2. Lua scripts — against a real Redis (isolated per-test keys). This is the
 *     riskiest logic (atomic join / FIFO+hold / pop-oldest≠clicker).
 *  3. runMatchmakingTick() — real Redis + Prisma, Discord mocked. State-transition
 *     scenarios only (no match creation) to keep the tests hermetic and cleanup
 *     trivial; the FIFO match wiring itself is covered by the Lua-script layer.
 *
 * Discord notifies are mocked so no real DMs are sent.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';
import type { TestUser } from './helpers/db-fixtures.js';

vi.mock('../src/lib/discord-notify.js', () => ({
  notifyAvailabilityPing: vi.fn().mockResolvedValue(undefined),
  notifyMatchFoundWithButtons: vi.fn().mockResolvedValue(undefined),
}));

import { notifyAvailabilityPing, notifyMatchFoundWithButtons } from '../src/lib/discord-notify.js';
import {
  selectEligibleRecipients,
  runMatchmakingTick,
  JOIN_SCRIPT,
  FIFO_MATCH_SCRIPT,
  POP_OLDEST_SCRIPT,
} from '../src/lib/matchmaking-tick.js';

// ---------------------------------------------------------------------------
// 1. Pure filter
// ---------------------------------------------------------------------------

describe('selectEligibleRecipients', () => {
  const empty = { queued: new Set<string>(), contacted: new Set<string>(), snoozed: new Set<string>(), inActiveMatch: new Set<string>() };

  it('keeps only users with a discord_id', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }, { id: 'b', discord_id: null }],
      empty,
    );
    expect(out.map((u) => u.id)).toEqual(['a']);
  });

  it('drops users already in the queue', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }, { id: 'b', discord_id: 'db' }],
      { ...empty, queued: new Set(['a']) },
    );
    expect(out.map((u) => u.id)).toEqual(['b']);
  });

  it('drops users already contacted this wait-cycle', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }, { id: 'b', discord_id: 'db' }],
      { ...empty, contacted: new Set(['b']) },
    );
    expect(out.map((u) => u.id)).toEqual(['a']);
  });

  it('drops snoozed users', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }, { id: 'b', discord_id: 'db' }],
      { ...empty, snoozed: new Set(['a']) },
    );
    expect(out.map((u) => u.id)).toEqual(['b']);
  });

  it('drops users in an active match (the bug the old ping code missed)', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }, { id: 'b', discord_id: 'db' }],
      { ...empty, inActiveMatch: new Set(['a']) },
    );
    expect(out.map((u) => u.id)).toEqual(['b']);
  });

  it('returns empty when every candidate is excluded', () => {
    const out = selectEligibleRecipients(
      [{ id: 'a', discord_id: 'da' }],
      { ...empty, snoozed: new Set(['a']) },
    );
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Lua scripts (real Redis, isolated keys)
// ---------------------------------------------------------------------------

describe('matchmaking Lua scripts', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('JOIN_SCRIPT joins once and rejects duplicates', async () => {
    const q = `test:q:${randomUUID()}`;
    const j = `test:j:${randomUUID()}`;

    expect(await redis.eval(JOIN_SCRIPT, 2, q, j, 'u1', '1000')).toBe(1);
    expect(await redis.eval(JOIN_SCRIPT, 2, q, j, 'u1', '2000')).toBe(0); // dup
    expect(await redis.llen(q)).toBe(1);
    expect(await redis.hget(j, 'u1')).toBe('1000'); // original timestamp kept

    await redis.del(q, j);
  });

  it('FIFO_MATCH_SCRIPT respects the hold and pairs the two oldest', async () => {
    const q = `test:q:${randomUUID()}`;
    const hold = `test:hold:${randomUUID()}`;
    await redis.rpush(q, 'a', 'b', 'c');

    // Hold active → no match.
    await redis.set(hold, '1');
    expect(await redis.eval(FIFO_MATCH_SCRIPT, 2, q, hold)).toBe(null);
    expect(await redis.llen(q)).toBe(3);

    // Hold cleared → pair the two oldest, leaving the third.
    await redis.del(hold);
    expect(await redis.eval(FIFO_MATCH_SCRIPT, 2, q, hold)).toEqual(['a', 'b']);
    expect(await redis.lrange(q, 0, -1)).toEqual(['c']);

    // Fewer than two → no match.
    expect(await redis.eval(FIFO_MATCH_SCRIPT, 2, q, hold)).toBe(null);

    await redis.del(q);
  });

  it('POP_OLDEST_SCRIPT returns the oldest player that is not the clicker', async () => {
    const q = `test:q:${randomUUID()}`;

    // clicker is the oldest entry — must be skipped, next oldest taken.
    await redis.rpush(q, 'clicker', 'x', 'y');
    expect(await redis.eval(POP_OLDEST_SCRIPT, 1, q, 'clicker')).toBe('x');
    expect(await redis.lrange(q, 0, -1)).toEqual(['clicker', 'y']);

    // Only the clicker remains → nothing to match.
    await redis.del(q);
    await redis.rpush(q, 'clicker');
    expect(await redis.eval(POP_OLDEST_SCRIPT, 1, q, 'clicker')).toBe(null);

    // Empty queue → nothing to match.
    await redis.del(q);
    expect(await redis.eval(POP_OLDEST_SCRIPT, 1, q, 'clicker')).toBe(null);
  });

  it('POP_OLDEST_SCRIPT is atomic across parallel clicks (each gets a distinct opponent)', async () => {
    const q = `test:q:${randomUUID()}`;
    await redis.rpush(q, 'w1', 'w2');

    // Two different clickers pop concurrently — they must not get the same waiter.
    const [r1, r2] = await Promise.all([
      redis.eval(POP_OLDEST_SCRIPT, 1, q, 'clickerA'),
      redis.eval(POP_OLDEST_SCRIPT, 1, q, 'clickerB'),
    ]);
    expect([r1, r2].sort()).toEqual(['w1', 'w2']);
    expect(await redis.llen(q)).toBe(0);

    await redis.del(q);
  });
});

// ---------------------------------------------------------------------------
// 3. runMatchmakingTick — state transitions (real Redis + Prisma, Discord mocked)
// ---------------------------------------------------------------------------

const QUEUE_KEY = 'rizzotto:queue:open_play';
const JOINED_AT_KEY = 'rizzotto:queue:open_play:joined_at';
const HOLD_KEY = 'rizzotto:mm:hold';
const RATELIMIT_KEY = 'rizzotto:mm:ratelimit';
const CONTACTED_KEY = 'rizzotto:mm:contacted';
const LOCK_KEY = 'rizzotto:mm:tick:lock';
const ALL_MM_KEYS = [QUEUE_KEY, JOINED_AT_KEY, HOLD_KEY, RATELIMIT_KEY, CONTACTED_KEY, LOCK_KEY];

describe('runMatchmakingTick', () => {
  let redis: Redis;
  let fastify: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    fastify = { redis, prisma, log } as unknown as FastifyInstance;
  });

  afterAll(async () => {
    await redis.del(...ALL_MM_KEYS);
    if (createdUserIds.length) await cleanupUsers(createdUserIds);
    await redis.quit();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await redis.del(...ALL_MM_KEYS);
  });

  it('clears the wait-cycle state when the queue is empty', async () => {
    await redis.set(HOLD_KEY, '1');
    await redis.sadd(CONTACTED_KEY, 'someone');

    await runMatchmakingTick(fastify);

    expect(await redis.exists(HOLD_KEY)).toBe(0);
    expect(await redis.exists(CONTACTED_KEY)).toBe(0);
    expect(notifyAvailabilityPing).not.toHaveBeenCalled();
  });

  it('does not FIFO-match while a hold is active', async () => {
    await redis.rpush(QUEUE_KEY, 'u1', 'u2');
    await redis.set(HOLD_KEY, '1');
    await redis.set(RATELIMIT_KEY, '1'); // skip the DM phase

    await runMatchmakingTick(fastify);

    expect(await redis.lrange(QUEUE_KEY, 0, -1)).toEqual(['u1', 'u2']); // untouched
    expect(notifyMatchFoundWithButtons).not.toHaveBeenCalled();
  });

  it('skips the DM wave while rate-limited', async () => {
    const u = await createTestUser();
    createdUserIds.push(u.id);
    await addCurrentHourSlot(u.id);

    await redis.rpush(QUEUE_KEY, 'waiter');
    await redis.set(RATELIMIT_KEY, '1'); // wave already sent this window

    await runMatchmakingTick(fastify);

    expect(notifyAvailabilityPing).not.toHaveBeenCalled();
    expect(await redis.exists(HOLD_KEY)).toBe(0);
  });

  it('DMs a newly-eligible available player and arms the hold + rate-limit', async () => {
    const u = await createTestUser();
    createdUserIds.push(u.id);
    await addCurrentHourSlot(u.id);

    await redis.rpush(QUEUE_KEY, 'waiter'); // someone is waiting

    await runMatchmakingTick(fastify);

    expect(notifyAvailabilityPing).toHaveBeenCalledWith(u.discord_id, expect.any(Number));
    expect(await redis.exists(HOLD_KEY)).toBe(1);
    expect(await redis.exists(RATELIMIT_KEY)).toBe(1);
    expect(await redis.sismember(CONTACTED_KEY, u.id)).toBe(1);
  });

  it('does not DM a player who was already contacted this wait-cycle', async () => {
    const u = await createTestUser();
    createdUserIds.push(u.id);
    await addCurrentHourSlot(u.id);

    await redis.rpush(QUEUE_KEY, 'waiter');
    await redis.sadd(CONTACTED_KEY, u.id); // already pinged

    await runMatchmakingTick(fastify);

    expect(notifyAvailabilityPing).not.toHaveBeenCalledWith(u.discord_id, expect.any(Number));
  });

  // A user with MATCHMAKING availability for the current UTC hour.
  async function addCurrentHourSlot(userId: string): Promise<void> {
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7;
    const hour = now.getUTCHours();
    await prisma.availabilitySlot.create({
      data: { user_id: userId, day_of_week: day, hour_utc: hour, context: 'MATCHMAKING' },
    });
  }
});
