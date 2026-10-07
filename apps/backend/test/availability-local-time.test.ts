/**
 * Availability slots are LOCAL time (weekday + hour in the owner's zone), so a "Tuesday 20:00"
 * slot stays 20:00 local across daylight-saving changes. Covers the pure helpers, the DB-backed
 * "who is available now" lookup, the UTC-raster heatmap projection, the PUT/GET /me contract and
 * the data migration that converted legacy UTC slots.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { invalidate } from '../src/lib/cache.js';
import {
  localSlotNow,
  projectSlotToUtcCell,
  resolveZone,
  slotToInstant,
  slotsActiveAtWhere,
} from '../src/lib/availability-time.js';

// Tuesday 20:00 local (day_of_week 1 = Tue)
const TUE_20 = { day_of_week: 1, hour: 20 };

describe('availability-time helpers', () => {
  it('Tue 20:00 Europe/Berlin is "now" at 18:00Z in July and 19:00Z in December', () => {
    expect(localSlotNow(new Date('2026-07-14T18:00:00Z'), 'Europe/Berlin')).toEqual({ day_of_week: 1, hour: 20 });
    expect(localSlotNow(new Date('2026-12-15T19:00:00Z'), 'Europe/Berlin')).toEqual({ day_of_week: 1, hour: 20 });
    // The old UTC logic would have kept matching 18:00Z in winter, which is 19:00 local.
    expect(localSlotNow(new Date('2026-12-15T18:00:00Z'), 'Europe/Berlin')).toEqual({ day_of_week: 1, hour: 19 });
  });

  it('handles America/New_York (own DST dates) and the weekday wrap Sunday to Monday', () => {
    expect(localSlotNow(new Date('2026-07-15T00:00:00Z'), 'America/New_York')).toEqual({ day_of_week: 1, hour: 20 }); // Tue 20:00 EDT
    expect(localSlotNow(new Date('2026-12-16T01:00:00Z'), 'America/New_York')).toEqual({ day_of_week: 1, hour: 20 }); // Tue 20:00 EST
    // Sunday 23:30Z in Berlin summer is already Monday 01:30.
    expect(localSlotNow(new Date('2026-07-12T23:30:00Z'), 'Europe/Berlin')).toEqual({ day_of_week: 0, hour: 1 });
    // Monday 01:00Z in New York summer is still Sunday 21:00.
    expect(localSlotNow(new Date('2026-07-13T01:00:00Z'), 'America/New_York')).toEqual({ day_of_week: 6, hour: 21 });
  });

  it('falls back to Europe/Berlin for a missing or invalid zone', () => {
    expect(resolveZone(null)).toBe('Europe/Berlin');
    expect(resolveZone('Mars/Olympus')).toBe('Europe/Berlin');
    expect(resolveZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(localSlotNow(new Date('2026-07-14T18:00:00Z'), 'Mars/Olympus')).toEqual({ day_of_week: 1, hour: 20 });
  });

  it('slotToInstant derives the UTC instant for the concrete week (DST-correct)', () => {
    expect(slotToInstant(TUE_20, 'Europe/Berlin', new Date('2026-07-14T10:00:00Z')).toISOString()).toBe('2026-07-14T18:00:00.000Z');
    expect(slotToInstant(TUE_20, 'Europe/Berlin', new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2026-12-15T19:00:00.000Z');
    expect(slotToInstant(TUE_20, 'America/New_York', new Date('2026-07-14T10:00:00Z')).toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('projects a local slot onto the UTC raster of the reference week', () => {
    expect(projectSlotToUtcCell(TUE_20, 'Europe/Berlin', new Date('2026-07-14T10:00:00Z'))).toEqual({ day_of_week: 1, hour_utc: 18 });
    expect(projectSlotToUtcCell(TUE_20, 'Europe/Berlin', new Date('2026-12-15T10:00:00Z'))).toEqual({ day_of_week: 1, hour_utc: 19 });
    // Tue 20:00 New York summer = Wed 00:00Z
    expect(projectSlotToUtcCell(TUE_20, 'America/New_York', new Date('2026-07-14T10:00:00Z'))).toEqual({ day_of_week: 2, hour_utc: 0 });
    // Mon 01:00 Berlin summer = Sun 23:00Z
    expect(projectSlotToUtcCell({ day_of_week: 0, hour: 1 }, 'Europe/Berlin', new Date('2026-07-14T10:00:00Z'))).toEqual({ day_of_week: 6, hour_utc: 23 });
  });
});

// ---------------------------------------------------------------------------
// DB + routes
// ---------------------------------------------------------------------------

const ID = (n: number) => `a7a70000-0000-0000-0000-00000000000${n}`;
const BERLIN = ID(1);
const NY = ID(2);
const NULLTZ = ID(3);
const PAUSED = ID(4);
const USER_IDS = [BERLIN, NY, NULLTZ, PAUSED];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: true, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await invalidate(app.redis, 'availability:heatmap*');
  await app.close();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.availabilitySlot.deleteMany({ where: { user_id: { in: USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: BERLIN, discord_id: 'al_berlin', username: 'AlBerlin', email: null, timezone: 'Europe/Berlin' },
      { id: NY, discord_id: 'al_ny', username: 'AlNewYork', email: null, timezone: 'America/New_York' },
      { id: NULLTZ, discord_id: 'al_null', username: 'AlNull', email: null, timezone: null },
      { id: PAUSED, discord_id: 'al_paused', username: 'AlPaused', email: null, timezone: 'Europe/Berlin', availability_paused: true },
    ],
  });
  await invalidate(app.redis, 'availability:heatmap*');
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

function cookie(sub: string, role = 'USER') {
  return { auth_token: app.jwt.sign({ sub, username: 'x', role }) };
}

async function slot(user_id: string, day_of_week: number, hour_local: number, context: 'MATCHMAKING' | 'TOURNAMENT' = 'MATCHMAKING') {
  await prisma.availabilitySlot.create({ data: { user_id, day_of_week, hour_local, context } });
}

async function activeUserIds(at: Date, context: 'MATCHMAKING' | 'TOURNAMENT' = 'MATCHMAKING') {
  const where = await slotsActiveAtWhere(prisma, at);
  if (!where) return [];
  const rows = await prisma.availabilitySlot.findMany({
    where: { AND: [where, { context, user_id: { in: USER_IDS } }] },
    select: { user_id: true },
  });
  return rows.map((r) => r.user_id).sort();
}

describe('slotsActiveAtWhere ("available now") with DST', () => {
  it('matches a Berlin Tue 20:00 slot at 18:00Z in summer and 19:00Z in winter, not at the old UTC hour', async () => {
    await slot(BERLIN, 1, 20);
    expect(await activeUserIds(new Date('2026-07-14T18:00:00Z'))).toEqual([BERLIN]);
    expect(await activeUserIds(new Date('2026-12-15T19:00:00Z'))).toEqual([BERLIN]);
    expect(await activeUserIds(new Date('2026-12-15T18:00:00Z'))).toEqual([]);
    expect(await activeUserIds(new Date('2026-07-14T19:00:00Z'))).toEqual([]);
  });

  it('judges every user on their own clock (Berlin vs New York vs no zone)', async () => {
    await slot(BERLIN, 1, 20);
    await slot(NY, 1, 20);
    await slot(NULLTZ, 1, 20);
    // Jul 14, 18:00Z: Berlin 20:00, New York 14:00, no zone -> Berlin 20:00
    expect(await activeUserIds(new Date('2026-07-14T18:00:00Z'))).toEqual([BERLIN, NULLTZ].sort());
    // Jul 15, 00:00Z: New York Tue 20:00
    expect(await activeUserIds(new Date('2026-07-15T00:00:00Z'))).toEqual([NY]);
    // Dec 16, 01:00Z: New York Tue 20:00 (EST)
    expect(await activeUserIds(new Date('2026-12-16T01:00:00Z'))).toEqual([NY]);
  });

  it('keeps contexts apart', async () => {
    await slot(BERLIN, 1, 20, 'TOURNAMENT');
    expect(await activeUserIds(new Date('2026-07-14T18:00:00Z'), 'MATCHMAKING')).toEqual([]);
    expect(await activeUserIds(new Date('2026-07-14T18:00:00Z'), 'TOURNAMENT')).toEqual([BERLIN]);
  });
});

describe('GET /api/availability/now and /api/open-play/queue/count', () => {
  it('counts only players whose own clock is in the slot and skips paused ones', async () => {
    // "Now" is whatever the real clock says: mark the current local hour for every user.
    // Compare against a baseline so pre-existing slots in a shared dev DB do not matter.
    const baseNow = (await app.inject({ method: 'GET', url: '/api/availability/now' })).json<{ count: number }>().count;
    const baseQueue = (await app.inject({ method: 'GET', url: '/api/open-play/queue/count' })).json<{ availableNow: number }>().availableNow;
    const now = new Date();
    for (const [id, tz] of [[BERLIN, 'Europe/Berlin'], [NY, 'America/New_York'], [NULLTZ, null], [PAUSED, 'Europe/Berlin']] as const) {
      const l = localSlotNow(now, tz);
      await slot(id, l.day_of_week, l.hour);
    }
    const nowRes = await app.inject({ method: 'GET', url: '/api/availability/now' });
    expect(nowRes.json<{ count: number }>().count - baseNow).toBe(3);
    const countRes = await app.inject({ method: 'GET', url: '/api/open-play/queue/count' });
    // Regression: the count used to include paused players.
    expect(countRes.json<{ availableNow: number }>().availableNow - baseQueue).toBe(3);
  });
});

describe('GET /api/availability/heatmap projection', () => {
  type Cell = { day_of_week: number; hour_utc: number; count: number };
  async function fetchHeatmap(at: string): Promise<Cell[]> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    await invalidate(app.redis, 'availability:heatmap*');
    const res = await app.inject({ method: 'GET', url: '/api/availability/heatmap?context=MATCHMAKING' });
    vi.useRealTimers();
    await invalidate(app.redis, 'availability:heatmap*');
    return res.json<{ slots: Cell[] }>().slots;
  }
  /** Cells added by this test's slots (heatmap now minus baseline), so a shared dev DB does not matter. */
  async function heatmapDelta(at: string, base: Cell[]): Promise<Cell[]> {
    const before = new Map(base.map((c) => [`${c.day_of_week}:${c.hour_utc}`, c.count]));
    return (await fetchHeatmap(at))
      .map((c) => ({ ...c, count: c.count - (before.get(`${c.day_of_week}:${c.hour_utc}`) ?? 0) }))
      .filter((c) => c.count !== 0);
  }

  it('puts a local Tue 20:00 slot into the UTC cell of the current week (July vs December)', async () => {
    const baseJuly = await fetchHeatmap('2026-07-14T10:00:00Z');
    const baseDec = await fetchHeatmap('2026-12-15T10:00:00Z');
    await slot(BERLIN, 1, 20);
    await slot(NY, 1, 20);
    await slot(PAUSED, 1, 20); // paused: not counted
    const july = await heatmapDelta('2026-07-14T10:00:00Z', baseJuly);
    expect(july).toHaveLength(2);
    expect(july).toContainEqual({ day_of_week: 1, hour_utc: 18, count: 1 }); // Berlin
    expect(july).toContainEqual({ day_of_week: 2, hour_utc: 0, count: 1 }); // New York, Wed 00:00Z
    const dec = await heatmapDelta('2026-12-15T10:00:00Z', baseDec);
    expect(dec).toHaveLength(2);
    expect(dec).toContainEqual({ day_of_week: 1, hour_utc: 19, count: 1 });
    expect(dec).toContainEqual({ day_of_week: 2, hour_utc: 1, count: 1 });
  });

  it('merges users of different zones that land on the same UTC cell', async () => {
    const base = await fetchHeatmap('2026-07-14T10:00:00Z');
    await slot(BERLIN, 1, 20); // Jul: Tue 18Z
    await slot(NULLTZ, 1, 20); // no zone -> Berlin -> Tue 18Z
    expect(await heatmapDelta('2026-07-14T10:00:00Z', base)).toEqual([{ day_of_week: 1, hour_utc: 18, count: 2 }]);
  });
});

