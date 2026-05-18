/**
 * Integration tests for M4.9 — Draft Reconnect & Crash-Recovery.
 *
 * Covers:
 *  1. Redis-Miss-Rehydrate  — initActiveDrafts restores Redis state from DB
 *  2. Expired-Timer-Trigger — expired timer_expires_at triggers immediate forceAutoSelect
 *  3. Status-Sync-View      — getDraftView returns correctly masked DraftView per role
 *  4. Idempotent-Init       — calling initActiveDrafts twice schedules no duplicate timers
 *     and does not double-trigger auto-select
 *
 * Requirements:
 *  - Real Redis (REDIS_URL in .env)
 *  - Real PostgreSQL (DATABASE_URL in .env)
 *  - Factions seeded (pnpm --filter @rizzotto/db prisma db seed)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { DraftService } from '../src/lib/draft-service.js';
import type { DraftTurn } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Deterministic UUIDs (different from draft-service.test.ts to avoid conflicts)
// ---------------------------------------------------------------------------

const HOST_ID   = 'd4900000-0000-0000-0000-000000000001';
const GUEST_ID  = 'd4900000-0000-0000-0000-000000000002';
const ADMIN_ID  = 'd4900000-0000-0000-0000-000000000003';
const PRESET_ID = 'd4910000-0000-0000-0000-000000000001';
const MATCH_ID  = 'd4920000-0000-0000-0000-000000000001';
const TOURN_ID  = 'd4930000-0000-0000-0000-000000000001';

// Faction IDs from seed
const ALL_FACTIONS = [
  'empire', 'bretonnia', 'kislev', 'grand_cathay', 'dwarfs', 'high_elves', 'lizardmen',
  'greenskins', 'dark_elves', 'skaven', 'norsca', 'ogre_kingdoms', 'beastmen',
  'khorne', 'nurgle', 'tzeentch', 'slaanesh', 'daemons_of_chaos', 'warriors_of_chaos',
  'chaos_dwarfs', 'vampire_counts', 'vampire_coast', 'tomb_kings', 'wood_elves',
];

// Simple ban-ban-pick-pick preset used in most tests
const SIMPLE_TURNS: DraftTurn[] = [
  { order: 0, actor: 'host',  action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 1, actor: 'guest', action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 2, actor: 'host',  action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
  { order: 3, actor: 'guest', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
];

// ---------------------------------------------------------------------------
// App + service lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let redis: Redis;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: true,
    withCron: false,
    withGraphql: false,
    withDraft: true,
  });
  await app.ready();
  redis = app.redis;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// DB + Redis cleanup helpers
// ---------------------------------------------------------------------------

async function cleanupDraftData() {
  await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH_ID } } });
  await prisma.draft.deleteMany({ where: { match_id: MATCH_ID } });
  await prisma.draftPreset.deleteMany({ where: { id: PRESET_ID } });
  await prisma.match.deleteMany({ where: { id: MATCH_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURN_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, GUEST_ID, ADMIN_ID] } } });
}

async function cleanupRedis() {
  // Remove all stale draft keys from these test IDs
  const activeDraftIds = await redis.smembers('draft:active');
  for (const id of activeDraftIds) {
    if (id.startsWith('d490') || id.startsWith('d491') || id.startsWith('d492')) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
  const staleKeys = await redis.keys('draft:d49*');
  if (staleKeys.length > 0) await redis.del(...staleKeys);
}

beforeEach(async () => {
  await cleanupDraftData();
  await cleanupRedis();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: HOST_ID,  discord_id: 'disc_rc_host',  username: 'RcHost',  email: null },
      { id: GUEST_ID, discord_id: 'disc_rc_guest', username: 'RcGuest', email: null },
      { id: ADMIN_ID, discord_id: 'disc_rc_admin', username: 'RcAdmin', email: null, role: 'ADMIN' },
    ],
    skipDuplicates: true,
  });

  // Seed tournament
  await prisma.tournament.create({
    data: {
      id: TOURN_ID,
      slug: 'rc-test-tournament',
      name: 'Reconnect Test Tournament',
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
      name: 'RC Test Ban-Ban-Pick-Pick',
      created_by: ADMIN_ID,
      is_public: true,
      turns: SIMPLE_TURNS,
      category_limits: [],
      turn_seconds: 30,
    },
  });
});

afterEach(async () => {
  await cleanupRedis();
});

// ---------------------------------------------------------------------------
// Helper: create DraftService with a specific clock
// ---------------------------------------------------------------------------
function makeSvcWithClock(clockMs: number): DraftService {
  return new DraftService(prisma, redis, undefined, () => new Date(clockMs));
}

// ---------------------------------------------------------------------------
// Test 1: Redis-Miss-Rehydrate
// ---------------------------------------------------------------------------

describe('Redis-Miss-Rehydrate', () => {
  it('restores Redis state from DB after draft:state and draft:active keys are deleted', async () => {
    // Start a draft with the app-level service
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // Verify it's in Redis initially
    const hashBefore = await redis.hgetall(`draft:${draftId}:state`);
    expect(hashBefore.status).toBe('ONGOING');
    const activeBefore = await redis.sismember('draft:active', draftId);
    expect(activeBefore).toBe(1);

    // Simulate Redis FLUSHDB for this draft only
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);

    // Verify Redis is clean
    const hashAfterDel = await redis.hgetall(`draft:${draftId}:state`);
    expect(Object.keys(hashAfterDel)).toHaveLength(0);

    // Create a fresh service (simulates backend restart) and run initActiveDrafts
    const svc2 = new DraftService(prisma, redis, undefined);
    const count = await svc2.initActiveDrafts();
    svc2.shutdown();

    // Should have rehydrated at least this draft
    expect(count).toBeGreaterThanOrEqual(1);

    // Redis state should be restored
    const hashAfterInit = await redis.hgetall(`draft:${draftId}:state`);
    expect(hashAfterInit.status).toBe('ONGOING');
    expect(hashAfterInit.host_user_id).toBe(HOST_ID);
    expect(hashAfterInit.guest_user_id).toBe(GUEST_ID);
    expect(hashAfterInit.current_turn).toBe('0');

    // draft:active set should contain this draft again
    const activeAfterInit = await redis.sismember('draft:active', draftId);
    expect(activeAfterInit).toBe(1);

    // Cleanup
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('also restores draft:active when only draft:active Set was cleared but state key remains', async () => {
    // Start a draft
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // Only remove from draft:active set (state key stays intact)
    await redis.srem('draft:active', draftId);
    const activeAfterRemove = await redis.sismember('draft:active', draftId);
    expect(activeAfterRemove).toBe(0);

    // Fresh service runs init — state key is still there, but active set is missing
    const svc2 = new DraftService(prisma, redis, undefined);
    await svc2.initActiveDrafts();
    svc2.shutdown();

    // draft:active should be repopulated even though state key was still present
    const activeAfterInit = await redis.sismember('draft:active', draftId);
    expect(activeAfterInit).toBe(1);

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Expired-Timer-Trigger
// ---------------------------------------------------------------------------

describe('Expired-Timer-Trigger', () => {
  it('triggers forceAutoSelect immediately when timer_expires_at is in the past', async () => {
    // Start draft with a real service so it's in DB
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // Manually set timer_expires_at to epoch (already expired) in DB
    await prisma.draft.update({
      where: { id: draftId },
      data: { timer_expires_at: new Date(0) },
    });

    // Flush Redis so init reads from DB
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);

    // Fresh service init — sees expired timer, triggers forceAutoSelect
    const svc2 = new DraftService(prisma, redis, undefined);
    const count = await svc2.initActiveDrafts();
    expect(count).toBeGreaterThanOrEqual(1);

    // Wait for the async forceAutoSelect to complete
    // forceAutoSelect is called without await via void — give it a tick
    await new Promise((resolve) => setTimeout(resolve, 200));

    svc2.shutdown();

    // Draft should have advanced beyond turn 0
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft).not.toBeNull();
    expect(draft!.current_turn).toBeGreaterThan(0);

    // A DraftEvent with is_auto_selected=true should exist
    const autoEvents = await prisma.draftEvent.findMany({
      where: { draft_id: draftId, is_auto_selected: true },
    });
    expect(autoEvents.length).toBeGreaterThanOrEqual(1);

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Status-Sync-View (getDraftView masking correctness)
// ---------------------------------------------------------------------------

describe('Status-Sync-View', () => {
  it('getDraftView returns correct viewer_role and masked state per role', async () => {
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // host view
    const hostView = await svc.getDraftView(draftId, HOST_ID);
    expect(hostView.viewer_role).toBe('host');
    expect(hostView.id).toBe(draftId);
    expect(hostView.status).toBe('ONGOING');
    expect(hostView.timer_expires_at).not.toBeNull();
    expect(hostView.current_turn).toBe(0);

    // guest view
    const guestView = await svc.getDraftView(draftId, GUEST_ID);
    expect(guestView.viewer_role).toBe('guest');

    // spectator view (null userId)
    const specView = await svc.getDraftView(draftId, null);
    expect(specView.viewer_role).toBe('spectator');
    // Spectator should see empty hidden arrays
    expect(specView.state.hidden_picks.host).toHaveLength(0);
    expect(specView.state.hidden_picks.guest).toHaveLength(0);
    expect(specView.state.hidden_bans.host).toHaveLength(0);
    expect(specView.state.hidden_bans.guest).toHaveLength(0);

    // Unknown user (admin) → spectator
    const adminView = await svc.getDraftView(draftId, ADMIN_ID);
    expect(adminView.viewer_role).toBe('spectator');

    // After hidden pick: host sees own hidden, opponent replaced with '?'
    // Make a hidden-pick preset for deeper masking check
    const HIDDEN_PRESET_ID2 = 'd4910000-0000-0000-0000-000000000002';
    const MATCH_ID2 = 'd4920000-0000-0000-0000-000000000002';
    const hiddenTurns: DraftTurn[] = [
      { order: 0, actor: 'host',  action: 'pick', variant: 'global', is_hidden: true, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 1, actor: 'guest', action: 'pick', variant: 'global', is_hidden: true, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 2, actor: 'host',  action: 'reveal_picks', variant: null, is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    ];
    await prisma.draftPreset.create({
      data: {
        id: HIDDEN_PRESET_ID2,
        name: 'RC Hidden Masking Test',
        created_by: ADMIN_ID,
        is_public: true,
        turns: hiddenTurns,
        category_limits: [],
        turn_seconds: 30,
      },
    });
    await prisma.match.create({
      data: {
        id: MATCH_ID2,
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 2,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'ONGOING',
      },
    });

    const svc2 = new DraftService(prisma, redis, undefined);
    const { draftId: hiddenDraftId } = await svc2.startDraft({
      matchId: MATCH_ID2,
      presetId: HIDDEN_PRESET_ID2,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc2.shutdown();

    // Host makes hidden pick
    await svc2.handleAction(hiddenDraftId, HOST_ID, 'empire');
    // Guest makes hidden pick
    await svc2.handleAction(hiddenDraftId, GUEST_ID, 'khorne');

    // Host view: sees own hidden pick, guest's replaced with '?'
    const hostView2 = await svc2.getDraftView(hiddenDraftId, HOST_ID);
    expect(hostView2.state.hidden_picks.host).toContain('empire');
    expect(hostView2.state.hidden_picks.guest).toEqual(['?']); // masked

    // Guest view: sees own hidden pick, host's replaced with '?'
    const guestView2 = await svc2.getDraftView(hiddenDraftId, GUEST_ID);
    expect(guestView2.state.hidden_picks.guest).toContain('khorne');
    expect(guestView2.state.hidden_picks.host).toEqual(['?']); // masked

    // Spectator: sees nothing
    const specView2 = await svc2.getDraftView(hiddenDraftId, null);
    expect(specView2.state.hidden_picks.host).toHaveLength(0);
    expect(specView2.state.hidden_picks.guest).toHaveLength(0);

    // Cleanup
    svc2.shutdown();
    await redis.del(`draft:${hiddenDraftId}:state`);
    await redis.srem('draft:active', hiddenDraftId);
    await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH_ID2 } } });
    await prisma.draft.deleteMany({ where: { match_id: MATCH_ID2 } });
    await prisma.match.deleteMany({ where: { id: MATCH_ID2 } });
    await prisma.draftPreset.deleteMany({ where: { id: HIDDEN_PRESET_ID2 } });

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Idempotenz — calling initActiveDrafts twice does not double-trigger
// ---------------------------------------------------------------------------

describe('Idempotenz — initActiveDrafts zweimal', () => {
  it('does not schedule duplicate timers and does not fire auto-select twice', async () => {
    // Start a draft with a non-expired timer (30s in the future)
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown(); // clear existing timers

    // Flush Redis — clean state to force DB rehydration each time
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);

    // Create a fresh service and call initActiveDrafts twice
    const svc2 = new DraftService(prisma, redis, undefined);
    await svc2.initActiveDrafts();
    await svc2.initActiveDrafts(); // second call

    // Timer map should only have ONE entry for this draft (clearTimer is called before each set)
    // We can verify indirectly: draft should still be at turn 0 (timer has not fired yet)
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft!.current_turn).toBe(0);
    expect(draft!.status).toBe('ONGOING');

    // Auto-select events should be zero (timer not expired, no double trigger)
    const autoEvents = await prisma.draftEvent.findMany({
      where: { draft_id: draftId, is_auto_selected: true },
    });
    expect(autoEvents).toHaveLength(0);

    svc2.shutdown();

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('calling initActiveDrafts with already-expired timer produces exactly one auto-select even when called twice', async () => {
    // Start draft with real service (to get a DB row)
    const svc = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // Force timer to be expired in DB
    await prisma.draft.update({
      where: { id: draftId },
      data: { timer_expires_at: new Date(0) },
    });

    // Flush Redis
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);

    // First init — triggers auto-select (fire-and-forget)
    const svc2 = new DraftService(prisma, redis, undefined);
    await svc2.initActiveDrafts();

    // Wait for async forceAutoSelect to complete
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Second init — draft should now be at turn 1, no longer ONGOING at turn 0
    // The second forceAutoSelect call will either:
    //   a) see the lock held and bail out, OR
    //   b) see the draft has advanced and rehydrate with the new state
    await svc2.initActiveDrafts();
    await new Promise((resolve) => setTimeout(resolve, 100));

    svc2.shutdown();

    // Draft should have advanced exactly once from turn 0 (first auto-select)
    // but NOT twice (second init should not double-fire on the already-advanced state)
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft).not.toBeNull();

    // Count auto-selected events at turn_index 0 specifically
    const autoAtTurn0 = await prisma.draftEvent.findMany({
      where: { draft_id: draftId, is_auto_selected: true, turn_index: 0 },
    });
    expect(autoAtTurn0).toHaveLength(1); // exactly one auto-select for turn 0

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});
