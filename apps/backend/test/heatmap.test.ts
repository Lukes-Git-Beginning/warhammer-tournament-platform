import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { getMatchupMatrix } from '../src/lib/heatmap.js';
import { ensureMatchupPlayers, seedMatchupGames, cleanupMatchupGames } from './helpers/matchup-seed.js';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'd1000000-0000-0000-0000-000000000001'; // season for heatmap tests
const U1 = 'd1000000-0000-0000-0000-0000000000a1';
const U2 = 'd1000000-0000-0000-0000-0000000000a2';

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
  await cleanupMatchupGames(prisma, S1, [U1, U2]);
  await prisma.matchupStats.deleteMany({ where: { season_id: S1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
}

beforeEach(cleanup);

// ---------------------------------------------------------------------------
// Seed helpers
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
  await ensureMatchupPlayers(prisma, U1, U2, 'hm');
}

// Convenience: seed one matchup pairing as real games.
const seedMatchup = (p1f: string, p2f: string, results: Array<'P1' | 'P2' | 'D'>) =>
  seedMatchupGames(prisma, { seasonId: S1, u1: U1, u2: U2, p1f, p2f, results });

// ---------------------------------------------------------------------------
// Tests — getMatchupMatrix (lib) — now aggregated live from COMPLETED MatchGames
// ---------------------------------------------------------------------------

describe('getMatchupMatrix', () => {
  it('1. returns empty array for a season with no completed games', async () => {
    await seedSeason();
    const cells = await getMatchupMatrix(prisma, S1);
    expect(cells).toEqual([]);
  });

  it('2. computes correct total and winrate_a from seeded games', async () => {
    await seedSeason();

    // bretonnia (a) vs empire (b): 3 a_wins, 2 b_wins, 0 draws → total=5, winrate_a=0.6
    await seedMatchup('bretonnia', 'empire', ['P1', 'P1', 'P1', 'P2', 'P2']);
    // dwarfs (a) vs kislev (b): 1 a_win, 0 b_wins, 4 draws → total=5, winrate_a=0.2
    await seedMatchup('dwarfs', 'kislev', ['P1', 'D', 'D', 'D', 'D']);
    // high_elves (a) vs lizardmen (b): 0/0/7 → total=7, winrate_a=0.0 (defined, not null)
    await seedMatchup('high_elves', 'lizardmen', ['D', 'D', 'D', 'D', 'D', 'D', 'D']);

    const cells = await getMatchupMatrix(prisma, S1);
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

    // skaven (a) vs vampire_counts (b): 10 a_wins, 5 b_wins, 2 draws → total=17
    await seedMatchup('skaven', 'vampire_counts', [
      'P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P1',
      'P2', 'P2', 'P2', 'P2', 'P2',
      'D', 'D',
    ]);

    const cells = await getMatchupMatrix(prisma, S1);
    expect(cells).toHaveLength(1);

    const c = cells[0]!;
    expect(typeof c.faction_a_wins).toBe('number');
    expect(typeof c.faction_b_wins).toBe('number');
    expect(typeof c.draws).toBe('number');
    expect(typeof c.total).toBe('number');
    expect(typeof c.winrate_a).toBe('number');

    expect(c.total).toBe(17);
    expect(c.winrate_a).toBeCloseTo(10 / 17);
  });
});

// ---------------------------------------------------------------------------
// Tests — GET /api/meta/matchups (integration via HTTP)
// ---------------------------------------------------------------------------

describe('GET /api/meta/matchups — live aggregation', () => {
  it('4. returns empty cells for season with no completed games', async () => {
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

    // chaos_dwarfs (a) vs norsca (b): 6 a_wins, 4 b_wins, 0 draws → total=10, winrate_a=0.6
    await seedMatchup('chaos_dwarfs', 'norsca', ['P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P2', 'P2', 'P2', 'P2']);

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
