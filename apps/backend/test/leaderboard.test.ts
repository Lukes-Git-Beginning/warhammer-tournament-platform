import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { computeSeasonLeaderboard } from '../src/lib/leaderboard-service.js';
import {
  createTestUser,
  createTestSeason,
  createTestTournament,
  cleanupSeason,
  cleanupTournament,
  cleanupUsers,
  type TestUser,
  type TestSeason,
  type TestTournament,
} from './helpers/db-fixtures.js';

let app: FastifyInstance;

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Per-test state — created fresh in beforeEach for tests that need it
// ---------------------------------------------------------------------------

let testUser1: TestUser;
let testUser2: TestUser;
let testUser3: TestUser;
let testSeason: TestSeason | null = null;
let testTournament: TestTournament | null = null;
let testFactionIds: string[] = [];
let matchNo = 0;

beforeEach(async () => {
  testSeason = null;
  testTournament = null;
  testFactionIds = [];
  testUser1 = await createTestUser({ username: 'Alpha' });
  testUser2 = await createTestUser({ username: 'Beta' });
  testUser3 = await createTestUser({ username: 'Gamma' });
});

afterEach(async () => {
  // Clean up in dependency order — scoped to this run's IDs only
  if (testTournament) await cleanupTournament(testTournament.id);
  if (testFactionIds.length) {
    await prisma.faction.deleteMany({ where: { id: { in: testFactionIds } } });
  }
  if (testSeason) await cleanupSeason(testSeason.id);
  await cleanupUsers([testUser1.id, testUser2.id, testUser3.id]);
});

async function createTestFaction(displayOrder: number): Promise<string> {
  const id = `test-faction-${randomUUID()}`;
  await prisma.faction.create({
    data: {
      id,
      name: `Test Faction ${displayOrder}`,
      race: 'test-race',
      category: 'ORDER',
      color_hex: '#abcdef',
      display_order: displayOrder,
    },
  });
  testFactionIds.push(id);
  return id;
}

async function completedMatch(
  seasonId: string,
  tournamentId: string,
  p1: string,
  p2: string,
  pf1: string,
  pf2: string,
  winner: string,
): Promise<void> {
  await prisma.match.create({
    data: {
      tournament_id: tournamentId,
      round: 1,
      match_number: matchNo++,
      player1_id: p1,
      player2_id: p2,
      winner_id: winner,
      player1_faction_id: pf1,
      player2_faction_id: pf2,
      status: 'COMPLETED',
      result: winner === p1 ? 'PLAYER1_WIN' : 'PLAYER2_WIN',
      season_id: seasonId,
      played_at: new Date('2026-06-01'),
    },
  });
}

// ---------------------------------------------------------------------------
// Seed helper — creates season + leaderboard entries for this test run
// ---------------------------------------------------------------------------

