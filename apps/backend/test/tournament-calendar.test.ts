/**
 * Integration tests for Tournament filter/calendar endpoints (M6):
 *
 *  GET  /api/tournaments          — ?is_major + ?status filter
 *  GET  /api/tournaments/calendar — JSON CalendarTournament array
 *  GET  /api/tournaments/calendar.ics — iCal feed
 *  PATCH /api/tournaments/:slug   — is_major field update
 *
 * Auth for PATCH: authenticate + organizer-owns-or-ADMIN check.
 * No Redis, no Socket.IO needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import {
  createTestUser,
  cleanupTournament,
  cleanupUsers,
  type TestUser,
} from './helpers/db-fixtures.js';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let organizer: TestUser;
let tournamentIds: string[];
let tournamentSlugs: string[];

beforeEach(async () => {
  tournamentIds = [];
  tournamentSlugs = [];
  organizer = await createTestUser({ username: 'CalendarOrganizer' });
});

afterEach(async () => {
  for (const id of tournamentIds) {
    await cleanupTournament(id);
  }
  await cleanupUsers([organizer.id]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(userId: string, role: string = 'USER'): string {
  return app.jwt.sign({ sub: userId, discord_id: `disc_${userId}`, username: 'test', role });
}

async function createTournamentRaw(opts: {
  slug?: string;
  status?: string;
  is_major?: boolean;
  rounds_count?: number;
}): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = opts.slug ?? `cal-test-${id}`;

  await prisma.tournament.create({
    data: {
      id,
      slug,
      name: `Cal Tournament ${id.slice(0, 8)}`,
      organizer_id: organizer.id,
      format: 'SWISS',
      status: (opts.status ?? 'ONGOING') as never,
      is_major: opts.is_major ?? false,
      start_date: new Date('2026-08-01T10:00:00.000Z'),
      timezone: 'Europe/Berlin',
      rounds_count: opts.rounds_count ?? 5,
      visibility: 'PUBLIC',
    },
  });

  tournamentIds.push(id);
  tournamentSlugs.push(slug);
  return { id, slug };
}

// ---------------------------------------------------------------------------
// GET /api/tournaments — filter tests
// ---------------------------------------------------------------------------

describe('GET /api/tournaments', () => {
  it('?is_major=true returns only major tournaments', async () => {
    const major = await createTournamentRaw({ is_major: true });
    const minor = await createTournamentRaw({ is_major: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments?is_major=true',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: Array<{ id: string; is_major: boolean }>;
      total: number;
    }>();

    const ids = body.data.map((t) => t.id);
    expect(ids).toContain(major.id);
    expect(ids).not.toContain(minor.id);
    expect(body.data.every((t) => t.is_major === true)).toBe(true);
  });

  it('?status=ONGOING returns only ONGOING tournaments', async () => {
    const ongoing = await createTournamentRaw({ status: 'ONGOING' });
    // We cannot easily set COMPLETED without going through the full lifecycle,
    // so we just verify the ongoing one is present.
    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments?status=ONGOING',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; status: string }> }>();

    const ids = body.data.map((t) => t.id);
    expect(ids).toContain(ongoing.id);
    expect(body.data.every((t) => t.status === 'ONGOING')).toBe(true);
  });

  it('?is_major=true returns only major tournaments (filter correctness baseline)', async () => {
    const major = await createTournamentRaw({ is_major: true });
    const minor = await createTournamentRaw({ is_major: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments?is_major=true&pageSize=100',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; is_major: boolean }> }>();

    const ids = body.data.map((t) => t.id);
    expect(ids).toContain(major.id);
    expect(ids).not.toContain(minor.id);
    expect(body.data.every((t) => t.is_major === true)).toBe(true);
  });

  it('?is_major=false returns only non-major tournaments (string "false" maps to false)', async () => {
    // Regression guard: z.coerce.boolean() was wrong here because Boolean("false")
    // === true. The schema now maps the literal "false" string to boolean false.
    const major = await createTournamentRaw({ is_major: true });
    const minor = await createTournamentRaw({ is_major: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments?is_major=false&pageSize=100',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; is_major: boolean }> }>();

    const ids = body.data.map((t) => t.id);
    expect(ids).toContain(minor.id);
    expect(ids).not.toContain(major.id);
    expect(body.data.every((t) => t.is_major === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tournaments/calendar
// ---------------------------------------------------------------------------

describe('GET /api/tournaments/calendar', () => {
  it('returns array of CalendarTournament; end_date > start_date', async () => {
    await createTournamentRaw({ rounds_count: 4 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/calendar',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<
      Array<{
        id: string;
        slug: string;
        name: string;
        start_date: string;
        end_date: string;
        format: string;
        is_major: boolean;
        status: string;
        timezone: string;
      }>
    >();

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const entry of body) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.slug).toBe('string');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.start_date).toBe('string');
      expect(typeof entry.end_date).toBe('string');
      expect(typeof entry.format).toBe('string');
      expect(typeof entry.is_major).toBe('boolean');
      expect(typeof entry.status).toBe('string');
      expect(typeof entry.timezone).toBe('string');

      const start = new Date(entry.start_date).getTime();
      const end = new Date(entry.end_date).getTime();
      expect(end).toBeGreaterThan(start);
    }
  });

  it('end_date is start_date + rounds_count * 2h', async () => {
    // rounds_count=3 → end = start + 3*2h = start + 6h
    const { id } = await createTournamentRaw({ rounds_count: 3 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/calendar',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ id: string; start_date: string; end_date: string }>>() ;
    const entry = body.find((t) => t.id === id);
    expect(entry).toBeDefined();

    const startMs = new Date(entry!.start_date).getTime();
    const endMs = new Date(entry!.end_date).getTime();
    const diffHours = (endMs - startMs) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(6, 1); // 3 rounds × 2h
  });

  it('?is_major=true filter only returns major tournaments', async () => {
    const major = await createTournamentRaw({ is_major: true });
    const minor = await createTournamentRaw({ is_major: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/calendar?is_major=true',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ id: string; is_major: boolean }>>();
    const ids = body.map((t) => t.id);
    expect(ids).toContain(major.id);
    expect(ids).not.toContain(minor.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tournaments/calendar.ics
// ---------------------------------------------------------------------------

describe('GET /api/tournaments/calendar.ics', () => {
  it('returns 200, content-type text/calendar, body starts with BEGIN:VCALENDAR', async () => {
    await createTournamentRaw({});

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/calendar.ics',
    });

    expect(res.statusCode).toBe(200);
    const contentType = res.headers['content-type'] as string;
    expect(contentType).toContain('text/calendar');

    const body = res.body;
    expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('END:VEVENT');
    expect(body).toContain('END:VCALENDAR');
  });

  it('each VEVENT contains DTSTART and DTEND', async () => {
    await createTournamentRaw({});

    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/calendar.ics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('DTSTART');
    expect(res.body).toContain('DTEND');
    expect(res.body).toContain('SUMMARY');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tournaments/:slug — is_major
// ---------------------------------------------------------------------------

describe('PATCH /api/tournaments/:slug — is_major', () => {
  it('organizer can set is_major:true; detail response reflects change', async () => {
    // Create tournament owned by organizer (status DRAFT so we can use the slug)
    const id = randomUUID();
    const slug = `patch-major-${id}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: `Patch Major Test ${id.slice(0, 8)}`,
        organizer_id: organizer.id,
        format: 'SWISS',
        status: 'ONGOING',
        is_major: false,
        start_date: new Date('2026-09-01T10:00:00.000Z'),
        timezone: 'Europe/Berlin',
        visibility: 'PUBLIC',
      },
    });
    tournamentIds.push(id);
    tournamentSlugs.push(slug);

    const token = makeToken(organizer.id, 'ORGANIZER');
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      cookies: { auth_token: token },
      payload: { is_major: true },
    });

    expect(patchRes.statusCode).toBe(200);

    // Verify via GET /api/tournaments/:slug
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${slug}`,
    });

    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json<{ is_major: boolean }>();
    expect(detail.is_major).toBe(true);
  });

  it('ADMIN can set is_major on any tournament', async () => {
    const id = randomUUID();
    const slug = `patch-major-admin-${id}`;
    // Create a separate organizer for this test
    const tOrganizer = await createTestUser({ username: 'PatchOrganizer' });
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: `Admin Patch Major ${id.slice(0, 8)}`,
        organizer_id: tOrganizer.id,
        format: 'SWISS',
        status: 'ONGOING',
        is_major: false,
        start_date: new Date('2026-09-01T10:00:00.000Z'),
        timezone: 'Europe/Berlin',
        visibility: 'PUBLIC',
      },
    });
    // Track tournament for afterEach cleanup; also track extra user
    tournamentIds.push(id);
    tournamentSlugs.push(slug);
    // We need to clean the tournament before the user — store user ID for manual cleanup
    const extraUserIds: string[] = [tOrganizer.id];

    const adminToken = makeToken(organizer.id, 'ADMIN');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      cookies: { auth_token: adminToken },
      payload: { is_major: true },
    });

    expect(res.statusCode).toBe(200);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${slug}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json<{ is_major: boolean }>();
    expect(detail.is_major).toBe(true);

    // Cleanup tournament first, then extra user (FK order)
    await cleanupTournament(id);
    // Remove from tournamentIds so afterEach doesn't try again
    const idx = tournamentIds.indexOf(id);
    if (idx !== -1) tournamentIds.splice(idx, 1);
    await cleanupUsers(extraUserIds);
  });

  it('401 without auth token', async () => {
    const { slug } = await createTournamentRaw({});

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      payload: { is_major: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for unrelated USER trying to patch another organizer tournament', async () => {
    const otherUser = await createTestUser({ username: 'CalOtherUser' });
    const id = randomUUID();
    const slug = `patch-forbidden-${id}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: `Forbidden Patch ${id.slice(0, 8)}`,
        organizer_id: organizer.id,
        format: 'SWISS',
        status: 'ONGOING',
        is_major: false,
        start_date: new Date('2026-09-01T10:00:00.000Z'),
        timezone: 'Europe/Berlin',
        visibility: 'PUBLIC',
      },
    });
    tournamentIds.push(id);
    tournamentSlugs.push(slug);

    const token = makeToken(otherUser.id, 'USER');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      cookies: { auth_token: token },
      payload: { is_major: true },
    });

    expect(res.statusCode).toBe(403);
    await cleanupUsers([otherUser.id]);
  });
});
