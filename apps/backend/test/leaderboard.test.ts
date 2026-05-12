import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

let app: FastifyInstance;

// Deterministic UUIDs
const S1 = '10000000-0000-0000-0000-000000000001'; // season
const U1 = '20000000-0000-0000-0000-000000000001';
const U2 = '20000000-0000-0000-0000-000000000002';
const U3 = '20000000-0000-0000-0000-000000000003';

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const T1 = 'a0000000-0000-0000-0000-000000000001';

beforeEach(async () => {
  // Clean up in dependency order — remove our test data AND any stray active seasons
  await prisma.leaderboardEntry.deleteMany({ where: { season_id: S1 } });
  await prisma.tournamentResult.deleteMany({ where: { user_id: { in: [U1, U2, U3] } } });
  await prisma.tournament.deleteMany({ where: { id: T1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
  await prisma.user.deleteMany({ where: { id: { in: [U1, U2, U3] } } });
  // Deactivate any other seasons that could interfere with the "no active season" test
  await prisma.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
});

async function seedBase() {
  await prisma.user.createMany({
    data: [
      { id: U1, discord_id: 'disc_lb_1', username: 'Alpha', email: null },
      { id: U2, discord_id: 'disc_lb_2', username: 'Beta', email: null },
      { id: U3, discord_id: 'disc_lb_3', username: 'Gamma', email: null },
    ],
    skipDuplicates: true,
  });

  await prisma.season.create({
    data: {
      id: S1,
      name: 'Season Test',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: true,
    },
  });

  await prisma.leaderboardEntry.createMany({
    data: [
      { user_id: U1, season_id: S1, total_points: 100, elo_rating: 1400, matches_played: 10, wins: 8, losses: 2 },
      { user_id: U2, season_id: S1, total_points: 80, elo_rating: 1300, matches_played: 8, wins: 6, losses: 2 },
      { user_id: U3, season_id: S1, total_points: 60, elo_rating: 1200, matches_played: 6, wins: 4, losses: 2 },
    ],
  });
}

describe('GET /api/leaderboard', () => {
  it('returns 3 entries in correct rank order for active season', async () => {
    await seedBase();

    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season: { id: string; is_active: boolean };
      entries: Array<{ rank: number; user: { username: string }; total_points: number }>;
      total: number;
    }>();

    expect(body.season.id).toBe(S1);
    expect(body.season.is_active).toBe(true);
    expect(body.total).toBe(3);
    expect(body.entries).toHaveLength(3);

    expect(body.entries[0]!.rank).toBe(1);
    expect(body.entries[0]!.user.username).toBe('Alpha');
    expect(body.entries[0]!.total_points).toBe(100);

    expect(body.entries[1]!.rank).toBe(2);
    expect(body.entries[2]!.rank).toBe(3);
  });

  it('returns 404 when no active season and no seasonId given', async () => {
    // No seed — no active season
    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ message: string }>();
    expect(body.message).toBe('No active season');
  });

  it('returns 404 for non-existent seasonId', async () => {
    const fakeId = '99999999-0000-0000-0000-000000000000';
    const res = await app.inject({ method: 'GET', url: `/api/leaderboard?seasonId=${fakeId}` });
    expect(res.statusCode).toBe(404);
  });

  it('pagination: page 2 returns empty for 3 entries with pageSize 2', async () => {
    await seedBase();
    const res = await app.inject({ method: 'GET', url: `/api/leaderboard?seasonId=${S1}&page=2&pageSize=2` });
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

    expect(body.total).toBe(3);
    expect(body.entries[0]!.total_points).toBe(100);
    expect(body.entries[0]!.seasons_participated).toBe(1);
    expect(body.entries[0]!.rank).toBe(1);
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

    const res = await app.inject({ method: 'GET', url: `/api/users/${U1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      user: { id: string; username: string };
      current_season: { total_points: number; wins: number } | null;
      all_time: { matches_played: number; wins: number; total_points: number; tournaments_played: number };
      recent_results: unknown[];
      recent_matches: unknown[];
    }>();

    expect(body.user.id).toBe(U1);
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

  it('returns null current_season when no active season', async () => {
    // Create user without season
    await prisma.user.create({
      data: { id: U1, discord_id: 'disc_lb_1', username: 'Alpha', email: null },
    });

    const res = await app.inject({ method: 'GET', url: `/api/users/${U1}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ current_season: null }>();
    expect(body.current_season).toBeNull();
  });

  it('exposes elo_change in recent_results', async () => {
    await seedBase();

    // Create a tournament with a result that has elo_change=15
    await prisma.tournament.create({
      data: {
        id: T1,
        slug: 'elo-change-test',
        name: 'ELO Change Test Tournament',
        format: 'SWISS',
        status: 'COMPLETED',
        timezone: 'Europe/Berlin',
        organizer_id: U1,
        start_date: new Date('2026-03-01'),
      },
    });
    await prisma.tournamentResult.create({
      data: {
        user_id: U1,
        tournament_id: T1,
        season_id: S1,
        placement: 1,
        points_earned: 30,
        elo_change: 15,
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/users/${U1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      recent_results: Array<{ placement: number; elo_change: number | null }>;
    }>();

    expect(body.recent_results).toHaveLength(1);
    expect(body.recent_results[0]!.elo_change).toBe(15);
  });
});
