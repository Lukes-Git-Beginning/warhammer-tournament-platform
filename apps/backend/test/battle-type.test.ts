/**
 * Integration tests for battle_type support on Tournament + Map.
 *
 * Covers:
 *  1. POST /api/tournaments with battle_type:'SIEGE' persists the value and
 *     returns it in the create response.
 *  2. GET /api/tournaments/:slug includes battle_type in the response.
 *  3. Map pool validation on CREATE: a map not valid for the tournament's
 *     battle type is rejected with 422.
 *  4. Map pool validation on PATCH: same guard with the effective battle type
 *     (patched value wins if provided, otherwise the existing one is used).
 *  5. GET /api/admin/maps — POST /api/admin/maps persists battle_types and
 *     PATCH /api/admin/maps/:id updates them.
 *  6. GET /api/maps?battle_type=SIEGE returns only SIEGE-valid maps.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const ADMIN_ID = 'ba000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

const createdMapIds: string[] = [];
const createdTournamentIds: string[] = [];

async function cleanup() {
  if (createdTournamentIds.length > 0) {
    await prisma.tournamentMapPool.deleteMany({
      where: { tournament_id: { in: createdTournamentIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_id: { in: createdTournamentIds } },
    });
    await prisma.tournament.deleteMany({
      where: { id: { in: createdTournamentIds } },
    });
    createdTournamentIds.length = 0;
  }
  if (createdMapIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity_type: 'Map', entity_id: { in: createdMapIds } },
    });
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function adminCookie() {
  const token = app.jwt.sign({ sub: ADMIN_ID, username: 'BTAdmin', role: 'ADMIN' });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function createMap(opts: { battleTypes?: string[]; suffix?: string }) {
  const id = randomUUID();
  const slug = `bt-map-${id.slice(0, 8)}${opts.suffix ?? ''}`;
  await prisma.map.create({
    data: {
      id,
      slug,
      name: `BT Test Map ${id.slice(0, 8)}`,
      battle_types: (opts.battleTypes as ('DOMINATION' | 'CONQUEST' | 'SIEGE')[]) ?? ['DOMINATION'],
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
// 1. POST /api/tournaments — battle_type persists + appears in response
// ---------------------------------------------------------------------------

describe('POST /api/tournaments — battle_type', () => {
  it('persists battle_type:SIEGE and returns it in the 201 response', async () => {
    const res = await createTournamentViaHttp({ battle_type: 'SIEGE' });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ battle_type: string }>();
    expect(body.battle_type).toBe('SIEGE');
  });

  it('defaults battle_type to DOMINATION when omitted', async () => {
    const res = await createTournamentViaHttp({});
    expect(res.statusCode).toBe(201);
    const body = res.json<{ battle_type: string }>();
    expect(body.battle_type).toBe('DOMINATION');
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

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${slug}`,
      headers: { cookie: adminCookie() },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<{ battle_type: string }>().battle_type).toBe('CONQUEST');
  });
});

// ---------------------------------------------------------------------------
// 3. Map pool validation on CREATE — invalid battle type rejected
// ---------------------------------------------------------------------------

describe('POST /api/tournaments — map pool filtered by battle type', () => {
  it('accepts maps valid for the tournament battle type', async () => {
    const [m1, m2, m3] = await Promise.all([
      createMap({ battleTypes: ['SIEGE'] }),
      createMap({ battleTypes: ['SIEGE'] }),
      createMap({ battleTypes: ['SIEGE'] }),
    ]);
    const res = await createTournamentViaHttp({
      battle_type: 'SIEGE',
      map_pool: [m1, m2, m3],
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a map not valid for the tournament battle type (422)', async () => {
    const [m1, m2] = await Promise.all([
      createMap({ battleTypes: ['SIEGE'] }),
      createMap({ battleTypes: ['SIEGE'] }),
    ]);
    const dominationOnlyId = await createMap({ battleTypes: ['DOMINATION'] });
    // two SIEGE maps + one DOMINATION-only map in a SIEGE tournament
    const res = await createTournamentViaHttp({
      battle_type: 'SIEGE',
      map_pool: [m1, m2, dominationOnlyId],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/battle type SIEGE/i);
  });

  it('defaults to DOMINATION filter when battle_type is omitted', async () => {
    const [m1, m2] = await Promise.all([
      createMap({ battleTypes: ['DOMINATION'] }),
      createMap({ battleTypes: ['DOMINATION'] }),
    ]);
    const siegeOnlyId = await createMap({ battleTypes: ['SIEGE'] });
    // No battle_type → effective is DOMINATION; SIEGE-only map should be rejected
    const res = await createTournamentViaHttp({
      map_pool: [m1, m2, siegeOnlyId],
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/battle type DOMINATION/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Map pool validation on PATCH — effective battle type logic
// ---------------------------------------------------------------------------

describe('PATCH /api/tournaments/:slug — map pool filtered by effective battle type', () => {
  it('uses the patched battle_type when both are changed together', async () => {
    // Create a DOMINATION tournament in DRAFT
    const createRes = await createTournamentViaHttp({ battle_type: 'DOMINATION' });
    expect(createRes.statusCode).toBe(201);
    const { slug } = createRes.json<{ slug: string }>();

    const [sm1, sm2, sm3] = await Promise.all([
      createMap({ battleTypes: ['SIEGE'] }),
      createMap({ battleTypes: ['SIEGE'] }),
      createMap({ battleTypes: ['SIEGE'] }),
    ]);

    // Patch: change battle_type to SIEGE + set a SIEGE map pool
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      headers: { cookie: adminCookie() },
      payload: {
        battle_type: 'SIEGE',
        map_pool: [sm1, sm2, sm3],
      },
    });
    // DRAFT → battle_type change is allowed; maps are valid for SIEGE
    expect(patchRes.statusCode).toBe(200);
  });

  it('rejects a map that is not valid for the existing battle type when battle_type is not being patched', async () => {
    // Create a DOMINATION tournament in DRAFT
    const createRes = await createTournamentViaHttp({ battle_type: 'DOMINATION' });
    expect(createRes.statusCode).toBe(201);
    const { slug } = createRes.json<{ slug: string }>();

    const [m1, m2] = await Promise.all([
      createMap({ battleTypes: ['DOMINATION'] }),
      createMap({ battleTypes: ['DOMINATION'] }),
    ]);
    const siegeOnlyId = await createMap({ battleTypes: ['SIEGE'] });

    // Patch: only change map_pool (no battle_type change) — effective type = DOMINATION
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      headers: { cookie: adminCookie() },
      payload: {
        map_pool: [m1, m2, siegeOnlyId],
      },
    });
    expect(patchRes.statusCode).toBe(422);
    const body = patchRes.json<{ message: string }>();
    expect(body.message).toMatch(/battle type DOMINATION/i);
  });
});

// ---------------------------------------------------------------------------
// 5. POST /api/admin/maps — battle_types persisted; PATCH updates them
// ---------------------------------------------------------------------------

describe('Admin map CRUD — battle_types', () => {
  it('POST /api/admin/maps persists battle_types', async () => {
    const slug = `bt-adm-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/maps',
      headers: { cookie: adminCookie() },
      payload: { name: 'Siege Test Map', slug, battle_types: ['SIEGE', 'CONQUEST'] },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; battle_types: string[] }>();
    createdMapIds.push(created.id);
    expect(created.battle_types).toEqual(expect.arrayContaining(['SIEGE', 'CONQUEST']));
    expect(created.battle_types).toHaveLength(2);
  });

  it('POST /api/admin/maps defaults battle_types to [DOMINATION] when omitted', async () => {
    const slug = `bt-adm-dom-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/maps',
      headers: { cookie: adminCookie() },
      payload: { name: 'Default BT Map', slug },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; battle_types: string[] }>();
    createdMapIds.push(created.id);
    expect(created.battle_types).toEqual(['DOMINATION']);
  });

  it('PATCH /api/admin/maps/:id updates battle_types', async () => {
    const id = await createMap({ battleTypes: ['DOMINATION'] });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/maps/${id}`,
      headers: { cookie: adminCookie() },
      payload: { battle_types: ['DOMINATION', 'SIEGE'] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{ battle_types: string[] }>();
    expect(updated.battle_types).toEqual(expect.arrayContaining(['DOMINATION', 'SIEGE']));
  });
});

// ---------------------------------------------------------------------------
// 6. GET /api/maps?battle_type= — filter
// ---------------------------------------------------------------------------

describe('GET /api/maps — battle_type filter', () => {
  it('returns only maps valid for SIEGE when ?battle_type=SIEGE', async () => {
    const siegeId = await createMap({ battleTypes: ['SIEGE'] });
    const domId = await createMap({ battleTypes: ['DOMINATION'] });
    const bothId = await createMap({ battleTypes: ['SIEGE', 'DOMINATION'] });

    const res = await app.inject({ method: 'GET', url: '/api/maps?battle_type=SIEGE' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string }[] }>();
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain(siegeId);
    expect(ids).toContain(bothId);
    expect(ids).not.toContain(domId);
  });

  it('returns all maps (no filter) when battle_type is omitted', async () => {
    const siegeId = await createMap({ battleTypes: ['SIEGE'] });
    const domId = await createMap({ battleTypes: ['DOMINATION'] });

    const res = await app.inject({ method: 'GET', url: '/api/maps' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string }[] }>();
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain(siegeId);
    expect(ids).toContain(domId);
  });

  it('ignores an invalid battle_type value and returns all maps', async () => {
    const someId = await createMap({ battleTypes: ['DOMINATION'] });

    const res = await app.inject({ method: 'GET', url: '/api/maps?battle_type=INVALID' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string }[] }>();
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain(someId);
  });
});