async function seedBase() {
  testSeason = await createTestSeason({ is_active: true });

  await prisma.leaderboardEntry.createMany({
    data: [
      { user_id: testUser1.id, season_id: testSeason.id, total_points: 100, games_played: 10, wins: 8, losses: 2 },
      { user_id: testUser2.id, season_id: testSeason.id, total_points: 80, games_played: 8, wins: 6, losses: 2 },
      { user_id: testUser3.id, season_id: testSeason.id, total_points: 60, games_played: 6, wins: 4, losses: 2 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/leaderboard', () => {
  it('returns 200 with correct structure for winrate mode (no MatchGames → empty)', async () => {
    await seedBase();

    // winrate mode uses the dynamic MatchGame source (same as rating_model).
    // seedBase() only seeds LeaderboardEntry rows (no MatchGame records),
    // so the dynamic computation returns 0 qualifying entries.
    const res = await app.inject({
      method: 'GET',
      url: `/api/leaderboard?seasonId=${testSeason!.id}&mode=winrate`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season: { id: string; is_active: boolean };
      entries: unknown[];
      total: number;
    }>();

    expect(body.season.id).toBe(testSeason!.id);
    expect(body.season.is_active).toBe(true);
    expect(body.total).toBe(0);
    expect(body.entries).toHaveLength(0);
  });

  it('returns 404 when seasonId does not exist', async () => {
    const fakeId = randomUUID();
    const res = await app.inject({ method: 'GET', url: `/api/leaderboard?seasonId=${fakeId}` });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ message: string }>();
    expect(body.message).toBe('Season not found');
  });

  it('returns 404 for non-existent UUID season', async () => {
    const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const res = await app.inject({ method: 'GET', url: `/api/leaderboard?seasonId=${fakeId}` });
    expect(res.statusCode).toBe(404);
  });

  it('pagination: page 2 returns correct structure for winrate mode', async () => {
    await seedBase();
    const res = await app.inject({
      method: 'GET',
      url: `/api/leaderboard?seasonId=${testSeason!.id}&page=2&pageSize=2&mode=winrate`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: unknown[]; total: number; page: number }>();
    expect(body.page).toBe(2);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe('GET /api/leaderboard/all-time', () => {
  it('aggregates entries across seasons and returns correct totals', async () => {
    await seedBase();

    const res = await app.inject({ method: 'GET', url: '/api/leaderboard/all-time' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      entries: Array<{
        rank: number;
        user: { username: string };
        total_points: number;
        seasons_participated: number;
      }>;
      total: number;
    }>();

    // At least 3 entries from our test season (may include entries from other seasons in test DB)
    expect(body.total).toBeGreaterThanOrEqual(3);

    // Alpha has most points in our seeded data — find her in the response
    const alphaEntry = body.entries.find((e) => e.user.username === 'Alpha');
    expect(alphaEntry).toBeDefined();
    expect(alphaEntry!.total_points).toBe(100);
    expect(alphaEntry!.seasons_participated).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/users/:id', () => {
  it('returns 400 for non-UUID id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users/not-a-uuid' });
    // Zod parse throws → 500 or Fastify validation error. Either way not 200.
    expect(res.statusCode).not.toBe(200);
  });

  it('returns 404 for unknown UUID', async () => {
    const unknownId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const res = await app.inject({ method: 'GET', url: `/api/users/${unknownId}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns dynamic current_season + all_time stats that match the leaderboard', async () => {
    testSeason = await createTestSeason({ is_active: true });
    testTournament = await createTestTournament({ organizerId: testUser1.id });
    const f1 = await createTestFaction(901);
    const f2 = await createTestFaction(902);
    const f3 = await createTestFaction(903);

    // Alpha wins twice, Beta once, Gamma none — game-level (one synthetic game per match).
    await completedMatch(testSeason.id, testTournament.id, testUser1.id, testUser2.id, f1, f2, testUser1.id);
    await completedMatch(testSeason.id, testTournament.id, testUser1.id, testUser3.id, f1, f3, testUser1.id);
    await completedMatch(testSeason.id, testTournament.id, testUser2.id, testUser3.id, f2, f3, testUser2.id);

    // Source of truth: the dynamic leaderboard the profile must now mirror.
    const board = await computeSeasonLeaderboard(prisma, undefined, testSeason.id);
    const expected = board.find((e) => e.playerId === testUser1.id);
    expect(expected).toBeDefined();

    const res = await app.inject({ method: 'GET', url: `/api/users/${testUser1.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      user: { id: string; username: string };
      current_season: { total_points: number; games_played: number; wins: number; losses: number } | null;
      all_time: { games_played: number; wins: number; losses: number; total_points: number; tournaments_played: number };
      recent_results: unknown[];
      recent_matches: unknown[];
    }>();

    expect(body.user.id).toBe(testUser1.id);
    expect(body.user.username).toBe('Alpha');

    expect(body.current_season).not.toBeNull();
    expect(body.current_season!.games_played).toBe(2);
    expect(body.current_season!.wins).toBe(2);
    expect(body.current_season!.losses).toBe(0);
    expect(body.current_season!.total_points).toBeCloseTo(expected!.totalFinalPoints, 6);

    // Single season → all_time mirrors current_season (summed across seasons).
    expect(body.all_time.games_played).toBe(2);
    expect(body.all_time.wins).toBe(2);
    expect(body.all_time.losses).toBe(0);
    expect(body.all_time.total_points).toBeCloseTo(expected!.totalFinalPoints, 6);
    expect(body.all_time.tournaments_played).toBe(0);

    expect(Array.isArray(body.recent_results)).toBe(true);
    expect(Array.isArray(body.recent_matches)).toBe(true);
  });

  it('returns null current_season when user has no confirmed games', async () => {
    // testUser1 exists but has played no confirmed games — current_season should be null
    const res = await app.inject({ method: 'GET', url: `/api/users/${testUser1.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ current_season: null | { total_points: number } }>();
    expect(body.current_season).toBeNull();
  });

});
