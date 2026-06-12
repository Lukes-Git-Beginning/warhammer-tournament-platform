import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
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
// Per-test state — created fresh in beforeEach, cleaned up in afterEach
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

  testUser1 = await createTestUser({ username: 'EmpirePlayer' });
  testUser2 = await createTestUser({ username: 'BretonniaPlayer' });
  testSeason = await createTestSeason({ is_active: true });
  testTournament = await createTestTournament({ organizerId: testUser1!.id });
});

afterEach(async () => {
  // Clean up in dependency order — scoped to this run's IDs only
  if (testTournament) await cleanupTournament(testTournament.id);
  if (testSeason) await cleanupSeason(testSeason!.id);
  const ids = [testUser1?.id, testUser2?.id].filter(Boolean) as string[];
  if (ids.length > 0) await cleanupUsers(ids);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createMatch(opts: {
  matchId: string;
  p1Id: string;
  p2Id: string;
  p1Faction?: string;
  p2Faction?: string;
}): Promise<string> {
  const { matchId, p1Id, p2Id, p1Faction, p2Faction } = opts;
  await prisma.match.create({
    data: {
      id: matchId,
      tournament_id: testTournament!.id,
      round: 1,
      match_number: parseInt(matchId.slice(-4), 16) % 1000 || 1,
      player1_id: p1Id,
      player2_id: p2Id,
      status: 'PENDING',
      ...(p1Faction ? { player1_faction_id: p1Faction } : {}),
      ...(p2Faction ? { player2_faction_id: p2Faction } : {}),
    },
  });
  return matchId;
}

function makeToken(userId: string, role: 'ADMIN' | 'HOST' | 'ORGANIZER' | 'USER' = 'ADMIN') {
  return app.jwt.sign({
    sub: userId,
    discord_id: testUser1!.discord_id,
    username: testUser1!.username,
    role,
  });
}

async function reportResult(opts: {
  matchId: string;
  winnerId: string | null;
  p1Faction?: string;
  p2Faction?: string;
  token: string;
}) {
  return app.inject({
    method: 'POST',
    url: `/api/matches/${opts.matchId}/result`,
    headers: { cookie: `auth_token=${opts.token}` },
    payload: {
      winnerId: opts.winnerId,
      ...(opts.p1Faction ? { player1FactionId: opts.p1Faction } : {}),
      ...(opts.p2Faction ? { player2FactionId: opts.p2Faction } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MatchupStats — POST /api/matches/:id/result', () => {
  it('1. Normal-Match: empire (p1) wins vs bretonnia (p2) → faction_b_wins=1 (empire is b in sort)', async () => {
    // sort(['empire', 'bretonnia']) → ['bretonnia', 'empire'] → aId='bretonnia', bId='empire'
    // winner=empire → winnerIsA = (empire === bretonnia) = false → faction_b_wins=1
    const M = randomUUID();
    await createMatch({ matchId: M, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });

    const res = await reportResult({ matchId: M, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(res.statusCode).toBe(200);

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

  it('2. Mirror-Match: empire vs empire, p1 wins → single row with faction_a_wins=1', async () => {
    // sort(['empire', 'empire']) → ['empire', 'empire'] → aId=bId='empire'
    // winner=p1 (empire) → winnerFactionId='empire' === aId='empire' → winnerIsA=true → faction_a_wins=1
    const M = randomUUID();
    await createMatch({ matchId: M, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: EMPIRE });

    const res = await reportResult({ matchId: M, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(res.statusCode).toBe(200);

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: EMPIRE,
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

  it('3. Inkrement: 2× empire wins vs bretonnia → faction_b_wins=2', async () => {
    const M1 = randomUUID();
    const M2 = randomUUID();

    await createMatch({ matchId: M1, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });
    const res1 = await reportResult({ matchId: M1, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(res1.statusCode).toBe(200);

    // Second match — player positions flipped so both can play
    await createMatch({ matchId: M2, p1Id: testUser2!.id, p2Id: testUser1!.id, p1Faction: BRETONNIA, p2Faction: EMPIRE });
    const res2 = await reportResult({ matchId: M2, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(res2.statusCode).toBe(200);

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
    expect(row!.faction_b_wins).toBe(2);
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.draws).toBe(0);
  });

  it('4. Seitensymmetrie: egal ob p1=empire/p2=bretonnia oder umgekehrt → selber Row', async () => {
    // Match A: p1=empire wins vs p2=bretonnia
    const MA = randomUUID();
    await createMatch({ matchId: MA, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });
    await reportResult({ matchId: MA, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });

    // Match B: p1=bretonnia, p2=empire, empire (testUser1) wins
    const MB = randomUUID();
    await createMatch({ matchId: MB, p1Id: testUser2!.id, p2Id: testUser1!.id, p1Faction: BRETONNIA, p2Faction: EMPIRE });
    await reportResult({ matchId: MB, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });

    // Only one row should exist (symmetric key)
    const rows = await prisma.matchupStats.findMany({ where: { season_id: testSeason!.id } });
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.faction_a_id).toBe(BRETONNIA);
    expect(row.faction_b_id).toBe(EMPIRE);
    // empire won both times → faction_b_wins=2
    expect(row.faction_b_wins).toBe(2);
    expect(row.faction_a_wins).toBe(0);
    expect(row.draws).toBe(0);
  });

  it('5. Draw: winnerId=null → draws=1, faction_a_wins=0, faction_b_wins=0', async () => {
    const M = randomUUID();
    await createMatch({ matchId: M, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });

    const res = await reportResult({ matchId: M, winnerId: null, token: makeToken(testUser1!.id) });
    expect(res.statusCode).toBe(200);

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
});

// ---------------------------------------------------------------------------
// FactionStats pick_count — M5.1.2
// ---------------------------------------------------------------------------

describe('FactionStats pick_count — POST /api/matches/:id/result', () => {
  it('increments pick_count on match-result-report (create path: pick_count=1)', async () => {
    const M = randomUUID();
    await createMatch({ matchId: M, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });

    const res = await reportResult({ matchId: M, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(res.statusCode).toBe(200);

    const empireStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: EMPIRE, season_id: testSeason!.id } },
    });
    const bretonniaStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: BRETONNIA, season_id: testSeason!.id } },
    });

    expect(empireStats).not.toBeNull();
    expect(empireStats!.pick_count).toBe(1);
    expect(bretonniaStats).not.toBeNull();
    expect(bretonniaStats!.pick_count).toBe(1);
  });

  it('increments pick_count on match-result-report (update path: pick_count=2 after two matches)', async () => {
    const M1 = randomUUID();
    const M2 = randomUUID();

    await createMatch({ matchId: M1, p1Id: testUser1!.id, p2Id: testUser2!.id, p1Faction: EMPIRE, p2Faction: BRETONNIA });
    const r1 = await reportResult({ matchId: M1, winnerId: testUser1!.id, token: makeToken(testUser1!.id) });
    expect(r1.statusCode).toBe(200);

    await createMatch({ matchId: M2, p1Id: testUser2!.id, p2Id: testUser1!.id, p1Faction: BRETONNIA, p2Faction: EMPIRE });
    const r2 = await reportResult({ matchId: M2, winnerId: testUser2!.id, token: makeToken(testUser1!.id) });
    expect(r2.statusCode).toBe(200);

    const empireStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: EMPIRE, season_id: testSeason!.id } },
    });
    const bretonniaStats = await prisma.factionStats.findUnique({
      where: { faction_id_season_id: { faction_id: BRETONNIA, season_id: testSeason!.id } },
    });

    // Beide Fraktionen wurden je 2× gespielt
    expect(empireStats!.pick_count).toBe(2);
    expect(bretonniaStats!.pick_count).toBe(2);
  });
});
