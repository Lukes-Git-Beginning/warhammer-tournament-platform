/**
 * Integration tests for PATCH /api/matches/:id/start and GET /api/matches/:id/draft (M4.4).
 *
 * Covers:
 *  1. USER → 403
 *  2. Organizer of different tournament → 403
 *  3. Non-PENDING match → 422
 *  4. Missing player → 422
 *  5. draft_enabled=false → 200, draft_id=null, match.status=ONGOING
 *  6. draft_enabled=true → 200, draft_id=<uuid>, Draft row created
 *  7. Idempotent: second PATCH returns same draftId
 *
 * Requires real Redis + PostgreSQL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import type { DraftTurn } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Deterministic UUIDs — hex-only prefix b8500000 to avoid collisions
// ---------------------------------------------------------------------------

const HOST_ID       = 'b8500000-0000-0000-0000-000000000001';
const GUEST_ID      = 'b8500000-0000-0000-0000-000000000002';
const ADMIN_ID      = 'b8500000-0000-0000-0000-000000000003';
const USER_ID       = 'b8500000-0000-0000-0000-000000000004';
const OTHER_ORG_ID  = 'b8500000-0000-0000-0000-000000000005'; // organizer of a different tournament

const PRESET_ID     = 'b8510000-0000-0000-0000-000000000001';

// Tournaments
const TOURN_NO_DRAFT   = 'b8520000-0000-0000-0000-000000000001'; // draft_enabled=false
const TOURN_WITH_DRAFT = 'b8520000-0000-0000-0000-000000000002'; // draft_enabled=true
const TOURN_OTHER      = 'b8520000-0000-0000-0000-000000000003'; // owned by OTHER_ORG_ID

// Matches
const MATCH_PENDING_NO_DRAFT   = 'b8530000-0000-0000-0000-000000000001';
const MATCH_PENDING_WITH_DRAFT = 'b8530000-0000-0000-0000-000000000002';
const MATCH_COMPLETED          = 'b8530000-0000-0000-0000-000000000003';
const MATCH_MISSING_PLAYER     = 'b8530000-0000-0000-0000-000000000004';
const MATCH_OTHER_TOURN        = 'b8530000-0000-0000-0000-000000000005';

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
// Cleanup + seed helpers
// ---------------------------------------------------------------------------

const ALL_MATCH_IDS = [
  MATCH_PENDING_NO_DRAFT,
  MATCH_PENDING_WITH_DRAFT,
  MATCH_COMPLETED,
  MATCH_MISSING_PLAYER,
  MATCH_OTHER_TOURN,
];

const ALL_TOURN_IDS = [TOURN_NO_DRAFT, TOURN_WITH_DRAFT, TOURN_OTHER];

async function cleanupAll() {
  // Delete in dependency order
  await prisma.draftEvent.deleteMany({
    where: { draft_id: { in: await getDraftIds() } },
  });
  await prisma.draft.deleteMany({ where: { match_id: { in: ALL_MATCH_IDS } } });
  await prisma.draftPreset.deleteMany({ where: { id: PRESET_ID } });
  await prisma.match.deleteMany({ where: { id: { in: ALL_MATCH_IDS } } });
  await prisma.tournament.deleteMany({ where: { id: { in: ALL_TOURN_IDS } } });
  await prisma.user.deleteMany({
    where: { id: { in: [HOST_ID, GUEST_ID, ADMIN_ID, USER_ID, OTHER_ORG_ID] } },
  });

  // Clean up Redis
  const redis = app.redis;
  const members = await redis.smembers('draft:active');
  for (const id of members) {
    const d = await prisma.draft.findUnique({ where: { id }, select: { match_id: true } });
    if (d?.match_id && ALL_MATCH_IDS.includes(d.match_id)) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
}

async function getDraftIds(): Promise<string[]> {
  const drafts = await prisma.draft.findMany({
    where: { match_id: { in: ALL_MATCH_IDS } },
    select: { id: true },
  });
  return drafts.map((d) => d.id);
}

beforeEach(async () => {
  await cleanupAll();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: HOST_ID,      discord_id: 'b85_host',      username: 'B85Host',     email: null },
      { id: GUEST_ID,     discord_id: 'b85_guest',     username: 'B85Guest',    email: null },
      { id: ADMIN_ID,     discord_id: 'b85_admin',     username: 'B85Admin',    email: null, role: 'ADMIN' },
      { id: USER_ID,      discord_id: 'b85_user',      username: 'B85User',     email: null, role: 'USER' },
      { id: OTHER_ORG_ID, discord_id: 'b85_other_org', username: 'B85OtherOrg', email: null, role: 'ORGANIZER' },
    ],
    skipDuplicates: true,
  });

  // Seed preset
  await prisma.draftPreset.create({
    data: {
      id: PRESET_ID,
      name: 'B85 Test Preset',
      created_by: ADMIN_ID,
      is_public: true,
      turns: SIMPLE_TURNS,
      category_limits: [],
      turn_seconds: 30,
    },
  });

  // Seed tournaments
  await prisma.tournament.createMany({
    data: [
      {
        id: TOURN_NO_DRAFT,
        slug: 'b85-no-draft-tournament',
        name: 'B85 No Draft Tournament',
        format: 'SINGLE_ELIMINATION',
        status: 'ONGOING',
        organizer_id: ADMIN_ID,
        timezone: 'Europe/Berlin',
        start_date: new Date('2026-06-01'),
        draft_enabled: false,
        draft_preset_id: null,
      },
      {
        id: TOURN_WITH_DRAFT,
        slug: 'b85-draft-tournament',
        name: 'B85 Draft Tournament',
        format: 'SINGLE_ELIMINATION',
        status: 'ONGOING',
        organizer_id: ADMIN_ID,
        timezone: 'Europe/Berlin',
        start_date: new Date('2026-06-01'),
        draft_enabled: true,
        draft_preset_id: PRESET_ID,
      },
      {
        id: TOURN_OTHER,
        slug: 'b85-other-tournament',
        name: 'B85 Other Tournament',
        format: 'SINGLE_ELIMINATION',
        status: 'ONGOING',
        organizer_id: OTHER_ORG_ID,
        timezone: 'Europe/Berlin',
        start_date: new Date('2026-06-01'),
        draft_enabled: false,
      },
    ],
  });

  // Seed matches
  await prisma.match.createMany({
    data: [
      {
        id: MATCH_PENDING_NO_DRAFT,
        tournament_id: TOURN_NO_DRAFT,
        round: 1,
        match_number: 1,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'PENDING',
      },
      {
        id: MATCH_PENDING_WITH_DRAFT,
        tournament_id: TOURN_WITH_DRAFT,
        round: 1,
        match_number: 1,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'PENDING',
      },
      {
        id: MATCH_COMPLETED,
        tournament_id: TOURN_NO_DRAFT,
        round: 1,
        match_number: 2,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'COMPLETED',
      },
      {
        id: MATCH_MISSING_PLAYER,
        tournament_id: TOURN_NO_DRAFT,
        round: 1,
        match_number: 3,
        player1_id: HOST_ID,
        player2_id: null,
        status: 'PENDING',
      },
      {
        id: MATCH_OTHER_TOURN,
        tournament_id: TOURN_OTHER,
        round: 1,
        match_number: 1,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'PENDING',
      },
    ],
  });
});

afterEach(async () => {
  app.draftService.shutdown();
  // Clean up Redis draft entries created during test
  const redis = app.redis;
  const members = await redis.smembers('draft:active');
  for (const id of members) {
    const d = await prisma.draft.findUnique({ where: { id }, select: { match_id: true } });
    if (d?.match_id && ALL_MATCH_IDS.includes(d.match_id)) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/matches/:id/start', () => {
  it('1. USER → 403', async () => {
    const token = makeToken(USER_ID, 'USER');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_NO_DRAFT}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(403);
  });

  it('2. Organizer of a different tournament → 403', async () => {
    // OTHER_ORG_ID is organizer of TOURN_OTHER, not TOURN_NO_DRAFT
    const token = makeToken(OTHER_ORG_ID, 'ORGANIZER');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_NO_DRAFT}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(403);
  });

  it('3. Non-PENDING match (COMPLETED) → 422', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_COMPLETED}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('COMPLETED');
  });

  it('4. Match with missing player2 → 422', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_MISSING_PLAYER}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('both players');
  });

  it('5. draft_enabled=false → 200, draft_id=null, match.status=ONGOING', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_NO_DRAFT}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ match_id: string; status: string; draft_id: string | null }>();
    expect(body.match_id).toBe(MATCH_PENDING_NO_DRAFT);
    expect(body.status).toBe('ONGOING');
    expect(body.draft_id).toBeNull();

    // Verify DB
    const match = await prisma.match.findUnique({ where: { id: MATCH_PENDING_NO_DRAFT } });
    expect(match?.status).toBe('ONGOING');
  });

  it('6. draft_enabled=true → 200, draft_id=uuid, Draft row created', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_WITH_DRAFT}/start`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ match_id: string; status: string; draft_id: string | null }>();
    expect(body.match_id).toBe(MATCH_PENDING_WITH_DRAFT);
    expect(body.status).toBe('ONGOING');
    expect(body.draft_id).toBeTruthy();
    expect(typeof body.draft_id).toBe('string');

    // Verify Draft row in DB
    const draft = await prisma.draft.findUnique({ where: { id: body.draft_id! } });
    expect(draft).not.toBeNull();
    expect(draft?.match_id).toBe(MATCH_PENDING_WITH_DRAFT);
    expect(draft?.status).toBe('ONGOING');
    expect(draft?.host_user_id).toBe(HOST_ID);
    expect(draft?.guest_user_id).toBe(GUEST_ID);

    app.draftService.shutdown();
  });

  it('7. Idempotent: second PATCH returns same draftId', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res1 = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_WITH_DRAFT}/start`,
      cookies: { auth_token: token },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json<{ draft_id: string | null }>();
    const firstDraftId = body1.draft_id;
    expect(firstDraftId).toBeTruthy();

    app.draftService.shutdown();

    // Second call — match is already ONGOING
    const res2 = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_WITH_DRAFT}/start`,
      cookies: { auth_token: token },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json<{ draft_id: string | null }>();
    expect(body2.draft_id).toBe(firstDraftId);

    // Only one Draft row exists
    const draftCount = await prisma.draft.count({ where: { match_id: MATCH_PENDING_WITH_DRAFT } });
    expect(draftCount).toBe(1);
  });
});

describe('GET /api/matches/:id/draft', () => {
  it('returns draft_id=null when no draft exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${MATCH_PENDING_NO_DRAFT}/draft`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ draft_id: string | null; status: string | null }>();
    expect(body.draft_id).toBeNull();
    expect(body.status).toBeNull();
  });

  it('returns draft info after match start', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    // Start match with draft
    const startRes = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${MATCH_PENDING_WITH_DRAFT}/start`,
      cookies: { auth_token: token },
    });
    expect(startRes.statusCode).toBe(200);
    const { draft_id } = startRes.json<{ draft_id: string }>();

    app.draftService.shutdown();

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${MATCH_PENDING_WITH_DRAFT}/draft`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ draft_id: string | null; status: string | null }>();
    expect(body.draft_id).toBe(draft_id);
    expect(body.status).toBe('ONGOING');
  });

  it('returns 404 for non-existent match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/matches/00000000-0000-0000-0000-999999999997/draft',
    });

    expect(res.statusCode).toBe(404);
  });
});
