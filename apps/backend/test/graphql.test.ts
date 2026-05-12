import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'a9000000-0000-0000-0000-000000000001'; // season for graphql tests

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: false,
    withCron: false,
    withGraphql: true,
  });
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
      name: 'GraphQL Test Season',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: true,
    },
  });
}

async function seedFactionStats() {
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
        matches_played: 12,
        wins: 6,
        losses: 6,
        draws: 0,
        pick_count: 12,
        ban_count: 2,
      },
      {
        faction_id: 'dwarfs',
        season_id: S1,
        matches_played: 10,
        wins: 8,
        losses: 2,
        draws: 0,
        pick_count: 10,
        ban_count: 0,
      },
    ],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Helper: POST /graphql
// ---------------------------------------------------------------------------

function gql(query: string, variables?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/graphql',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ query, variables }),
  });
}

// ---------------------------------------------------------------------------
// Test 1: factions query — 24 entries, valid colorHex and initials
// ---------------------------------------------------------------------------

describe('GraphQL — factions query', () => {
  it('1. returns 24 factions with valid colorHex and initials', async () => {
    await seedSeason();

    const res = await gql(`
      query {
        factions(seasonId: "${S1}") {
          season {
            id
            name
            isActive
          }
          data {
            faction {
              id
              name
              colorHex
              initials
              displayOrder
            }
            stats {
              matchesPlayed
              wins
              winRate
            }
          }
        }
      }
    `);

    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: {
        factions: {
          season: { id: string; name: string; isActive: boolean };
          data: Array<{
            faction: {
              id: string;
              name: string;
              colorHex: string;
              initials: string;
              displayOrder: number;
            };
            stats: { matchesPlayed: number; wins: number; winRate: number | null } | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    }>();

    expect(body.errors).toBeUndefined();

    const { factions } = body.data;
    expect(factions.season.id).toBe(S1);
    expect(factions.season.isActive).toBe(true);
    expect(factions.data).toHaveLength(24);

    // All factions must have a non-empty colorHex (#RRGGBB) and 2-char initials
    for (const item of factions.data) {
      expect(item.faction.colorHex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(item.faction.initials).toHaveLength(2);
    }

    // Spot check empire
    const empire = factions.data.find((f) => f.faction.id === 'empire');
    expect(empire).toBeDefined();
    expect(empire!.faction.initials).toBe('EM');
    // No stats seeded yet → null
    expect(empire!.stats).toBeNull();

    // high_elves → "HE"
    const highElves = factions.data.find((f) => f.faction.id === 'high_elves');
    expect(highElves!.faction.initials).toBe('HE');
  });

  it('1b. stats fields are populated when FactionStats are seeded', async () => {
    await seedSeason();
    await seedFactionStats();

    const res = await gql(`
      query {
        factions(seasonId: "${S1}") {
          data {
            faction { id }
            stats { matchesPlayed wins losses draws winRate pickCount banCount }
          }
        }
      }
    `);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: {
        factions: {
          data: Array<{
            faction: { id: string };
            stats: {
              matchesPlayed: number;
              wins: number;
              losses: number;
              draws: number;
              winRate: number | null;
              pickCount: number;
              banCount: number;
            } | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    }>();

    expect(body.errors).toBeUndefined();

    const empire = body.data.factions.data.find((f) => f.faction.id === 'empire');
    expect(empire!.stats).not.toBeNull();
    expect(empire!.stats!.matchesPlayed).toBe(20);
    expect(empire!.stats!.wins).toBe(15);
    expect(empire!.stats!.winRate).toBeCloseTo(0.75);
    expect(empire!.stats!.pickCount).toBe(20);
    expect(empire!.stats!.banCount).toBe(0);

    const highElves = body.data.factions.data.find((f) => f.faction.id === 'high_elves');
    expect(highElves!.stats!.banCount).toBe(2);

    // Factions without seeded stats → null
    const skaven = body.data.factions.data.find((f) => f.faction.id === 'skaven');
    expect(skaven!.stats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: matchupHeatmap query
// ---------------------------------------------------------------------------

describe('GraphQL — matchupHeatmap query', () => {
  it('2. returns empty cells and 24 factions when no MatchupStats exist', async () => {
    await seedSeason();

    const res = await gql(`
      query {
        matchupHeatmap(seasonId: "${S1}") {
          seasonId
          factions { id name }
          cells {
            factionAId
            factionBId
            factionAWins
            factionBWins
            draws
            total
            winrateA
          }
        }
      }
    `);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: {
        matchupHeatmap: {
          seasonId: string;
          factions: Array<{ id: string; name: string }>;
          cells: Array<{
            factionAId: string;
            factionBId: string;
            factionAWins: number;
            factionBWins: number;
            draws: number;
            total: number;
            winrateA: number | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    }>();

    expect(body.errors).toBeUndefined();
    const heatmap = body.data.matchupHeatmap;
    expect(heatmap.seasonId).toBe(S1);
    expect(heatmap.factions).toHaveLength(24);
    expect(heatmap.cells).toHaveLength(0);
  });

  it('2b. returns correct cells when MatchupStats are seeded', async () => {
    await seedSeason();

    await prisma.matchupStats.create({
      data: {
        faction_a_id: 'bretonnia',
        faction_b_id: 'empire',
        season_id: S1,
        faction_a_wins: 4,
        faction_b_wins: 6,
        draws: 0,
      },
    });

    const res = await gql(`
      query {
        matchupHeatmap(seasonId: "${S1}") {
          cells {
            factionAId
            factionBId
            factionAWins
            factionBWins
            draws
            total
            winrateA
          }
          factions { id }
        }
      }
    `);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: {
        matchupHeatmap: {
          cells: Array<{
            factionAId: string;
            factionBId: string;
            factionAWins: number;
            factionBWins: number;
            draws: number;
            total: number;
            winrateA: number | null;
          }>;
          factions: Array<{ id: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    }>();

    expect(body.errors).toBeUndefined();
    const { cells, factions } = body.data.matchupHeatmap;
    expect(cells).toHaveLength(1);
    expect(factions).toHaveLength(24);

    const cell = cells[0]!;
    expect(cell.factionAId).toBe('bretonnia');
    expect(cell.factionBId).toBe('empire');
    expect(cell.factionAWins).toBe(4);
    expect(cell.factionBWins).toBe(6);
    expect(cell.draws).toBe(0);
    expect(cell.total).toBe(10);
    expect(cell.winrateA).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// Test 3: metaOverview query
// ---------------------------------------------------------------------------

describe('GraphQL — metaOverview query', () => {
  it('3. returns valid totalMatches and factionDiversity', async () => {
    await seedSeason();
    await seedFactionStats();

    const res = await gql(`
      query {
        metaOverview(seasonId: "${S1}") {
          season {
            id
            name
            isActive
          }
          totalMatches
          factionDiversity
          topFactionsByWinrate {
            faction { id name }
            stats { winRate matchesPlayed }
          }
          topFactionsByPickrate {
            faction { id }
            stats { matchesPlayed }
          }
        }
      }
    `);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: {
        metaOverview: {
          season: { id: string; name: string; isActive: boolean };
          totalMatches: number;
          factionDiversity: number;
          topFactionsByWinrate: Array<{
            faction: { id: string; name: string };
            stats: { winRate: number; matchesPlayed: number } | null;
          }>;
          topFactionsByPickrate: Array<{
            faction: { id: string };
            stats: { matchesPlayed: number } | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    }>();

    expect(body.errors).toBeUndefined();

    const overview = body.data.metaOverview;
    expect(overview.season.id).toBe(S1);
    expect(overview.season.isActive).toBe(true);

    // 3 factions seeded: empire 20, high_elves 12, dwarfs 10 → sum=42, total_matches=21
    expect(overview.totalMatches).toBe(21);

    // 3 factions with matches / 24
    expect(overview.factionDiversity).toBeCloseTo(3 / 24);

    // All three have ≥10 matches → eligible for winrate top
    // dwarfs 8/10=0.80 is highest → should be first
    expect(overview.topFactionsByWinrate.length).toBeGreaterThanOrEqual(1);
    expect(overview.topFactionsByWinrate[0]!.faction.id).toBe('dwarfs');

    // empire has most matches (20) → top pickrate entry
    expect(overview.topFactionsByPickrate[0]!.stats!.matchesPlayed).toBe(20);
  });

  it('3b. returns null when no active season exists', async () => {
    // no season seeded, no is_active=true
    const res = await gql(`
      query {
        metaOverview {
          totalMatches
          factionDiversity
        }
      }
    `);

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { metaOverview: null }; errors?: unknown[] }>();
    // No active season → resolver returns null → nullable field in schema
    expect(body.data.metaOverview).toBeNull();
  });
});
