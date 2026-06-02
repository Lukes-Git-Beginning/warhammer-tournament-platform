/**
 * Unit tests for resolveMatchResult() — verifies that the Welle-D dual-submit
 * path writes MatchupStats and FactionStats identically to the legacy
 * POST /:id/result route in routes/matches.ts.
 *
 * Test isolation: each test creates its own Season/Faction/User/Match seeds
 * and cleans up after itself. No HTTP layer — calls the service function directly.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { resolveMatchResult } from '../src/lib/match-result-service.js';
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

// Factions used across tests (must exist in DB — seeded at startup)
const EMPIRE = 'empire';
const BRETONNIA = 'bretonnia';
// sort(['bretonnia', 'empire']) → ['bretonnia', 'empire'] → aId='bretonnia', bId='empire'

// ---------------------------------------------------------------------------
// App lifecycle (needed for Prisma plugin + connection pool)
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
// Per-test state
// ---------------------------------------------------------------------------

let testUser1: TestUser | undefined;
let testUser2: TestUser | undefined;
let testSeason: TestSeason | undefined;
let testTournament: TestTournament | undefined;

beforeEach(async () => {
  testUser1 = undefined;
  testUser2 = undefined;
  testSeason = undefined;
  testTournament = undefined;

  testUser1 = await createTestUser({ username: 'ServiceTestP1' });
  testUser2 = await createTestUser({ username: 'ServiceTestP2' });
  testSeason = await createTestSeason({ is_active: true });
  testTournament = await createTestTournament({ organizerId: testUser1!.id });
});

afterEach(async () => {
  if (testTournament) await cleanupTournament(testTournament.id);
  if (testSeason) await cleanupSeason(testSeason!.id);
  const ids = [testUser1?.id, testUser2?.id].filter(Boolean) as string[];
  if (ids.length > 0) await cleanupUsers(ids);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Monotonic match_number so every match in the shared testTournament stays unique
// on (tournament_id, round, match_number) — multiple matches per test otherwise collide.
let matchNumberSeq = 0;

async function createMatch(opts: {
  p1Id: string;
  p2Id: string;
  p1Faction?: string;
  p2Faction?: string;
  status?: 'PENDING' | 'ONGOING';
}): Promise<string> {
  const matchId = randomUUID();
  const { p1Id, p2Id, p1Faction, p2Faction, status = 'ONGOING' } = opts;

  await prisma.match.create({
    data: {
      id: matchId,
      tournament_id: testTournament!.id,
      round: 1,
      match_number: (matchNumberSeq += 1),
      player1_id: p1Id,
      player2_id: p2Id,
      status,
      ...(p1Faction ? { player1_faction_id: p1Faction } : {}),
      ...(p2Faction ? { player2_faction_id: p2Faction } : {}),
    },
  });

  return matchId;
}

// ---------------------------------------------------------------------------
// MatchupStats — resolveMatchResult() dual-submit path
// ---------------------------------------------------------------------------

describe('resolveMatchResult() — MatchupStats + FactionStats (Welle-D path)', () => {
  it('PLAYER1_WIN: empire (p1) vs bretonnia (p2) → faction_b_wins=1 (empire sorts as b)', async () => {
    // sort(['empire', 'bretonnia']) → ['bretonnia', 'empire']
    // aId='bretonnia', bId='empire'
    // winner=empire (p1) → winnerFactionId='empire' === aId='bretonnia'? NO → winnerIsA=false → faction_b_wins=1
    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });

    await resolveMatchResult(prisma, matchId, 'PLAYER1_WIN', { actorId: testUser1!.id });

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: testSeason!.id,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_a_id).toBe(BRETONNIA);
    expect(row!.faction_b_id).toBe(EMPIRE);
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.faction_b_wins).toBe(1);
    expect(row!.draws).toBe(0);
  });

  it('PLAYER2_WIN: empire (p1) vs bretonnia (p2), p2 wins → faction_a_wins=1 (bretonnia sorts as a)', async () => {
    // sort(['empire', 'bretonnia']) → ['bretonnia', 'empire']
    // aId='bretonnia', bId='empire'
    // winner=bretonnia (p2) → winnerFactionId='bretonnia' === aId='bretonnia'? YES → winnerIsA=true → faction_a_wins=1
    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });

    await resolveMatchResult(prisma, matchId, 'PLAYER2_WIN', { actorId: testUser2!.id });

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: testSeason!.id,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_a_wins).toBe(1);
    expect(row!.faction_b_wins).toBe(0);
    expect(row!.draws).toBe(0);
  });

  it('DRAW: empire vs bretonnia → draws=1, both wins=0', async () => {
    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });

    await resolveMatchResult(prisma, matchId, 'DRAW', { actorId: testUser1!.id });

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: testSeason!.id,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.faction_b_wins).toBe(0);
    expect(row!.draws).toBe(1);
  });

  it('No faction IDs → no MatchupStats row created', async () => {
    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      // deliberately no factions
    });

    await resolveMatchResult(prisma, matchId, 'PLAYER1_WIN', { actorId: testUser1!.id });

    const rows = await prisma.matchupStats.findMany({
      where: { season_id: testSeason!.id },
    });

    expect(rows).toHaveLength(0);
  });

  it('No active season → no MatchupStats row created', async () => {
    // Override: create an INACTIVE season specifically for this test
    const inactiveSeason = await createTestSeason({ is_active: false });
    // Mark our normally-active season as inactive so the service sees no active season
    await prisma.season.update({
      where: { id: testSeason!.id },
      data: { is_active: false },
    });

    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });

    await resolveMatchResult(prisma, matchId, 'PLAYER1_WIN', { actorId: testUser1!.id });

    const rows = await prisma.matchupStats.findMany({
      where: { season_id: inactiveSeason.id },
    });
    expect(rows).toHaveLength(0);

    // Restore active state to avoid cross-test pollution (beforeEach cleans testSeason)
    await prisma.season.update({
      where: { id: testSeason!.id },
      data: { is_active: true },
    });
    await cleanupSeason(inactiveSeason.id);
  });

  it('FactionStats: empire wins → wins=1 for empire, losses=1 for bretonnia', async () => {
    const matchId = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });

    await resolveMatchResult(prisma, matchId, 'PLAYER1_WIN', { actorId: testUser1!.id });

    const empireStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: EMPIRE, season_id: testSeason!.id } },
    });
    const bretonniaStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: BRETONNIA, season_id: testSeason!.id } },
    });

    expect(empireStats).not.toBeNull();
    expect(empireStats!.wins).toBe(1);
    expect(empireStats!.losses).toBe(0);
    expect(empireStats!.matches_played).toBe(1);
    expect(empireStats!.pick_count).toBe(1);

    expect(bretonniaStats).not.toBeNull();
    expect(bretonniaStats!.wins).toBe(0);
    expect(bretonniaStats!.losses).toBe(1);
    expect(bretonniaStats!.matches_played).toBe(1);
    expect(bretonniaStats!.pick_count).toBe(1);
  });

  it('Increment: 2× PLAYER1_WIN (empire) → faction_b_wins=2 after two resolveMatchResult calls', async () => {
    // Match 1: p1=empire, p2=bretonnia, empire wins
    const m1 = await createMatch({
      p1Id: testUser1!.id,
      p2Id: testUser2!.id,
      p1Faction: EMPIRE,
      p2Faction: BRETONNIA,
    });
    await resolveMatchResult(prisma, m1, 'PLAYER1_WIN', { actorId: testUser1!.id });

    // Match 2: positions flipped so same factions, empire (now p2) wins
    const m2 = await createMatch({
      p1Id: testUser2!.id,
      p2Id: testUser1!.id,
      p1Faction: BRETONNIA,
      p2Faction: EMPIRE,
    });
    await resolveMatchResult(prisma, m2, 'PLAYER2_WIN', { actorId: testUser1!.id });

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: testSeason!.id,
        },
      },
    });

    expect(row).not.toBeNull();
    // empire (bId) won both times
    expect(row!.faction_b_wins).toBe(2);
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.draws).toBe(0);

    // Only one row (symmetric key)
    const allRows = await prisma.matchupStats.findMany({ where: { season_id: testSeason!.id } });
    expect(allRows).toHaveLength(1);
  });
});
