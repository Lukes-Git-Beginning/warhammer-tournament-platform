/**
 * Integration tests for DraftPreset CRUD endpoints (M4.3).
 *
 * Covers the full auth-matrix: anonymous, USER, ORGANIZER, creator, ADMIN,
 * semantic validations (duplicate turn orders, unknown category, tournament-ref).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

const USER_ID      = 'dc000000-0000-0000-0000-000000000001';
const ORGANIZER_ID = 'dc000000-0000-0000-0000-000000000002';
const ADMIN_ID     = 'dc000000-0000-0000-0000-000000000003';
const OTHER_ID     = 'dc000000-0000-0000-0000-000000000004'; // another organizer, non-creator

// Preset IDs we create during tests (cleaned up each run)
const PRESET_A = 'dc100000-0000-0000-0000-000000000001';
const PRESET_B = 'dc100000-0000-0000-0000-000000000002';
const PRESET_C = 'dc100000-0000-0000-0000-000000000003';

// Tournament ID for reference-check test
const TOURNAMENT_ID = 'dc200000-0000-0000-0000-000000000001';

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
// Cleanup + seed users
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Cleanup order must respect FK constraints:
  // 0. Audit-logs do not cascade — clean up entries scoped to our test presets/users
  //    so leftover rows from previous failed runs cannot poison findFirst() queries.
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entity_type: 'DraftPreset', entity_id: { in: [PRESET_A, PRESET_B, PRESET_C] } },
        { actor_id: { in: [USER_ID, ORGANIZER_ID, ADMIN_ID, OTHER_ID] } },
      ],
    },
  });
  // 1. Remove tournament referencing preset
  await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
  // 2. Remove test presets (the two seed presets from seed.ts survive — they have different IDs)
  await prisma.draftPreset.deleteMany({
    where: { id: { in: [PRESET_A, PRESET_B, PRESET_C] } },
  });
  // Also clean up any presets created by test users that are not in the fixed list
  // (e.g., created via POST endpoint — their IDs are dynamic)
  await prisma.draftPreset.deleteMany({
    where: { created_by: { in: [USER_ID, ORGANIZER_ID, ADMIN_ID, OTHER_ID] } },
  });
  // 3. Remove test users then recreate
  await prisma.user.deleteMany({
    where: { id: { in: [USER_ID, ORGANIZER_ID, ADMIN_ID, OTHER_ID] } },
  });
  await prisma.user.createMany({
    data: [
      { id: USER_ID,      discord_id: 'dp_user',  username: 'DPUser',  email: null, role: 'USER' },
      { id: ORGANIZER_ID, discord_id: 'dp_orga',  username: 'DPOrga',  email: null, role: 'ORGANIZER' },
      { id: ADMIN_ID,     discord_id: 'dp_admin', username: 'DPAdmin', email: null, role: 'ADMIN' },
      { id: OTHER_ID,     discord_id: 'dp_other', username: 'DPOther', email: null, role: 'ORGANIZER' },
    ],
    skipDuplicates: true,
  });
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function cookieFor(id: string, role: string) {
  const token = app.jwt.sign({ sub: id, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

// ---------------------------------------------------------------------------
// Minimal valid preset body
// ---------------------------------------------------------------------------

const VALID_PRESET_BODY = {
  name: 'Test Preset',
  description: 'A test preset',
  is_public: true,
  category_limits: [],
  turns: [
    { order: 1, actor: 'host', action: 'ban', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    { order: 2, actor: 'guest', action: 'ban', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    { order: 3, actor: 'host', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    { order: 4, actor: 'guest', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  ],
  turn_seconds: 30,
};

// ---------------------------------------------------------------------------
// Test 1: GET list (anonymous) — only is_public=true presets
// ---------------------------------------------------------------------------

describe('GET /api/draft-presets (anonymous)', () => {
  it('returns only public presets — seed presets "Standard 1v1" and "Captain\'s Mode Classic" are visible', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/draft-presets' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ presets: { name: string; is_public: boolean }[] }>();
    expect(Array.isArray(body.presets)).toBe(true);
    // All returned presets must be public
    for (const p of body.presets) {
      expect(p.is_public).toBe(true);
    }
    const names = body.presets.map((p) => p.name);
    expect(names).toContain('Standard 1v1');
    expect(names).toContain("Captain's Mode Classic");
  });
});

// ---------------------------------------------------------------------------
// Test 2: GET list (authenticated USER) — public + own private
// ---------------------------------------------------------------------------

describe('GET /api/draft-presets (authenticated)', () => {
  it('returns public presets + own private presets for authenticated user', async () => {
    // Create a private preset owned by ORGANIZER_ID
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Private Preset',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    // Fetch as ORGANIZER — should see their private + all public
    const res = await app.inject({
      method: 'GET',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ presets: { id: string; name: string }[] }>();
    const ids = body.presets.map((p) => p.id);
    expect(ids).toContain(PRESET_A);

    // Fetch as OTHER_ID — should NOT see ORGANIZER's private preset
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(OTHER_ID, 'ORGANIZER') },
    });
    const body2 = res2.json<{ presets: { id: string }[] }>();
    const ids2 = body2.presets.map((p) => p.id);
    expect(ids2).not.toContain(PRESET_A);
  });
});

// ---------------------------------------------------------------------------
// Test 3: GET :id (is_public=true) — accessible without auth
// ---------------------------------------------------------------------------

describe('GET /api/draft-presets/:id', () => {
  it('returns a public preset without authentication', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_B,
        name: 'Public Detail Test',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/draft-presets/${PRESET_B}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; is_public: boolean }>();
    expect(body.id).toBe(PRESET_B);
    expect(body.is_public).toBe(true);
  });

  // Test 4: GET :id (is_public=false, non-creator) → 404
  it('returns 404 for private preset accessed by non-creator', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_C,
        name: 'Private Only',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    // OTHER_ID is authenticated but not the creator
    const res = await app.inject({
      method: 'GET',
      url: `/api/draft-presets/${PRESET_C}`,
      headers: { cookie: cookieFor(OTHER_ID, 'ORGANIZER') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 for private preset accessed anonymously', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_C,
        name: 'Private Only Anon',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/draft-presets/${PRESET_C}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test 5: POST (USER role) → 403
// ---------------------------------------------------------------------------

describe('POST /api/draft-presets', () => {
  it('returns 403 when USER role tries to create a preset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(USER_ID, 'USER') },
      payload: VALID_PRESET_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  // Test 6: POST (ORGANIZER role) → 201 + persisted preset
  it('ORGANIZER creates preset → 201 with full DTO', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
      payload: VALID_PRESET_BODY,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; name: string; created_by: string; turns: unknown[] }>();
    expect(body.name).toBe(VALID_PRESET_BODY.name);
    expect(body.created_by).toBe(ORGANIZER_ID);
    expect(body.turns).toHaveLength(4);
    expect(typeof body.id).toBe('string');

    // Verify persistence
    const inDb = await prisma.draftPreset.findUnique({ where: { id: body.id } });
    expect(inDb).not.toBeNull();
    expect(inDb?.name).toBe(VALID_PRESET_BODY.name);
  });

  // Test 7: POST with invalid turns (order not unique) → 422
  it('returns 422 when turn orders are not unique', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
      payload: {
        ...VALID_PRESET_BODY,
        turns: [
          { order: 1, actor: 'host', action: 'ban', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
          { order: 1, actor: 'guest', action: 'ban', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('UnprocessableEntity');
    expect(body.message).toMatch(/unique/i);
  });

  // Test 8: POST with unknown category in turn → 422
  it('returns 422 when turn references unknown category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/draft-presets',
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
      payload: {
        ...VALID_PRESET_BODY,
        category_limits: [], // no custom categories defined
        turns: [
          { order: 1, actor: 'host', action: 'ban', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'nonexistent_category' },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('UnprocessableEntity');
    expect(body.message).toMatch(/category/i);
  });
});

// ---------------------------------------------------------------------------
// Test 9: PUT (non-creator, non-admin) → 403
// ---------------------------------------------------------------------------

describe('PUT /api/draft-presets/:id', () => {
  it('returns 403 when non-creator tries to update', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Creator Preset',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(OTHER_ID, 'ORGANIZER') },
      payload: { name: 'Changed by intruder' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creator can update their own preset', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Creator Preset',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
      payload: { name: 'Updated Name', turn_seconds: 45 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string; turn_seconds: number }>();
    expect(body.name).toBe('Updated Name');
    expect(body.turn_seconds).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// Test 10: DELETE (creator) → 204
// ---------------------------------------------------------------------------

describe('DELETE /api/draft-presets/:id', () => {
  it('creator can delete their preset → 204', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'To Be Deleted',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
    });
    expect(res.statusCode).toBe(204);

    // Verify actually deleted
    const inDb = await prisma.draftPreset.findUnique({ where: { id: PRESET_A } });
    expect(inDb).toBeNull();
  });

  it('non-creator non-admin gets 403 on delete', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Protected Preset',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(OTHER_ID, 'ORGANIZER') },
    });
    expect(res.statusCode).toBe(403);
  });

  // Test 11: DELETE when preset is referenced by Tournament → 422
  it('returns 422 when preset is referenced by a tournament', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Referenced Preset',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    // Create a tournament that references this preset
    await prisma.tournament.create({
      data: {
        id: TOURNAMENT_ID,
        slug: `dp-ref-test-${Date.now()}`,
        name: 'Draft Ref Tournament',
        format: 'SINGLE_ELIMINATION',
        status: 'DRAFT',
        start_date: new Date('2027-01-01'),
        timezone: 'UTC',
        organizer_id: ORGANIZER_ID,
        draft_preset_id: PRESET_A,
        draft_enabled: true,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'ORGANIZER') },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('UnprocessableEntity');
    expect(body.message).toMatch(/in use/i);
  });
});

// ---------------------------------------------------------------------------
// ADMIN override tests
// ---------------------------------------------------------------------------

describe('ADMIN override', () => {
  it('ADMIN can update any preset regardless of creator', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Admin Override Test',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(ADMIN_ID, 'ADMIN') },
      payload: { name: 'Admin Updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string }>();
    expect(body.name).toBe('Admin Updated');
  });

  it('ADMIN can delete any preset', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Admin Delete Test',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: true,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/draft-presets/${PRESET_A}`,
      headers: { cookie: cookieFor(ADMIN_ID, 'ADMIN') },
    });
    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/draft-presets/:id/promote
// ---------------------------------------------------------------------------

describe('PATCH /api/draft-presets/:id/promote', () => {
  it('ADMIN promotes private preset → 200 + is_public=true + AuditLog', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Private Preset to Promote',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/draft-presets/${PRESET_A}/promote`,
      headers: { cookie: cookieFor(ADMIN_ID, 'ADMIN') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; name: string; is_public: boolean }>();
    expect(body.id).toBe(PRESET_A);
    expect(body.is_public).toBe(true);

    // Verify in DB
    const inDb = await prisma.draftPreset.findUnique({ where: { id: PRESET_A } });
    expect(inDb?.is_public).toBe(true);

    // Verify AuditLog entry
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entity_type: 'DraftPreset', entity_id: PRESET_A, action: 'PROMOTE' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actor_id).toBe(ADMIN_ID);
  });

  it('USER role gets 403 on promote', async () => {
    await prisma.draftPreset.create({
      data: {
        id: PRESET_A,
        name: 'Preset to Guard',
        description: null,
        created_by: ORGANIZER_ID,
        is_public: false,
        category_limits: [],
        turns: VALID_PRESET_BODY.turns,
        turn_seconds: 30,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/draft-presets/${PRESET_A}/promote`,
      headers: { cookie: cookieFor(USER_ID, 'USER') },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST without auth → 401
// ---------------------------------------------------------------------------

describe('POST /api/draft-presets (unauthenticated)', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/draft-presets',
      payload: VALID_PRESET_BODY,
    });
    expect(res.statusCode).toBe(401);
  });
});
