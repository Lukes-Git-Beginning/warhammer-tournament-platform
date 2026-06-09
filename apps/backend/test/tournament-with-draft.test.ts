/**
 * Integration tests for M4.8 — Tournament creation with draft configuration.
 *
 * Covers:
 *  1. POST /api/tournaments with draft_enabled=true and valid preset → 201
 *  2. POST /api/tournaments with draft_enabled=true and draft_preset_id=null → 422
 *  3. POST /api/tournaments with draft_enabled=true and non-existing preset → 422
 *  4. POST /api/tournaments with draft_enabled=false → 201, draft_preset_id ignored
 *  5. PATCH /api/tournaments/:slug with draft_enabled=true and valid preset → 200
 *  6. PATCH /api/tournaments/:slug with draft_enabled=true and null preset → 422
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import type { DraftTurn } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Deterministic UUIDs — prefix c7400000 to avoid collisions
// ---------------------------------------------------------------------------

const ADMIN_ID   = 'c7400000-0000-0000-0000-000000000001';
const PRESET_ID  = 'c7410000-0000-0000-0000-000000000001';
const MISSING_PRESET_ID = 'c7410000-0000-0000-0000-999999999999';

const SIMPLE_TURNS: DraftTurn[] = [
  { order: 0, actor: 'host',  action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 1, actor: 'guest', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
];

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

async function cleanupAll() {
  await prisma.tournament.deleteMany({ where: { organizer_id: ADMIN_ID } });
  await prisma.draftPreset.deleteMany({ where: { id: PRESET_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
}

beforeEach(async () => {
  await cleanupAll();

  // Seed admin user
  await prisma.user.create({
    data: { id: ADMIN_ID, discord_id: 'c74_admin', username: 'C74Admin', email: null, role: 'ADMIN' },
  });

  // Seed preset (public)
  await prisma.draftPreset.create({
    data: {
      id: PRESET_ID,
      name: 'C74 Test Preset',
      created_by: ADMIN_ID,
      is_public: true,
      turns: SIMPLE_TURNS,
      category_limits: [],
      turn_seconds: 30,
    },
  });
});

afterEach(async () => {
  await cleanupAll();
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Draft Tournament',
    format: 'SINGLE_ELIMINATION',
    start_date: '2026-08-01T10:00:00.000Z',
    timezone: 'Europe/Berlin',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/tournaments — draft fields', () => {
  it('1. draft_enabled=true with valid preset → 201', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: baseBody({
        draft_enabled: true,
        draft_preset_id: PRESET_ID,
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; slug: string }>();
    expect(body.id).toBeTruthy();

    // Verify DB has draft_preset_id
    const tournament = await prisma.tournament.findUnique({
      where: { id: body.id },
      select: { draft_enabled: true, draft_preset_id: true },
    });
    expect(tournament?.draft_enabled).toBe(true);
    expect(tournament?.draft_preset_id).toBe(PRESET_ID);
  });

  it('2. draft_enabled=true with draft_preset_id=null → 422', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: baseBody({
        draft_enabled: true,
        draft_preset_id: null,
      }),
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('preset_id');
  });

  it('3. draft_enabled=true with non-existing preset → 422', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: baseBody({
        draft_enabled: true,
        draft_preset_id: MISSING_PRESET_ID,
      }),
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('Preset not found');
  });

  it('4. draft_enabled=false (default) → 201, draft_preset_id null', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: baseBody(),
    });

    expect(res.statusCode).toBe(201);
  });
});

describe('PATCH /api/tournaments/:slug — draft fields', () => {
  async function createTournament(draftEnabled = false): Promise<{ slug: string }> {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: baseBody({
        name: 'C74 Patch Test Tournament',
        draft_enabled: draftEnabled,
        ...(draftEnabled ? { draft_preset_id: PRESET_ID } : {}),
      }),
    });
    return res.json<{ slug: string }>();
  }

  it('5. PATCH with draft_enabled=true and valid preset → 200', async () => {
    const { slug } = await createTournament(false);
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      cookies: { auth_token: token },
      payload: { draft_enabled: true, draft_preset_id: PRESET_ID },
    });

    expect(res.statusCode).toBe(200);
  });

  it('6. PATCH with draft_enabled=true and draft_preset_id=null → 422', async () => {
    const { slug } = await createTournament(false);
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${slug}`,
      cookies: { auth_token: token },
      payload: { draft_enabled: true, draft_preset_id: null },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('preset_id');
  });
});
