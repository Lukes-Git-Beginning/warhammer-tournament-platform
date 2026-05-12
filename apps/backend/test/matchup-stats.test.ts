import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'a0000000-0000-0000-0000-000000000001'; // season
const U1 = 'b0000000-0000-0000-0000-000000000001'; // player1 (organizer)
const U2 = 'b0000000-0000-0000-0000-000000000002'; // player2
const T1 = 'c0000000-0000-0000-0000-000000000001'; // tournament

// Factions used across tests (must exist in DB — seeded at startup)
const EMPIRE = 'empire';
const BRETONNIA = 'bretonnia';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Cleanup helper — removes all data created by these tests in dependency order
// ---------------------------------------------------------------------------

async function cleanup() {
  await prisma.matchupStats.deleteMany({ where: { season_id: S1 } });
  await prisma.factionStats.deleteMany({ where: { season_id: S1 } });
  await prisma.auditLog.deleteMany({ where: { entity_type: 'Match' } });
  await prisma.match.deleteMany({ where: { tournament_id: T1 } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: T1 } });
  await prisma.tournament.deleteMany({ where: { id: T1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
  await prisma.user.deleteMany({ where: { id: { in: [U1, U2] } } });
}

beforeEach(cleanup);

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedBase() {
  await prisma.user.createMany({
    data: [
      { id: U1, discord_id: 'disc_mu_1', username: 'EmpirePlayer', email: null },
      { id: U2, discord_id: 'disc_mu_2', username: 'BretonniaPlayer', email: null },
    ],
    skipDuplicates: true,
  });

  await prisma.season.create({
    data: {
      id: S1,
      name: 'MatchupStats Test Season',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: true,
    },
  });

  // Deactivate any other active seasons that could interfere
  await prisma.season.updateMany({
    where: { is_active: true, id: { not: S1 } },
    data: { is_active: false },
  });

  await prisma.tournament.create({
    data: {
      id: T1,
      slug: 'matchup-test-tournament',
      name: 'Matchup Test Tournament',
      organizer_id: U1,
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
  });
}

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
      tournament_id: T1,
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

function makeToken(userId: string, role: 'ADMIN' | 'ORGANIZER' | 'USER' = 'ADMIN') {
  return app.jwt.sign({ sub: userId, discord_id: 'disc_mu_1', username: 'EmpirePlayer', role });
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
    await seedBase();
    const M = 'e0000000-0000-0000-0000-000000000001';
    await createMatch({ matchId: M, p1Id: U1, p2Id: U2, p1Faction: EMPIRE, p2Faction: BRETONNIA });

    const res = await reportResult({ matchId: M, winnerId: U1, token: makeToken(U1) });
    expect(res.statusCode).toBe(200);

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: S1,
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
    await seedBase();
    const M = 'e0000000-0000-0000-0000-000000000002';
    await createMatch({ matchId: M, p1Id: U1, p2Id: U2, p1Faction: EMPIRE, p2Faction: EMPIRE });

    const res = await reportResult({ matchId: M, winnerId: U1, token: makeToken(U1) });
    expect(res.statusCode).toBe(200);

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: EMPIRE,
          faction_b_id: EMPIRE,
          season_id: S1,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_a_wins).toBe(1);
    expect(row!.faction_b_wins).toBe(0);
    expect(row!.draws).toBe(0);
  });

  it('3. Inkrement: 2× empire wins vs bretonnia → faction_b_wins=2', async () => {
    await seedBase();
    const M1 = 'e0000000-0000-0000-0000-000000000003';
    const M2 = 'e0000000-0000-0000-0000-000000000004';

    await createMatch({ matchId: M1, p1Id: U1, p2Id: U2, p1Faction: EMPIRE, p2Faction: BRETONNIA });
    const res1 = await reportResult({ matchId: M1, winnerId: U1, token: makeToken(U1) });
    expect(res1.statusCode).toBe(200);

    // Second match — player positions flipped so both can play
    await createMatch({ matchId: M2, p1Id: U2, p2Id: U1, p1Faction: BRETONNIA, p2Faction: EMPIRE });
    const res2 = await reportResult({ matchId: M2, winnerId: U1, token: makeToken(U1) });
    expect(res2.statusCode).toBe(200);

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: S1,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_b_wins).toBe(2);
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.draws).toBe(0);
  });

  it('4. Seitensymmetrie: egal ob p1=empire/p2=bretonnia oder umgekehrt → selber Row', async () => {
    await seedBase();
    // Match A: p1=empire wins vs p2=bretonnia
    const MA = 'e0000000-0000-0000-0000-000000000005';
    await createMatch({ matchId: MA, p1Id: U1, p2Id: U2, p1Faction: EMPIRE, p2Faction: BRETONNIA });
    await reportResult({ matchId: MA, winnerId: U1, token: makeToken(U1) });

    // Match B: p1=bretonnia, p2=empire, empire (U1) wins
    const MB = 'e0000000-0000-0000-0000-000000000006';
    await createMatch({ matchId: MB, p1Id: U2, p2Id: U1, p1Faction: BRETONNIA, p2Faction: EMPIRE });
    await reportResult({ matchId: MB, winnerId: U1, token: makeToken(U1) });

    // Only one row should exist (symmetric key)
    const rows = await prisma.matchupStats.findMany({ where: { season_id: S1 } });
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
    await seedBase();
    const M = 'e0000000-0000-0000-0000-000000000007';
    await createMatch({ matchId: M, p1Id: U1, p2Id: U2, p1Faction: EMPIRE, p2Faction: BRETONNIA });

    const res = await reportResult({ matchId: M, winnerId: null, token: makeToken(U1) });
    expect(res.statusCode).toBe(200);

    const row = await prisma.matchupStats.findUnique({
      where: {
        faction_a_id_faction_b_id_season_id: {
          faction_a_id: BRETONNIA,
          faction_b_id: EMPIRE,
          season_id: S1,
        },
      },
    });

    expect(row).not.toBeNull();
    expect(row!.faction_a_wins).toBe(0);
    expect(row!.faction_b_wins).toBe(0);
    expect(row!.draws).toBe(1);
  });
});
