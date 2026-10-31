/**
 * Admin Open Play queue report: how each queue join ended (the pure classifier and day builder) and
 * the admin-only route (real PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import {
  buildQueueReport,
  classifyQueueJoins,
  MAX_QUEUE_STAY_MS,
  type QueueReport,
  type QueueReportEvent,
} from '../src/lib/admin-queue-report.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

const MIN = 60_000;
// Wednesday 2026-10-28, 18:00 site time (CET, UTC+1).
const T0 = new Date('2026-10-28T17:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * MIN);
const ev = (userId: string, event: QueueReportEvent['event'], min: number, source?: QueueReportEvent['source']) => ({
  userId,
  event,
  at: at(min),
  source,
});

describe('classifyQueueJoins', () => {
  const later = at(24 * 60);

  it('pairs each join with the next match or leave of the same player', () => {
    const joins = classifyQueueJoins(
      [
        ev('a', 'JOIN', 0),
        ev('b', 'JOIN', 1),
        ev('a', 'MATCH', 6, 'QUEUE'),
        ev('b', 'LEAVE', 3),
        ev('c', 'JOIN', 2),
        ev('c', 'MATCH', 4, 'AVAILABILITY'),
      ],
      later,
    );
    expect(joins.map((j) => [j.userId, j.outcome, j.viaDm, j.waitMs])).toEqual([
      ['a', 'MATCHED', false, 6 * MIN],
      ['b', 'LEFT', false, 2 * MIN],
      ['c', 'MATCHED', true, 2 * MIN],
    ]);
  });

  it('counts a join without an outcome as expired, or waiting while it can still be in the queue', () => {
    const joins = classifyQueueJoins([ev('a', 'JOIN', 0), ev('b', 'JOIN', 30)], at(60));
    expect(joins.map((j) => j.outcome)).toEqual(['EXPIRED', 'WAITING']);
  });

  it('ends a join at its longest stay and when the player joins again', () => {
    const stay = MAX_QUEUE_STAY_MS / MIN;
    const joins = classifyQueueJoins(
      [
        ev('a', 'JOIN', 0),
        ev('a', 'MATCH', stay + 5, 'QUEUE'), // too late: a match he took some other way
        ev('b', 'JOIN', 0),
        ev('b', 'JOIN', 40), // back after the cleanup removed him
        ev('b', 'LEAVE', 41),
      ],
      later,
    );
    expect(joins.map((j) => [j.userId, j.outcome])).toEqual([
      ['a', 'EXPIRED'],
      ['b', 'EXPIRED'],
      ['b', 'LEFT'],
    ]);
  });

  it("gives a join the match logged a moment before it (another player's tick paired him first)", () => {
    const joins = classifyQueueJoins(
      [{ userId: 'a', event: 'MATCH', at: new Date(T0.getTime() - 2000), source: 'QUEUE' }, ev('a', 'JOIN', 0)],
      later,
    );
    expect(joins.map((j) => [j.outcome, j.waitMs])).toEqual([['MATCHED', 0]]);
  });

  it('ignores matches without a join (the player who took an availability DM)', () => {
    expect(classifyQueueJoins([ev('a', 'MATCH', 0, 'AVAILABILITY')], later)).toEqual([]);
  });
});

describe('buildQueueReport', () => {
  it('fills every day of the window, newest first, with players who got no game', () => {
    const now = at(2 * 24 * 60); // Friday 18:00
    const windowStart = new Date('2026-10-27T23:00:00Z'); // Wednesday 00:00 site time
    const report = buildQueueReport(
      [
        ev('a', 'JOIN', 0),
        ev('a', 'LEAVE', 1),
        ev('a', 'JOIN', 10), // a: expired, so no game all day
        ev('b', 'JOIN', 20),
        ev('b', 'LEAVE', 21),
        ev('b', 'JOIN', 22),
        ev('b', 'MATCH', 25, 'QUEUE'), // b: missed once, then a game
        ev('c', 'JOIN', 2 * 24 * 60 - 5), // c: still waiting on Friday
        ev('z', 'JOIN', -24 * 60), // before the window
      ],
      windowStart,
      now,
    );
    expect(report.daily.map((d) => d.day)).toEqual(['2026-10-30', '2026-10-29', '2026-10-28']);
    expect(report.daily[2]).toEqual({
      day: '2026-10-28',
      joins: 4,
      matched: 1,
      matchedViaDm: 0,
      left: 2,
      expired: 1,
      waiting: 0,
      players: 2,
      playersWithoutGame: 1,
    });
    expect(report.daily[0]).toMatchObject({ joins: 1, waiting: 1, players: 1, playersWithoutGame: 0 });
    expect(report.medianWaitToMatchSec).toBe(3 * 60);
    expect(report.medianWaitBeforeLeavingSec).toBe(60);
    // Wednesday (Mon-first index 2), 18:00 site time: 4 joins, 3 without a match.
    expect(report.joinsGrid[2]?.[18]).toBe(4);
    expect(report.unmatchedGrid[2]?.[18]).toBe(3);
  });

  it('starts an all-time report at the first join, and is empty without any', () => {
    const now = at(24 * 60);
    const all = buildQueueReport([ev('a', 'JOIN', 0), ev('a', 'MATCH', 1, 'QUEUE')], new Date(0), now);
    expect(all.daily.map((d) => d.day)).toEqual(['2026-10-29', '2026-10-28']);
    const none = buildQueueReport([], new Date(0), now);
    expect(none.daily).toEqual([]);
    expect(none.medianWaitToMatchSec).toBeNull();
  });
});

describe('admin queue report route', () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let player: TestUser;
  const cookie = (u: TestUser, role: string) => ({
    auth_token: app.jwt.sign({ sub: u.id, username: u.username, role }),
  });

  beforeAll(async () => {
    app = await buildApp({
      withSocket: false,
      withRedis: false,
      withCron: false,
      withGraphql: false,
      withDraft: false,
    });
    await app.ready();
    admin = await createTestUser({ username: 'queue-report-admin' });
    player = await createTestUser({ username: 'queue-report-player' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  });

  afterAll(async () => {
    await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: [admin.id, player.id] } } });
    await cleanupUsers([admin.id, player.id]);
    await app.close();
    await prisma.$disconnect();
  });

  it("serves today's joins to admins", async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/queue?days=7',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(before.statusCode).toBe(200);
    const leftBefore = (before.json() as QueueReport).daily[0]?.left ?? 0;

    const now = Date.now();
    await prisma.queueActivityLog.createMany({
      data: [
        { user_id: player.id, event: 'JOIN', created_at: new Date(now - 2 * MIN) },
        { user_id: player.id, event: 'LEAVE', created_at: new Date(now - MIN) },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/queue?days=7',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QueueReport & { days: number };
    expect(body.days).toBe(7);
    expect(body.daily).toHaveLength(7);
    expect(body.daily[0]?.left).toBe(leftBefore + 1);
    expect(body.unmatchedGrid).toHaveLength(7);
  });

  it('rejects non-admins and bad windows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/queue',
      cookies: cookie(player, 'USER'),
    });
    expect(res.statusCode).toBe(403);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/queue?days=-1',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(bad.statusCode).toBe(400);
  });
});