describe('PUT/GET /api/availability (local-time contract)', () => {
  it('stores local hours, returns them as `hour`, and sets the browser zone only when the user has none', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/availability/slots',
      cookies: cookie(NULLTZ),
      payload: { slots: [{ day_of_week: 1, hour: 20, context: 'MATCHMAKING' }], timezone: 'Asia/Tokyo' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<{ slots: { hour: number }[]; timezone: string }>()).toMatchObject({ slots: [{ hour: 20 }], timezone: 'Asia/Tokyo' });
    expect((await prisma.user.findUnique({ where: { id: NULLTZ } }))?.timezone).toBe('Asia/Tokyo');
    expect(await prisma.availabilitySlot.findMany({ where: { user_id: NULLTZ } })).toMatchObject([{ day_of_week: 1, hour_local: 20 }]);

    // An existing zone is never overwritten by the browser's.
    const put2 = await app.inject({
      method: 'PUT',
      url: '/api/availability/slots',
      cookies: cookie(BERLIN),
      payload: { slots: [], timezone: 'Asia/Tokyo' },
    });
    expect(put2.statusCode).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: BERLIN } }))?.timezone).toBe('Europe/Berlin');

    const me = await app.inject({ method: 'GET', url: '/api/availability/me', cookies: cookie(NULLTZ) });
    expect(me.json<{ slots: { hour: number }[]; timezone: string }>()).toMatchObject({ slots: [{ hour: 20 }], timezone: 'Asia/Tokyo' });
  });

  it('ignores an invalid browser zone and rejects the old hour_utc shape', async () => {
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/availability/slots',
      cookies: cookie(NULLTZ),
      payload: { slots: [], timezone: 'Mars/Olympus' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: NULLTZ } }))?.timezone).toBeNull();

    const legacy = await app.inject({
      method: 'PUT',
      url: '/api/availability/slots',
      cookies: cookie(NULLTZ),
      payload: { slots: [{ day_of_week: 1, hour_utc: 18, context: 'MATCHMAKING' }] },
    });
    expect(legacy.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Migration 20261007090000_availability_slots_local_time
// ---------------------------------------------------------------------------

describe('migration: legacy UTC slots become local slots', () => {
  const sql = readFileSync(
    new URL('../../../packages/db/prisma/migrations/20261007090000_availability_slots_local_time/migration.sql', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const section = sql.split('-- BEGIN conversion')[1].split('-- END conversion')[0];
  const statements = section
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const SCHEMA = 'avail_mig_test';

  it('converts using the offset at created_at, with weekday wrap, fallback zone and half-hour rounding', async () => {
    const u = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;
    const users: [number, string | null][] = [
      [1, 'Europe/Berlin'],
      [2, 'Europe/Berlin'],
      [3, 'America/New_York'],
      [4, 'Mars/Olympus'],
      [5, null],
      [6, 'Asia/Kolkata'],
      [7, 'America/St_Johns'],
    ];
    // [user, legacy day (UTC), legacy hour (UTC), created_at] -> expected local [day, hour]
    const cases: [number, number, number, string, [number, number]][] = [
      [1, 1, 18, '2026-07-10 12:00', [1, 20]], // Berlin saved in summer: 18Z = 20:00
      [2, 1, 19, '2026-12-10 12:00', [1, 20]], // Berlin saved in winter: 19Z = 20:00
      [3, 0, 2, '2026-07-10 12:00', [6, 22]], // New York summer: Mon 02Z = Sun 22:00
      [4, 6, 23, '2026-07-10 12:00', [0, 1]], // invalid zone -> Berlin: Sun 23Z = Mon 01:00
      [5, 2, 10, '2026-12-10 12:00', [2, 11]], // no zone -> Berlin winter
      [6, 0, 0, '2026-07-10 12:00', [0, 6]], // Kolkata +5:30 rounds to +6 like the old UI
      [7, 0, 10, '2026-07-10 12:00', [0, 8]], // St. John's -2:30 rounds to -2 like the old UI
    ];

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}", public`);
      await tx.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."User" ("id" uuid PRIMARY KEY, "timezone" text)`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${SCHEMA}"."AvailabilitySlot" ("id" uuid PRIMARY KEY, "user_id" uuid NOT NULL, "day_of_week" int NOT NULL, "hour_local" int NOT NULL, "context" text NOT NULL, "created_at" timestamp(3) NOT NULL)`,
      );
      for (const [n, tz] of users) {
        await tx.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."User" VALUES ($1::uuid, $2)`, u(n), tz);
      }
      for (const [n, d, h, created] of cases) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${SCHEMA}"."AvailabilitySlot" VALUES ($1::uuid, $2::uuid, $3, $4, 'MATCHMAKING', $5::timestamp)`,
          randomUUID(), u(n), d, h, created,
        );
      }

      for (const st of statements) await tx.$executeRawUnsafe(st);

      const rows = await tx.$queryRawUnsafe<{ user_id: string; day_of_week: number; hour_local: number }[]>(
        `SELECT user_id, day_of_week, hour_local FROM "${SCHEMA}"."AvailabilitySlot"`,
      );
      expect(rows).toHaveLength(cases.length);
      for (const [n, , , , [day, hour]] of cases) {
        const row = rows.find((r) => r.user_id === u(n));
        expect([n, row?.day_of_week, row?.hour_local]).toEqual([n, day, hour]);
      }
      // Roll the scratch schema back with the transaction.
      throw new Error('ROLLBACK_TEST_SCHEMA');
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK_TEST_SCHEMA') throw e;
    });
  });
});
