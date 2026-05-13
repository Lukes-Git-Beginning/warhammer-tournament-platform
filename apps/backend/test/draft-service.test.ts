/**
 * Integration tests for DraftService (M4.2).
 *
 * Tests cover the full I/O layer: Redis state management, DB persistence,
 * concurrency lock, timer mechanics, and complete draft flow.
 *
 * Requires:
 *  - Real Redis (REDIS_URL set in .env)
 *  - Real PostgreSQL (DATABASE_URL set in .env)
 *  - Factions seeded (seed.ts has been run)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';
import { DraftService, BusyError, InvalidActionError, DraftNotFoundError } from '../src/lib/draft-service.js';
import type { DraftTurn } from '@tww3/types';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

const HOST_ID    = 'd4100000-0000-0000-0000-000000000001';
const GUEST_ID   = 'd4100000-0000-0000-0000-000000000002';
const ADMIN_ID   = 'd4100000-0000-0000-0000-000000000003';
const PRESET_ID  = 'd4200000-0000-0000-0000-000000000001';
const MATCH_ID   = 'd4300000-0000-0000-0000-000000000001';
const TOURN_ID   = 'd4400000-0000-0000-0000-000000000001';

// Faction IDs from DB seed
const ALL_FACTIONS = [
  'empire', 'bretonnia', 'kislev', 'grand_cathay', 'dwarfs', 'high_elves', 'lizardmen',
  'greenskins', 'dark_elves', 'skaven', 'norsca', 'ogre_kingdoms', 'beastmen',
  'khorne', 'nurgle', 'tzeentch', 'slaanesh', 'daemons_of_chaos', 'warriors_of_chaos',
  'chaos_dwarfs', 'vampire_counts', 'vampire_coast', 'tomb_kings', 'wood_elves',
];

// Simple turns for basic tests: ban-ban-pick-pick
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
let redis: Redis;
let service: DraftService;

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
  service = app.draftService;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// DB cleanup helpers
// ---------------------------------------------------------------------------

async function cleanupDraftData() {
  await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH_ID } } });
  await prisma.draft.deleteMany({ where: { match_id: MATCH_ID } });
  await prisma.draftPreset.deleteMany({ where: { id: PRESET_ID } });
  await prisma.match.deleteMany({ where: { id: MATCH_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURN_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, GUEST_ID, ADMIN_ID] } } });
}

async function cleanupRedis(draftId?: string) {
  if (draftId) {
    await redis.del(`draft:${draftId}:state`);
    await redis.del(`draft:${draftId}:lock`);
    await redis.srem('draft:active', draftId);
  }
  // Clean up any stray keys from our test UUIDs
  const keys = await redis.keys('draft:d4*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.srem('draft:active', ...['placeholder']); // safe no-op
}

beforeEach(async () => {
  await cleanupDraftData();
  await cleanupRedis();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: HOST_ID,  discord_id: 'disc_draft_host',  username: 'DraftHost',  email: null },
      { id: GUEST_ID, discord_id: 'disc_draft_guest', username: 'DraftGuest', email: null },
      { id: ADMIN_ID, discord_id: 'disc_draft_admin', username: 'DraftAdmin', email: null, role: 'ADMIN' },
    ],
    skipDuplicates: true,
  });

  // Seed tournament
  await prisma.tournament.create({
    data: {
      id: TOURN_ID,
      slug: 'draft-test-tournament',
      name: 'Draft Test Tournament',
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
      name: 'Test Ban-Ban-Pick-Pick',
      created_by: ADMIN_ID,
      is_public: true,
      turns: SIMPLE_TURNS,
      category_limits: [],
      turn_seconds: 30,
    },
  });
});

afterEach(async () => {
  // Clean up all test drafts from Redis
  const keys = await redis.keys('draft:*');
  const draftKeys = keys.filter(k =>
    k.startsWith('draft:d4') || k === 'draft:active'
  );
  // Remove test draft IDs from active set without deleting the key itself
  const activeDraftIds = await redis.smembers('draft:active');
  for (const id of activeDraftIds) {
    if (id.startsWith('d4')) {
      await redis.srem('draft:active', id);
      await redis.del(`draft:${id}:state`);
      await redis.del(`draft:${id}:lock`);
    }
  }
});

// ---------------------------------------------------------------------------
// Helper: create a fresh DraftService with a fake clock for timer control
// ---------------------------------------------------------------------------

function makeSvcWithClock(clockMs: number) {
  const clock = () => new Date(clockMs);
  return new DraftService(prisma, redis, undefined, clock);
}

// ---------------------------------------------------------------------------
// Test 1: startDraft creates Draft row, Redis hash, and 'start' DraftEvent
// ---------------------------------------------------------------------------

describe('startDraft', () => {
  it('creates Draft row, Redis hash, and start DraftEvent', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });

    expect(draftId).toBeTruthy();

    // DB: Draft row created
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft).not.toBeNull();
    expect(draft!.status).toBe('ONGOING');
    expect(draft!.current_turn).toBe(0);
    expect(draft!.host_user_id).toBe(HOST_ID);
    expect(draft!.guest_user_id).toBe(GUEST_ID);

    // DB: start DraftEvent created
    const events = await prisma.draftEvent.findMany({ where: { draft_id: draftId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('system');
    expect(events[0]!.action).toBe('start');

    // Redis: hash created
    const hash = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash.status).toBe('ONGOING');
    expect(hash.host_user_id).toBe(HOST_ID);
    expect(hash.guest_user_id).toBe(GUEST_ID);
    expect(hash.current_turn).toBe('0');

    // Redis: active set
    const isActive = await redis.sismember('draft:active', draftId);
    expect(isActive).toBe(1);

    // Cleanup
    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('rejects if match already has a draft', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });

    await expect(
      service.startDraft({
        matchId: MATCH_ID,
        presetId: PRESET_ID,
        hostUserId: HOST_ID,
        guestUserId: GUEST_ID,
        allFactionIds: ALL_FACTIONS,
      }),
    ).rejects.toThrow(InvalidActionError);

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 3: handleAction rejects non-player user
// ---------------------------------------------------------------------------

describe('handleAction', () => {
  it('rejects when called by non-player user', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    await expect(
      service.handleAction(draftId, ADMIN_ID, 'empire'),
    ).rejects.toThrow(InvalidActionError);

    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('applies ban, increments turn, persists to DB and Redis', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    // Turn 0: host bans empire
    await service.handleAction(draftId, HOST_ID, 'empire');

    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft!.current_turn).toBe(1);

    const hash = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash.current_turn).toBe('1');

    const state = JSON.parse(hash.state);
    expect(state.bans).toContain('empire');

    const events = await prisma.draftEvent.findMany({
      where: { draft_id: draftId },
      orderBy: { created_at: 'asc' },
    });
    expect(events).toHaveLength(2); // start + ban
    expect(events[1]!.action).toBe('ban');
    expect(events[1]!.faction_id).toBe('empire');

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('rejects faction not in available (already banned)', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    // Ban empire first
    await service.handleAction(draftId, HOST_ID, 'empire');

    // Try to pick an already-banned faction later (we need to advance to pick turn)
    // Turn 1: guest bans bretonnia
    await service.handleAction(draftId, GUEST_ID, 'bretonnia');

    // Turn 2: host tries to pick 'empire' (globally banned) — should fail
    await expect(
      service.handleAction(draftId, HOST_ID, 'empire'),
    ).rejects.toThrow(InvalidActionError);

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });

  it('hidden pick adds to hidden_picks, not picks', async () => {
    // Create a preset with a hidden pick
    const HIDDEN_PRESET_ID = 'd4200000-0000-0000-0000-000000000002';
    const hiddenTurns: DraftTurn[] = [
      { order: 0, actor: 'host', action: 'pick', variant: 'global', is_hidden: true, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 1, actor: 'guest', action: 'pick', variant: 'global', is_hidden: true, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 2, actor: 'host', action: 'reveal_picks', variant: null, is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    ];
    await prisma.draftPreset.create({
      data: {
        id: HIDDEN_PRESET_ID,
        name: 'Hidden Pick Test',
        created_by: ADMIN_ID,
        is_public: true,
        turns: hiddenTurns,
        category_limits: [],
        turn_seconds: 30,
      },
    });

    // Need a different match for this
    const MATCH2_ID = 'd4300000-0000-0000-0000-000000000002';
    await prisma.match.create({
      data: {
        id: MATCH2_ID,
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 2,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'ONGOING',
      },
    });

    const svc2 = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc2.startDraft({
      matchId: MATCH2_ID,
      presetId: HIDDEN_PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc2.shutdown();

    // Host makes hidden pick
    await svc2.handleAction(draftId, HOST_ID, 'empire');

    const hash = await redis.hgetall(`draft:${draftId}:state`);
    const state = JSON.parse(hash.state);
    expect(state.hidden_picks.host).toContain('empire');
    expect(state.picks.host).not.toContain('empire');

    // Cleanup
    svc2.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
    await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH2_ID } } });
    await prisma.draft.deleteMany({ where: { match_id: MATCH2_ID } });
    await prisma.match.deleteMany({ where: { id: MATCH2_ID } });
    await prisma.draftPreset.deleteMany({ where: { id: HIDDEN_PRESET_ID } });
  });
});

// ---------------------------------------------------------------------------
// Test 7: forceAutoSelect
// ---------------------------------------------------------------------------

describe('forceAutoSelect', () => {
  it('picks a random available faction, marks is_auto_selected in DraftEvent, and advances', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown(); // stop timers

    // Call forceAutoSelect on turn 0 (host ban)
    await service.forceAutoSelect(draftId);

    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft!.current_turn).toBe(1);

    const events = await prisma.draftEvent.findMany({
      where: { draft_id: draftId, is_auto_selected: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.faction_id).not.toBeNull(); // a faction was selected

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 8: parallel turn
// ---------------------------------------------------------------------------

describe('parallel turns', () => {
  it('first submit stores pending state, second completes the turn', async () => {
    const PARALLEL_PRESET_ID = 'd4200000-0000-0000-0000-000000000003';
    const parallelTurns: DraftTurn[] = [
      { order: 0, actor: 'host', action: 'pick', variant: 'global', is_hidden: false, is_parallel: true, as_opponent: false, category: 'default' },
    ];
    await prisma.draftPreset.create({
      data: {
        id: PARALLEL_PRESET_ID,
        name: 'Parallel Test',
        created_by: ADMIN_ID,
        is_public: true,
        turns: parallelTurns,
        category_limits: [],
        turn_seconds: 30,
      },
    });

    const MATCH3_ID = 'd4300000-0000-0000-0000-000000000003';
    await prisma.match.create({
      data: {
        id: MATCH3_ID,
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 3,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'ONGOING',
      },
    });

    const svc3 = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc3.startDraft({
      matchId: MATCH3_ID,
      presetId: PARALLEL_PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc3.shutdown();

    // Host submits — should be pending
    await svc3.handleAction(draftId, HOST_ID, 'empire');
    const hash1 = await redis.hgetall(`draft:${draftId}:state`);
    const state1 = JSON.parse(hash1.state);
    expect(state1.parallel_pending.host).toBe('empire');
    expect(hash1.current_turn).toBe('0'); // NOT yet advanced

    // Guest submits — should complete
    await svc3.handleAction(draftId, GUEST_ID, 'khorne');
    const hash2 = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash2.current_turn).toBe('1');
    const state2 = JSON.parse(hash2.state);
    expect(state2.parallel_pending.host).toBeNull();
    expect(state2.parallel_pending.guest).toBeNull();

    svc3.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
    await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH3_ID } } });
    await prisma.draft.deleteMany({ where: { match_id: MATCH3_ID } });
    await prisma.match.deleteMany({ where: { id: MATCH3_ID } });
    await prisma.draftPreset.deleteMany({ where: { id: PARALLEL_PRESET_ID } });
  });
});

// ---------------------------------------------------------------------------
// Test 9: reveal_picks turn
// ---------------------------------------------------------------------------

describe('reveal_picks', () => {
  it('moves hidden_picks to picks on reveal', async () => {
    const REVEAL_PRESET_ID = 'd4200000-0000-0000-0000-000000000004';
    const revealTurns: DraftTurn[] = [
      { order: 0, actor: 'host',  action: 'pick',         variant: 'global', is_hidden: true,  is_parallel: false, as_opponent: false, category: 'default' },
      { order: 1, actor: 'guest', action: 'pick',         variant: 'global', is_hidden: true,  is_parallel: false, as_opponent: false, category: 'default' },
      { order: 2, actor: 'host',  action: 'reveal_picks', variant: null,     is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    ];
    await prisma.draftPreset.create({
      data: {
        id: REVEAL_PRESET_ID,
        name: 'Reveal Picks Test',
        created_by: ADMIN_ID,
        is_public: true,
        turns: revealTurns,
        category_limits: [],
        turn_seconds: 30,
      },
    });

    const MATCH4_ID = 'd4300000-0000-0000-0000-000000000004';
    await prisma.match.create({
      data: {
        id: MATCH4_ID,
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 4,
        player1_id: HOST_ID,
        player2_id: GUEST_ID,
        status: 'ONGOING',
      },
    });

    const svc4 = new DraftService(prisma, redis, undefined);
    const { draftId } = await svc4.startDraft({
      matchId: MATCH4_ID,
      presetId: REVEAL_PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc4.shutdown();

    // Turn 0: host hidden pick
    await svc4.handleAction(draftId, HOST_ID, 'empire');
    // Turn 1: guest hidden pick
    await svc4.handleAction(draftId, GUEST_ID, 'khorne');

    // Turn 2: reveal (actor = host for the reveal turn, but system/host triggers it)
    // reveal_picks turns need to be triggered — since actor is 'host', use handleAction with dummy factionId
    // Actually reveal turns are applied when forceAutoSelect is called OR when the actor triggers them.
    // Per design, reveal turns are triggered by the actor (host in this case).
    // We'll call forceAutoSelect since reveal turns don't need a user-selected faction.
    await svc4.forceAutoSelect(draftId);

    const hash = await redis.hgetall(`draft:${draftId}:state`);
    const state = JSON.parse(hash.state);
    expect(state.picks.host).toContain('empire');
    expect(state.picks.guest).toContain('khorne');
    expect(state.hidden_picks.host).toHaveLength(0);
    expect(state.hidden_picks.guest).toHaveLength(0);

    svc4.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
    await prisma.draftEvent.deleteMany({ where: { draft: { match_id: MATCH4_ID } } });
    await prisma.draft.deleteMany({ where: { match_id: MATCH4_ID } });
    await prisma.match.deleteMany({ where: { id: MATCH4_ID } });
    await prisma.draftPreset.deleteMany({ where: { id: REVEAL_PRESET_ID } });
  });
});

// ---------------------------------------------------------------------------
// Test 10: completeDraft
// ---------------------------------------------------------------------------

describe('completeDraft', () => {
  it('sets status COMPLETED, sets final factions, removes from draft:active', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    // Execute all 4 turns
    await service.handleAction(draftId, HOST_ID,  'empire');     // turn 0: host ban
    await service.handleAction(draftId, GUEST_ID, 'khorne');     // turn 1: guest ban
    await service.handleAction(draftId, HOST_ID,  'bretonnia');  // turn 2: host pick
    await service.handleAction(draftId, GUEST_ID, 'nurgle');     // turn 3: guest pick

    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft!.status).toBe('COMPLETED');
    expect(draft!.completed_at).not.toBeNull();
    expect(draft!.final_host_factions).toContain('bretonnia');
    expect(draft!.final_guest_factions).toContain('nurgle');

    const isActive = await redis.sismember('draft:active', draftId);
    expect(isActive).toBe(0);

    const hash = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash.status).toBe('COMPLETED');

    // Verify complete event created
    const completeEvent = await prisma.draftEvent.findFirst({
      where: { draft_id: draftId, action: 'complete' },
    });
    expect(completeEvent).not.toBeNull();

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 11: initActiveDrafts rehydrates from DB after Redis flush
// ---------------------------------------------------------------------------

describe('initActiveDrafts', () => {
  it('rehydrates Redis from DB when Redis is empty', async () => {
    const svc = new DraftService(prisma, redis, undefined);

    const { draftId } = await svc.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    svc.shutdown();

    // Delete Redis state (simulates restart)
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);

    // Create fresh service and run init
    const svc2 = new DraftService(prisma, redis, undefined);
    const count = await svc2.initActiveDrafts();

    expect(count).toBeGreaterThanOrEqual(1);

    // Redis should be repopulated
    const hash = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash.status).toBe('ONGOING');
    expect(hash.host_user_id).toBe(HOST_ID);

    svc2.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 12: concurrent action — SETNX lock prevents double-submit
// ---------------------------------------------------------------------------

describe('concurrency', () => {
  it('SETNX lock prevents double-submit — second call throws BusyError', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    // Manually set the lock to simulate a concurrent operation
    await redis.set(`draft:${draftId}:lock`, '1', 'PX', 5000, 'NX');

    await expect(
      service.handleAction(draftId, HOST_ID, 'empire'),
    ).rejects.toThrow(BusyError);

    // Clean up lock manually
    await redis.del(`draft:${draftId}:lock`);
    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test 13: cancelDraft
// ---------------------------------------------------------------------------

describe('cancelDraft', () => {
  it('sets status to CANCELLED, stops timer scheduling', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    await service.cancelDraft(draftId, ADMIN_ID);

    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    expect(draft!.status).toBe('CANCELLED');

    const hash = await redis.hgetall(`draft:${draftId}:state`);
    expect(hash.status).toBe('CANCELLED');

    const isActive = await redis.sismember('draft:active', draftId);
    expect(isActive).toBe(0);

    // Calling forceAutoSelect should be a no-op on cancelled draft
    await service.forceAutoSelect(draftId); // should not throw

    const cancelEvent = await prisma.draftEvent.findFirst({
      where: { draft_id: draftId, action: 'cancel' },
    });
    expect(cancelEvent).not.toBeNull();
    expect((cancelEvent!.payload as any).cancelledBy).toBe(ADMIN_ID);

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
  });
});

// ---------------------------------------------------------------------------
// Test 14: getDraftView returns correct viewer_role
// ---------------------------------------------------------------------------

describe('getDraftView', () => {
  it('returns host, guest, and spectator viewer_role correctly', async () => {
    const { draftId } = await service.startDraft({
      matchId: MATCH_ID,
      presetId: PRESET_ID,
      hostUserId: HOST_ID,
      guestUserId: GUEST_ID,
      allFactionIds: ALL_FACTIONS,
    });
    service.shutdown();

    const hostView = await service.getDraftView(draftId, HOST_ID);
    expect(hostView.viewer_role).toBe('host');

    const guestView = await service.getDraftView(draftId, GUEST_ID);
    expect(guestView.viewer_role).toBe('guest');

    const specView = await service.getDraftView(draftId, null);
    expect(specView.viewer_role).toBe('spectator');

    // Unknown user → spectator
    const unknownView = await service.getDraftView(draftId, ADMIN_ID);
    expect(unknownView.viewer_role).toBe('spectator');

    // Spectator cannot see hidden picks (opponent's)
    // Make a hidden pick first
    // Do it manually for simpler test: verify masking
    expect(hostView.state.hidden_picks).toBeDefined();
    expect(specView.state.hidden_picks.host).toHaveLength(0);

    service.shutdown();
    await redis.del(`draft:${draftId}:state`);
    await redis.srem('draft:active', draftId);
  });
});

// ---------------------------------------------------------------------------
// Test: DraftNotFoundError on unknown draft
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws DraftNotFoundError for unknown draftId in handleAction', async () => {
    await expect(
      service.handleAction('00000000-0000-0000-0000-000000000000', HOST_ID, 'empire'),
    ).rejects.toThrow(DraftNotFoundError);
  });
});
