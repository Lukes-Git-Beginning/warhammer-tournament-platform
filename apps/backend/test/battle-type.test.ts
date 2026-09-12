/**
 * Integration tests for battle_type + availability on Tournament + Map.
 *
 * Covers:
 *  1. POST /api/tournaments with battle_type:'SIEGE' persists + returns it.
 *  2. GET /api/tournaments/:slug includes battle_type.
 *  3. Map pool validation on CREATE: a map of a different battle type (or an
 *     unavailable one) is rejected with 422.
 *  4. Map pool validation on PATCH: effective battle type logic.
 *  5. Admin map CRUD: battle_type (single) + available persist and update.
 *  6. GET /api/maps?battle_type=SIEGE returns only available SIEGE maps.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

type BT = 'DOMINATION' | 'CONQUEST' | 'SIEGE';

const ADMIN_ID = 'ba000000-0000-0000-0000-000000000001';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: false,
    withCron: false,
    withGraphql: false,
    withDraft: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const createdMapIds: string[] = [];
const createdTournamentIds: string[] = [];

async function cleanup() {
  if (createdTournamentIds.length > 0) {
    await prisma.tournamentMapPool.deleteMany({ where: { tournament_id: { in: createdTournamentIds } } });
    await prisma.auditLog.deleteMany({ where: { entity_id: { in: createdTournamentIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
    createdTournamentIds.length = 0;
  }
  if (createdMapIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entity_type: 'Map', entity_id: { in: createdMapIds } } });
    await prisma.map.deleteMany({ where: { id: { in: createdMapIds } } });
    createdMapIds.length = 0;
  }
  await prisma.auditLog.deleteMany({ where: { actor_id: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.create({
    data: { id: ADMIN_ID, discord_id: 'bt_admin', username: 'BTAdmin', email: null, role: 'ADMIN' },
  });
});

afterEach(async () => {
  await cleanup();
});

function adminCookie() {
  const token = app.jwt.sign({ sub: ADMIN_ID, username: 'BTAdmin', role: 'ADMIN' });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

// A map is built for ONE battle type; `available` gates whether it's offered to hosts + Open Play.
async function createMap(opts: { battleType?: BT; available?: boolean; suffix?: string }) {
  const id = randomUUID();
  const slug = `bt-map-${id.slice(0, 8)}${opts.suffix ?? ''}`;
  await prisma.map.create({
    data: {
      id,
      slug,
      name: `BT Test Map ${id.slice(0, 8)}`,
      battle_type: opts.battleType ?? 'DOMINATION',
      available: opts.available ?? true,
    },
  });
  createdMapIds.push(id);
  return id;
}

async function createTournamentViaHttp(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tournaments',
    headers: { cookie: adminCookie() },
    payload: {
      name: 'Battle Type Test',
      format: 'SWISS',
      start_date: '2026-12-01T10:00:00.000Z',
      timezone: 'Europe/Berlin',
      ...payload,
    },
  });
  if (res.statusCode === 201) {
    createdTournamentIds.push(res.json<{ id: string }>().id);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 1. POST /api/tournaments — battle_type
// ---------------------------------------------------------------------------

describe('POST /api/tournaments — battle_type', () => {
  it('persists battle_type:SIEGE and returns it in the 201 response', async () => {
    const res = await createTournamentViaHttp({ battle_type: 'SIEGE' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ battle_type: string }>().battle_type).toBe('SIEGE');
  });

  it('defaults battle_type to DOMINATION when omitted', async () => {
    const res = await createTournamentViaHttp({});
    expect(res.statusCode).toBe(201);
    expect(res.json<{ battle_type: string }>().battle_type).toBe('DOMINATION');
  });

  it('returns 400 for an invalid battle_type value', async () => {
    const res = await createTournamentViaHttp({ battle_type: 'INVALID' });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/tournaments/:slug — battle_type in response
// ---------------------------------------------------------------------------

describe('GET /api/tournaments/:slug — battle_type in response', () => {
  it('returns battle_type in the tournament detail response', async () => {
    const createRes = await createTournamentViaHttp({ battle_type: 'CONQUEST' });
    expect(createRes.statusCode).toBe(201);
    const { slug } = createRes.json<{ slug: string }>();

    const getRes = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}`, headers: { cookie: adminCookie() } });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<{ battle_type: string }>().battle_type).toBe('CONQUEST');
  });
});

// ---------------------------------------------------------------------------
// 3. Map pool validation on CREATE
// ---------------------------------------------------------------------------

describe('POST /api/tournaments — map pool filtered by battle type + availability', () => {
  it('accepts maps of the tournament battle type', async () => {
    const [m1, m2, m3] = await Promise.all([
      createMap({ battleType: 'SIEGE' }),
      createMap({ battleType: 'SIEGE' }),
      createMap({ battleType: 'SIEGE' }),
    ]);
    const res = await createTournamentViaHttp({ battle_type: 'SIEGE', map_pool: [m1, m2, m3] });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a map of a different battle type (422)', async () => {
    const [m1, m2] = await Promise.all([createMap({ battleType: 'SIEGE' }), createMap({ battleType: 'SIEGE' })]);
    const dominationId = await createMap({ battleType: 'DOMINATION' });
    const res = await createTournamentViaHttp({ battle_type: 'SIEGE', map_pool: [m1, m2, dominationId] });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ message: string }>().message).toMatch(/battle type SIEGE/i);
  });

  it('rejects an unavailable map even if the battle type matches (422)', async () => {
    const [m1, m2] = await Promise.all([createMap({ battleType: 'SIEGE' }), createMap({ battleType: 'SIEGE' })]);
    const unavailableId = await createMap({ battleType: 'SIEGE', available: false });
    const res = await createTournamentViaHttp({ battle_type: 'SIEGE', map_pool: [m1, m2, unavailableId] });
    expect(res.statusCode).toBe(422);
  });

  it('defaults to DOMINATION filter when battle_type is omitted', async () => {
    const [m1, m2] = await Promise.all([createMap({ battleType: 'DOMINATION' }), createMap({ battleType: 'DOMINATION' })]);
    const siegeId = await createMap({ battleType: 'SIEGE' });
    const res = await createTournamentViaHttp({ map_pool: [m1, m2, siegeId] });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ message: string }>().message).toMatch(/battle type DOMINATION/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Map pool validation on PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/tournaments/:slug — map pool filtered by effective battle type', () => {
  it('uses the patched battle_type when both are changed together', async () => {
    const createRes = await createTournamentViaHttp({ battle_type: 'DOMINATION' });
    expect(createRes.statusCode).toBe(201);
    const { slug } = createRes.json<{ slug: string }>();

    const [sm1, sm2, sm3] = await Promise.all([
      createMap({ battleType: 'SIEGE' }),
      createMap({ battleType: 'SIEGE' }),
      createMap({ battleType: 'SIEGE' }),
    ]);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      headers: { cookie: adminCookie() },
      payload: { battle_type: 'SIEGE', map_pool: [sm1, sm2, sm3] },
    });
    expect(patchRes.statusCode).toBe(200);
  });

  it('rejects a map not of the existing battle type when battle_type is not patched', async () => {
    const createRes = await createTournamentViaHttp({ battle_type: 'DOMINATION' });
    expect(createRes.statusCode).toBe(201);
    const { slug } = createRes.json<{ slug: string }>();

    const [m1, m2] = await Promise.all([createMap({ battleType: 'DOMINATION' }), createMap({ battleType: 'DOMINATION' })]);
    const siegeId = await createMap({ battleType: 'SIEGE' });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      headers: { cookie: adminCookie() },
      payload: { map_pool: [m1, m2, siegeId] },
    });
    expect(patchRes.statusCode).toBe(422);
    expect(patchRes.json<{ message: string }>().message).toMatch(/battle type DOMINATION/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Admin map CRUD — battle_type + available
// ---------------------------------------------------------------------------

describe('Admin map CRUD — battle_type + available', () => {
  it('POST /api/admin/maps persists battle_type + available', async () => {
    const slug = `bt-adm-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/maps',
      headers: { cookie: adminCookie() },
      payload: { name: 'Siege Test Map', slug, battle_type: 'SIEGE', available: false },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; battle_type: string; available: boolean }>();
    createdMapIds.push(created.id);
    expect(created.battle_type).toBe('SIEGE');
    expect(created.available).toBe(false);
  });

  it('POST /api/admin/maps defaults to DOMINATION + available when omitted', async () => {
    const slug = `bt-adm-dom-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/maps',
      headers: { cookie: adminCookie() },
      payload: { name: 'Default BT Map', slug },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; battle_type: string; available: boolean }>();
    createdMapIds.push(created.id);
    expect(created.battle_type).toBe('DOMINATION');
    expect(created.available).toBe(true);
  });

  it('PATCH /api/admin/maps/:id updates battle_type + available', async () => {
    const id = await createMap({ battleType: 'DOMINATION' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/maps/${id}`,
      headers: { cookie: adminCookie() },
      payload: { battle_type: 'SIEGE', available: false },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{ battle_type: string; available: boolean }>();
    expect(updated.battle_type).toBe('SIEGE');
    expect(updated.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. GET /api/maps?battle_type= — filter (available only)
// ---------------------------------------------------------------------------

describe('GET /api/maps — battle_type + availability filter', () => {
  it('returns only available SIEGE maps when ?battle_type=SIEGE', async () => {
    const siegeId = await createMap({ battleType: 'SIEGE' });
    const domId = await createMap({ battleType: 'DOMINATION' });
    const unavailableSiegeId = await createMap({ battleType: 'SIEGE', available: false });

    const res = await app.inject({ method: 'GET', url: '/api/maps?battle_type=SIEGE' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ data: { id: string }[] }>().data.map((m) => m.id);
    expect(ids).toContain(siegeId);
    expect(ids).not.toContain(domId);
    expect(ids).not.toContain(unavailableSiegeId);
  });

  it('returns all available maps (no filter) when battle_type is omitted', async () => {
    const siegeId = await createMap({ battleType: 'SIEGE' });
    const domId = await createMap({ battleType: 'DOMINATION' });

    const res = await app.inject({ method: 'GET', url: '/api/maps' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ data: { id: string }[] }>().data.map((m) => m.id);
    expect(ids).toContain(siegeId);
    expect(ids).toContain(domId);
  });

  it('ignores an invalid battle_type value and returns all available maps', async () => {
    const someId = await createMap({ battleType: 'DOMINATION' });
    const res = await app.inject({ method: 'GET', url: '/api/maps?battle_type=INVALID' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ data: { id: string }[] }>().data.map((m) => m.id);
    expect(ids).toContain(someId);
  });
});
