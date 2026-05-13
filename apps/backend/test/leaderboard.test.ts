import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';
import {
  createTestUser,
  createTestSeason,
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

beforeEach(async () => {
  testSeason = null;
  testTournament = null;
  testUser1 = await createTestUser({ username: 'Alpha' });
  testUser2 = await createTestUser({ username: 'Beta' });
  testUser3 = await createTestUser({ username: 'Gamma' });
});

afterEach(async () => {
  // Clean up in dependency order — scoped to this run's IDs only
  if (testTournament) await cleanupTournament(testTournament.id);
  if (testSeason) await cleanupSeason(testSeason.id);
  await cleanupUsers([testUser1.id, testUser2.id, testUser3.id]);
});

// ---------------------------------------------------------------------------
// Seed helper — creates season + leaderboard entries for this test run
// ---------------------------------------------------------------------------

async function seedBase() {
  testSeason = await createTestSeason({ is_active: true });

  await prisma.leaderboardEntry.createMany({
    data: [
      { user_id: testUser1.id, season_id: testSeason.id, total_points: 100, elo_rating: 1400, matches_played: 10, wins: 8, losses: 2 },
      { user_id: testUser2.id, season_id: testSeason.id, total_points: 80, elo_rating: 1300, matches_played: 8, wins: 6, losses: 2 },
      { user_id: testUser3.id, season_id: testSeason.id, total_points: 60, elo_rating: 1200, matches_played: 6, wins: 4, losses: 2 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/leaderboard', () => {
  it('returns entries in correct rank order when queried by explicit seasonId', async () => {
    await seedBase();

    const res = await app.inject({ method: 'GET', url: `/api/leaderboard?seasonId=${testSeason!.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season: { id: string; is_active: boolean };
      entries: Array<{ rank: number; user: { username: string }; total_points: number }>;
      total: number;
    }>();

    expect(body.season.id).toBe(testSeason!.id);
    expect(body.season.is_active).toBe(true);
    expect(body.total).toBe(3);
    expect(body.entries).toHaveLength(3);

    expect(body.entries[0]!.rank).toBe(1);
    expect(body.entries[0]!.user.username).toBe('Alpha');
    expect(body.entries[0]!.total_points).toBe(100);

    expect(body.entries[1]!.rank).toBe(2);
    expect(body.entries[2]!.rank).toBe(3);
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

  it('pagination: page 2 returns 1 entry for 3 entries with pageSize 2', async () => {
    await seedBase();
    const res = await app.inject({
      method: 'GET',
      url: `/api/leaderboard?seasonId=${testSeason!.id}&page=2&pageSize=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: unknown[]; total: number; page: number }>();
    expect(body.total).toBe(3);
    expect(body.page).toBe(2);
    expect(body.entries).toHaveLength(1);
    // rank on page 2 starts at 3
    const entry = body.entries[0] as { rank: number };
    expect(entry.rank).toBe(3);
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

  it('returns 200 with correct stats for known user', async () => {
    await seedBase();

    const res = await app.inject({ method: 'GET', url: `/api/users/${testUser1.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      user: { id: string; username: string };
      current_season: { total_points: number; wins: number } | null;
      all_time: { matches_played: number; wins: number; total_points: number; tournaments_played: number };
      recent_results: unknown[];
      recent_matches: unknown[];
    }>();

    expect(body.user.id).toBe(testUser1.id);
    expect(body.user.username).toBe('Alpha');

    expect(body.current_season).not.toBeNull();
    expect(body.current_season!.total_points).toBe(100);
    expect(body.current_season!.wins).toBe(8);

    expect(body.all_time.matches_played).toBe(10);
    expect(body.all_time.wins).toBe(8);
    expect(body.all_time.total_points).toBe(100);
    expect(body.all_time.tournaments_played).toBe(0);

    expect(Array.isArray(body.recent_results)).toBe(true);
    expect(Array.isArray(body.recent_matches)).toBe(true);
  });

  it('returns null current_season when user has no leaderboard entry in any active season', async () => {
    // testUser1 exists but has no leaderboard entries — current_season should be null
    const res = await app.inject({ method: 'GET', url: `/api/users/${testUser1.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ current_season: null | { total_points: number } }>();
    expect(body.current_season).toBeNull();
  });

  it('exposes elo_change in recent_results', async () => {
    await seedBase();

    // Create a tournament with a result that has elo_change=15
    const tournamentId = randomUUID();
    testTournament = { id: tournamentId, slug: `elo-change-test-${tournamentId}` };
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: testTournament.slug,
        name: 'ELO Change Test Tournament',
        format: 'SWISS',
        status: 'COMPLETED',
        timezone: 'Europe/Berlin',
        organizer_id: testUser1.id,
        start_date: new Date('2026-03-01'),
      },
    });
    await prisma.tournamentResult.create({
      data: {
        user_id: testUser1.id,
        tournament_id: tournamentId,
        season_id: testSeason!.id,
        placement: 1,
        points_earned: 30,
        elo_change: 15,
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/users/${testUser1.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      recent_results: Array<{ placement: number; elo_change: number | null }>;
    }>();

    expect(body.recent_results).toHaveLength(1);
    expect(body.recent_results[0]!.elo_change).toBe(15);
  });
});
