import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { getMatchupMatrix } from '../src/lib/heatmap.js';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'd1000000-0000-0000-0000-000000000001'; // season for heatmap tests

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
  await prisma.matchupStats.deleteMany({ where: { season_id: S1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
}

beforeEach(cleanup);

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------

async function seedSeason() {
  await prisma.season.create({
    data: {
      id: S1,
      name: 'Heatmap Test Season',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests — getMatchupMatrix (lib)
// ---------------------------------------------------------------------------

describe('getMatchupMatrix', () => {
  it('1. returns empty array for a season with no MatchupStats rows', async () => {
    await seedSeason();
    const cells = await getMatchupMatrix(prisma, S1);
    expect(cells).toEqual([]);
  });

  it('2. computes correct total and winrate_a from seeded rows', async () => {
    await seedSeason();

    // bretonnia (a) vs empire (b): 3 a_wins, 2 b_wins, 0 draws
    // → total=5, winrate_a=3/5=0.6
    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'bretonnia',
        faction_b_id: 'empire',
        season_id: S1,
        faction_a_wins: 3,
        faction_b_wins: 2,
        draws: 0,
      },
    });

    // dwarfs (a) vs kislev (b): 1 a_wins, 0 b_wins, 4 draws
    // → total=5, winrate_a=1/5=0.2
    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'dwarfs',
        faction_b_id: 'kislev',
        season_id: S1,
        faction_a_wins: 1,
        faction_b_wins: 0,
        draws: 4,
      },
    });

    // high_elves (a) vs lizardmen (b): 0 a_wins, 0 b_wins, 7 draws
    // → total=7, winrate_a=0/7=0.0 (not null — 0 wins is still a defined rate)
    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'high_elves',
        faction_b_id: 'lizardmen',
        season_id: S1,
        faction_a_wins: 0,
        faction_b_wins: 0,
        draws: 7,
      },
    });

    const cells = await getMatchupMatrix(prisma, S1);

    // Results are ordered by faction_a_id, faction_b_id
    expect(cells).toHaveLength(3);

    const bretonnia = cells.find(
      (c) => c.faction_a_id === 'bretonnia' && c.faction_b_id === 'empire',
    );
    expect(bretonnia).toBeDefined();
    expect(bretonnia!.faction_a_wins).toBe(3);
    expect(bretonnia!.faction_b_wins).toBe(2);
    expect(bretonnia!.draws).toBe(0);
    expect(bretonnia!.total).toBe(5);
    expect(bretonnia!.winrate_a).toBeCloseTo(0.6);

    const dwarfs = cells.find(
      (c) => c.faction_a_id === 'dwarfs' && c.faction_b_id === 'kislev',
    );
    expect(dwarfs).toBeDefined();
    expect(dwarfs!.total).toBe(5);
    expect(dwarfs!.winrate_a).toBeCloseTo(0.2);

    // 0 a_wins with 7 draws → winrate_a should be 0.0, not null
    const highElves = cells.find(
      (c) => c.faction_a_id === 'high_elves' && c.faction_b_id === 'lizardmen',
    );
    expect(highElves).toBeDefined();
    expect(highElves!.total).toBe(7);
    expect(highElves!.winrate_a).toBeCloseTo(0.0);
  });

  it('3. all returned values are JS numbers (no BigInt or string leakage)', async () => {
    await seedSeason();

    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'skaven',
        faction_b_id: 'vampire_counts',
        season_id: S1,
        faction_a_wins: 10,
        faction_b_wins: 5,
        draws: 2,
      },
    });

    const cells = await getMatchupMatrix(prisma, S1);
    expect(cells).toHaveLength(1);

    const c = cells[0]!;
    expect(typeof c.faction_a_wins).toBe('number');
    expect(typeof c.faction_b_wins).toBe('number');
    expect(typeof c.draws).toBe('number');
    expect(typeof c.total).toBe('number');
    expect(typeof c.winrate_a).toBe('number');

    // Verify values: 10+5+2=17 total, 10/17 winrate_a
    expect(c.total).toBe(17);
    expect(c.winrate_a).toBeCloseTo(10 / 17);
  });
});

// ---------------------------------------------------------------------------
// Tests — GET /api/meta/matchups (integration via HTTP)
// ---------------------------------------------------------------------------

describe('GET /api/meta/matchups — with real $queryRaw aggregation', () => {
  it('4. returns empty cells for season with no MatchupStats', async () => {
    await seedSeason();

    const res = await app.inject({ method: 'GET', url: `/api/meta/matchups?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ season_id: string; cells: unknown[]; factions: unknown[] }>();
    expect(body.season_id).toBe(S1);
    expect(body.cells).toHaveLength(0);
    expect(body.factions).toHaveLength(24);
  });

  it('5. returns correct aggregated cell via HTTP route', async () => {
    await seedSeason();

    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'chaos_dwarfs',
        faction_b_id: 'norsca',
        season_id: S1,
        faction_a_wins: 6,
        faction_b_wins: 4,
        draws: 0,
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/meta/matchups?seasonId=${S1}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      cells: Array<{
        faction_a_id: string;
        faction_b_id: string;
        faction_a_wins: number;
        faction_b_wins: number;
        draws: number;
        total: number;
        winrate_a: number | null;
      }>;
    }>();

    expect(body.cells).toHaveLength(1);
    const cell = body.cells[0]!;
    expect(cell.faction_a_id).toBe('chaos_dwarfs');
    expect(cell.faction_b_id).toBe('norsca');
    expect(cell.faction_a_wins).toBe(6);
    expect(cell.faction_b_wins).toBe(4);
    expect(cell.draws).toBe(0);
    expect(cell.total).toBe(10);
    expect(cell.winrate_a).toBeCloseTo(0.6);
  });
});
