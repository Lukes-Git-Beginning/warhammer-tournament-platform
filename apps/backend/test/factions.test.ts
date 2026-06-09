import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'f1000000-0000-0000-0000-000000000001'; // season

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

async function cleanup() {
  await prisma.factionStatsSnapshot.deleteMany({ where: { season_id: S1 } });
  await prisma.matchupStats.deleteMany({ where: { season_id: S1 } });
  await prisma.factionStats.deleteMany({ where: { season_id: S1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
  await prisma.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
}

beforeEach(cleanup);

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedSeason() {
  await prisma.season.create({
    data: {
      id: S1,
      name: 'FactionTest Season',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: true,
    },
  });
}

async function seedFactionStats() {
  // Create FactionStats for empire and high_elves only, others have none
  await prisma.factionStats.createMany({
    data: [
      {
        faction_id: 'empire',
        season_id: S1,
        matches_played: 20,
        wins: 15,
        losses: 4,
        draws: 1,
        pick_count: 20,
        ban_count: 0,
      },
      {
        faction_id: 'high_elves',
        season_id: S1,
        matches_played: 10,
        wins: 5,
        losses: 5,
        draws: 0,
        pick_count: 10,
        ban_count: 0,
      },
    ],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// GET /api/factions
// ---------------------------------------------------------------------------

describe('GET /api/factions', () => {
  it('1. returns 24 factions with stats: null when no FactionStats exist', async () => {
    await seedSeason();

    const res = await app.inject({ method: 'GET', url: `/api/factions?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: Array<{ faction: { id: string; initials: string }; stats: unknown | null }>;
      season: { id: string };
    }>();

    expect(body.season.id).toBe(S1);
    expect(body.data).toHaveLength(24);

    // All stats should be null since no FactionStats were seeded
    for (const item of body.data) {
      expect(item.stats).toBeNull();
    }

    // Spot check: empire should have 2-char initials
    const empire = body.data.find((f) => f.faction.id === 'empire');
    expect(empire).toBeDefined();
    expect(empire!.faction.initials).toBe('EM');

    // Spot check: high_elves → "HE" (H from "High", E from "Elves")
    const highElves = body.data.find((f) => f.faction.id === 'high_elves');
    expect(highElves!.faction.initials).toBe('HE');

    // Stop-word skip: "Daemons of Chaos" → "DC", "Warriors of Chaos" → "WC"
    expect(body.data.find((f) => f.faction.id === 'daemons_of_chaos')!.faction.initials).toBe('DC');
    expect(body.data.find((f) => f.faction.id === 'warriors_of_chaos')!.faction.initials).toBe('WC');

    // Collision overrides: vampire_counts → "VCs", vampire_coast → "VCo"
    expect(body.data.find((f) => f.faction.id === 'vampire_counts')!.faction.initials).toBe('VCs');
    expect(body.data.find((f) => f.faction.id === 'vampire_coast')!.faction.initials).toBe('VCo');
  });

  it('2. returns correct stats and win_rate when FactionStats are present', async () => {
    await seedSeason();
    await seedFactionStats();

    const res = await app.inject({ method: 'GET', url: `/api/factions?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: Array<{
        faction: { id: string };
        stats: { matches_played: number; wins: number; win_rate: number | null } | null;
      }>;
    }>();

    const empire = body.data.find((f) => f.faction.id === 'empire');
    expect(empire).toBeDefined();
    expect(empire!.stats).not.toBeNull();
    expect(empire!.stats!.matches_played).toBe(20);
    expect(empire!.stats!.wins).toBe(15);
    // win_rate = 15/20 = 0.75
    expect(empire!.stats!.win_rate).toBeCloseTo(0.75);

    const highElves = body.data.find((f) => f.faction.id === 'high_elves');
    expect(highElves!.stats!.win_rate).toBeCloseTo(0.5);

    // Factions without stats should still appear with stats: null
    const skaven = body.data.find((f) => f.faction.id === 'skaven');
    expect(skaven!.stats).toBeNull();
  });

  it('returns 404 for non-existent seasonId', async () => {
    const fakeId = '99999999-0000-0000-0000-000000000099';
    const res = await app.inject({ method: 'GET', url: `/api/factions?seasonId=${fakeId}` });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/factions/:id
// ---------------------------------------------------------------------------

describe('GET /api/factions/:id', () => {
  it('3. returns faction detail with stats and empty trend for valid faction', async () => {
    await seedSeason();
    await seedFactionStats();

    const res = await app.inject({
      method: 'GET',
      url: `/api/factions/empire?seasonId=${S1}`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      faction: { id: string; name: string; initials: string };
      stats: { matches_played: number; win_rate: number | null } | null;
      trend: Array<{ date: string; matches_played: number; win_rate: number | null }>;
    }>();

    expect(body.faction.id).toBe('empire');
    expect(body.faction.name).toBe('Empire');
    expect(body.faction.initials).toBe('EM');
    expect(body.stats).not.toBeNull();
    expect(body.stats!.matches_played).toBe(20);
    expect(body.stats!.win_rate).toBeCloseTo(0.75);
    expect(Array.isArray(body.trend)).toBe(true);
    // No snapshots seeded → trend is empty
    expect(body.trend).toHaveLength(0);
  });

  it('4. returns 404 for non-existing faction id', async () => {
    await seedSeason();

    const res = await app.inject({
      method: 'GET',
      url: `/api/factions/nonexistent_faction?seasonId=${S1}`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NotFound');
  });

  it('returns trend entries when snapshots exist', async () => {
    await seedSeason();
    await seedFactionStats();

    // Seed two snapshot entries within last 30 days
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 5);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 1);

    await prisma.factionStatsSnapshot.createMany({
      data: [
        {
          faction_id: 'empire',
          season_id: S1,
          snapshot_date: d1,
          matches_played: 10,
          wins: 7,
          losses: 3,
          draws: 0,
          pick_count: 10,
          ban_count: 0,
        },
        {
          faction_id: 'empire',
          season_id: S1,
          snapshot_date: d2,
          matches_played: 20,
          wins: 15,
          losses: 4,
          draws: 1,
          pick_count: 20,
          ban_count: 0,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/factions/empire?seasonId=${S1}`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      trend: Array<{ date: string; matches_played: number; win_rate: number | null }>;
    }>();

    expect(body.trend).toHaveLength(2);
    expect(body.trend[0]!.win_rate).toBeCloseTo(0.7);
    expect(body.trend[1]!.win_rate).toBeCloseTo(0.75);
  });
});

// ---------------------------------------------------------------------------
// GET /api/meta/overview
// ---------------------------------------------------------------------------

describe('GET /api/meta/overview', () => {
  it('5. returns correct top_by_winrate and top_by_pickrate with seeded stats', async () => {
    await seedSeason();
    await seedFactionStats();

    // Seed additional factions to ensure top-5 logic is tested
    await prisma.factionStats.createMany({
      data: [
        { faction_id: 'dwarfs', season_id: S1, matches_played: 12, wins: 10, losses: 2, draws: 0, pick_count: 12, ban_count: 0 },
        { faction_id: 'kislev', season_id: S1, matches_played: 15, wins: 11, losses: 4, draws: 0, pick_count: 15, ban_count: 0 },
        { faction_id: 'lizardmen', season_id: S1, matches_played: 18, wins: 12, losses: 6, draws: 0, pick_count: 18, ban_count: 0 },
      ],
      skipDuplicates: true,
    });

    const res = await app.inject({ method: 'GET', url: `/api/meta/overview?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season: { id: string; is_active: boolean };
      top_factions_by_winrate: Array<{ faction: { id: string }; stats: { win_rate: number } }>;
      top_factions_by_pickrate: Array<{ faction: { id: string }; stats: { matches_played: number } }>;
      total_games: number;
      faction_diversity: number;
    }>();

    expect(body.season.id).toBe(S1);
    expect(body.season.is_active).toBe(true);

    // top by winrate: dwarfs 10/12≈0.833, empire 15/20=0.75, kislev 11/15≈0.733, ...
    // high_elves has 10 matches (exactly min) so included
    expect(body.top_factions_by_winrate.length).toBeGreaterThanOrEqual(1);
    expect(body.top_factions_by_winrate.length).toBeLessThanOrEqual(5);
    const topWr = body.top_factions_by_winrate[0]!;
    expect(topWr.faction.id).toBe('dwarfs');

    // top by pickrate: lizardmen 18, empire 20 ...
    expect(body.top_factions_by_pickrate.length).toBeGreaterThanOrEqual(1);
    const topPick = body.top_factions_by_pickrate[0]!;
    expect(topPick.stats.matches_played).toBe(20); // empire has most

    // total_games now counts real MatchGame/Match rows globally (not FactionStats
    // aggregates), so its exact value depends on other match data in the DB. Assert
    // only that the field is present and non-negative; the counting itself is covered
    // by the tournament-lifecycle tests.
    expect(typeof body.total_games).toBe('number');
    expect(body.total_games).toBeGreaterThanOrEqual(0);

    // faction_diversity is Pielou's J (normalised Shannon entropy) over the 5 seeded
    // factions with matches [20,10,12,15,18] → ~0.981 (near-even distribution).
    expect(body.faction_diversity).toBeCloseTo(0.981, 2);
  });

  it('6. filters top_by_winrate to min 10 matches', async () => {
    await seedSeason();

    // Seed one faction with < 10 matches (high win_rate) and one with >= 10
    await prisma.factionStats.createMany({
      data: [
        { faction_id: 'empire', season_id: S1, matches_played: 5, wins: 5, losses: 0, draws: 0, pick_count: 5, ban_count: 0 },
        { faction_id: 'bretonnia', season_id: S1, matches_played: 10, wins: 6, losses: 4, draws: 0, pick_count: 10, ban_count: 0 },
      ],
      skipDuplicates: true,
    });

    const res = await app.inject({ method: 'GET', url: `/api/meta/overview?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      top_factions_by_winrate: Array<{ faction: { id: string }; stats: { win_rate: number } }>;
    }>();

    // empire has 5 matches → excluded from winrate top despite 100% winrate
    const empireInTopWr = body.top_factions_by_winrate.find((f) => f.faction.id === 'empire');
    expect(empireInTopWr).toBeUndefined();

    // bretonnia has 10 matches → included
    const bretonniaInTopWr = body.top_factions_by_winrate.find((f) => f.faction.id === 'bretonnia');
    expect(bretonniaInTopWr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/meta/matchups (stub)
// ---------------------------------------------------------------------------

describe('GET /api/meta/matchups', () => {
  it('returns stub response with season_id, empty cells, and all 24 factions', async () => {
    await seedSeason();

    const res = await app.inject({ method: 'GET', url: `/api/meta/matchups?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season_id: string;
      cells: unknown[];
      factions: Array<{ id: string }>;
    }>();

    expect(body.season_id).toBe(S1);
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells).toHaveLength(0); // no MatchupStats seeded
    expect(body.factions).toHaveLength(24);
  });

  it('returns cells when MatchupStats exist', async () => {
    await seedSeason();

    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'bretonnia',
        faction_b_id: 'empire',
        season_id: S1,
        faction_a_wins: 3,
        faction_b_wins: 7,
        draws: 0,
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/meta/matchups?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      season_id: string;
      cells: Array<{
        faction_a_id: string;
        faction_b_id: string;
        faction_a_wins: number;
        faction_b_wins: number;
        total: number;
        winrate_a: number | null;
      }>;
      factions: unknown[];
    }>();

    expect(body.cells).toHaveLength(1);
    const cell = body.cells[0]!;
    expect(cell.faction_a_id).toBe('bretonnia');
    expect(cell.faction_b_id).toBe('empire');
    expect(cell.faction_a_wins).toBe(3);
    expect(cell.faction_b_wins).toBe(7);
    expect(cell.total).toBe(10);
    expect(cell.winrate_a).toBeCloseTo(0.3);
  });
});
