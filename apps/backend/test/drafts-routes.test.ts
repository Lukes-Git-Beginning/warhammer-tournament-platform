/**
 * Integration tests for Draft REST endpoints (M4.4).
 *
 * Covers:
 *  - GET /api/drafts/:id (anonymous spectator, player, 404)
 *  - GET /api/drafts/:id/events (chronological events)
 *  - POST /api/drafts/:id/cancel (auth matrix: USER → 403, ADMIN → 200)
 *
 * Requires real Redis + PostgreSQL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';
import type { DraftTurn } from '@tww3/types';

// ---------------------------------------------------------------------------
// Deterministic UUIDs — hex-only prefix a4400000 to avoid collisions
// ---------------------------------------------------------------------------

const HOST_ID    = 'a4400000-0000-0000-0000-000000000001';
const GUEST_ID   = 'a4400000-0000-0000-0000-000000000002';
const ADMIN_ID   = 'a4400000-0000-0000-0000-000000000003';
const USER_ID    = 'a4400000-0000-0000-0000-000000000004';
const PRESET_ID  = 'a4410000-0000-0000-0000-000000000001';
const MATCH_ID   = 'a4420000-0000-0000-0000-000000000001';
const TOURN_ID   = 'a4430000-0000-0000-0000-000000000001';

const SIMPLE_TURNS: DraftTurn[] = [
  { order: 0, actor: 'host',  action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 1, actor: 'guest', action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 2, actor: 'host',  action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 3, actor: 'guest', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
];

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: true,
    withCron: false,
    withGraphql: false,
    withDraft: true,
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
  // Get draft IDs to clean up events first
  const drafts = await prisma.draft.findMany({
    where: { match_id: MATCH_ID },
    select: { id: true },
  });
  const draftIds = drafts.map((d) => d.id);

  if (draftIds.length > 0) {
    await prisma.draftEvent.deleteMany({ where: { draft_id: { in: draftIds } } });
  }
  await prisma.draft.deleteMany({ where: { match_id: MATCH_ID } });
  await prisma.draftPreset.deleteMany({ where: { id: PRESET_ID } });
  await prisma.match.deleteMany({ where: { id: MATCH_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURN_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, GUEST_ID, ADMIN_ID, USER_ID] } } });

  // Clean up Redis
  const redis = app.redis;
  const members = await redis.smembers('draft:active');
  for (const id of members) {
    const d = await prisma.draft.findUnique({ where: { id }, select: { match_id: true } });
    if (d?.match_id === MATCH_ID) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
}

beforeEach(async () => {
  await cleanupAll();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: HOST_ID,  discord_id: 'a44_host',  username: 'A44Host',  email: null },
      { id: GUEST_ID, discord_id: 'a44_guest', username: 'A44Guest', email: null },
      { id: ADMIN_ID, discord_id: 'a44_admin', username: 'A44Admin', email: null, role: 'ADMIN' },
      { id: USER_ID,  discord_id: 'a44_user',  username: 'A44User',  email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });

  // Seed tournament
  await prisma.tournament.create({
    data: {
      id: TOURN_ID,
      slug: 'a44-routes-tournament',
      name: 'A44 Routes Tournament',
      format: 'SINGLE_ELIMINATION',
      status: 'ONGOING',
      organizer_id: ADMIN_ID,
      timezone: 'Europe/Berlin',
      start_date: new Date('2026-06-01'),
    },
  });

  // Seed match
  await prisma.match.create({
    data: {
      id: MATCH_ID,
      tournament_id: TOURN_ID,
      round: 1,
      match_number: 1,
      player1_id: HOST_ID,
      player2_id: GUEST_ID,
      status: 'ONGOING',
    },
  });

  // Seed preset
  await prisma.draftPreset.create({
    data: {
      id: PRESET_ID,
      name: 'A44 Test Preset',
      created_by: ADMIN_ID,
      is_public: true,
      turns: SIMPLE_TURNS,
      category_limits: [],
      turn_seconds: 30,
    },
  });
});

afterEach(async () => {
  // Clean up Redis draft keys created during tests
  const redis = app.redis;
  const keys = await redis.keys('draft:*');
  const testKeys = keys.filter(k => k.includes(':state') || k.includes(':lock'));
  if (testKeys.length > 0) {
    // Only delete draft state keys where the draft was created for our test match
    // We can't easily filter by match — just delete all dr4-related active members
  }
  const members = await redis.smembers('draft:active');
  for (const id of members) {
    // Check if this is one of our test drafts by looking at DB
    const d = await prisma.draft.findUnique({ where: { id }, select: { match_id: true } });
    if (d?.match_id === MATCH_ID) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, discord_id: `disc_${id}`, username: 'test', role });
}

// ---------------------------------------------------------------------------
// Helper: start a draft and return draftId
// ---------------------------------------------------------------------------

async function startTestDraft(): Promise<string> {
  const result = await app.draftService.startDraft({
    matchId: MATCH_ID,
    presetId: PRESET_ID,
    hostUserId: HOST_ID,
    guestUserId: GUEST_ID,
    allFactionIds: [],
  });
  // Shut down timers immediately to avoid interference
  app.draftService.shutdown();
  return result.draftId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/drafts/:id', () => {
  it('anonymous → spectator view (viewer_role=spectator)', async () => {
    const draftId = await startTestDraft();

    const res = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ viewer_role: string; id: string }>();
    expect(body.viewer_role).toBe('spectator');
    expect(body.id).toBe(draftId);
  });

  it('authenticated as host → viewer_role=host', async () => {
    const draftId = await startTestDraft();
    const token = makeToken(HOST_ID, 'USER');

    const res = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ viewer_role: string }>();
    expect(body.viewer_role).toBe('host');
  });

  it('authenticated as guest → viewer_role=guest', async () => {
    const draftId = await startTestDraft();
    const token = makeToken(GUEST_ID, 'USER');

    const res = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ viewer_role: string }>();
    expect(body.viewer_role).toBe('guest');
  });

  it('returns 404 when draft not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/drafts/00000000-0000-0000-0000-999999999999',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NotFound');
  });
});

describe('GET /api/drafts/:id/events', () => {
  it('returns chronological events for a seeded draft', async () => {
    const draftId = await startTestDraft();

    const res = await app.inject({
      method: 'GET',
      url: `/api/drafts/${draftId}/events`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: Array<{ action: string; turn_index: number }> }>();
    expect(Array.isArray(body.events)).toBe(true);
    // At minimum the 'start' event should be present
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events[0]!.action).toBe('start');
    // Events are in ascending turn_index order
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i]!.turn_index).toBeGreaterThanOrEqual(body.events[i - 1]!.turn_index);
    }
  });

  it('returns 404 for non-existent draft', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/drafts/00000000-0000-0000-0000-999999999998/events',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/drafts/:id/cancel', () => {
  it('USER (non-organizer) → 403', async () => {
    const draftId = await startTestDraft();
    const token = makeToken(USER_ID, 'USER');

    const res = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(403);
  });

  it('ADMIN → 200, draft.status = CANCELLED', async () => {
    const draftId = await startTestDraft();
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; status: string }>();
    expect(body.id).toBe(draftId);
    expect(body.status).toBe('CANCELLED');

    // Verify DB
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft?.status).toBe('CANCELLED');
  });

  it('unauthenticated → 401', async () => {
    const draftId = await startTestDraft();

    const res = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('tournament organizer → 200', async () => {
    const draftId = await startTestDraft();
    // ADMIN_ID is the organizer of TOURN_ID — use ORGANIZER role JWT
    const token = makeToken(ADMIN_ID, 'ORGANIZER');

    const res = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('CANCELLED');
  });

  it('non-organizer ORGANIZER role → 403', async () => {
    const draftId = await startTestDraft();
    // USER_ID is not the organizer of this tournament
    const token = makeToken(USER_ID, 'ORGANIZER');

    const res = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(403);
  });
});
