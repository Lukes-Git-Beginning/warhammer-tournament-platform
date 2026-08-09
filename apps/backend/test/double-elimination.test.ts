/**
 * Tests for double-elimination bracket generation and HTTP integration.
 *
 * Current structure (R_L = 2*R_W - 2, no reset match — GF is Bo3):
 *
 * 4-player (S=4, R_W=2, R_L=2):
 *   WB: R1(2) + WB-Final(1) = 3
 *   LB: r=0→1, r=1→1 = 2
 *   GF: 1   →  Total = 6
 *
 * 8-player (S=8, R_W=3, R_L=4):
 *   WB: 4+2+1 = 7
 *   LB: r=0→2, r=1→2, r=2→1, r=3→1 = 6
 *   GF: 1   →  Total = 14
 *
 * 16-player (S=16, R_W=4, R_L=6):
 *   WB: 8+4+2+1 = 15
 *   LB: r=0→4, r=1→4, r=2→2, r=3→2, r=4→1, r=5→1 = 14
 *   GF: 1   →  Total = 30
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { generateDoubleElim } from '../src/lib/bracket.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  );
}

const T_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Unit tests — generateDoubleElim() (no DB required)
// ---------------------------------------------------------------------------

describe('generateDoubleElim — structure', () => {
  it('4-player → 7 matches total (bracket reset on by default)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    expect(matches).toHaveLength(7);
  });

  it('4-player → 6 matches total when the bracket reset is off', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4), { bracketReset: false });
    expect(matches).toHaveLength(6);
    const gf = matches.filter((m) => m.bracket_side === 'GRAND_FINAL');
    expect(gf).toHaveLength(1); // single decisive final
    expect(gf[0]!.next_match_id).toBeNull();
  });

  it('4-player → correct bracket_side distribution (with reset)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const winners = matches.filter((m) => m.bracket_side === 'WINNERS');
    const losers = matches.filter((m) => m.bracket_side === 'LOSERS');
    const gf = matches.filter((m) => m.bracket_side === 'GRAND_FINAL');

    expect(winners).toHaveLength(3);
    expect(losers).toHaveLength(2);
    expect(gf).toHaveLength(2); // Grand Final + bracket-reset GF
  });

  it('4-player → the GF points to the reset match (higher round, null next)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const gfMatches = matches.filter((m) => m.bracket_side === 'GRAND_FINAL').sort((a, b) => a.round - b.round);
    expect(gfMatches).toHaveLength(2);
    const [gf, reset] = gfMatches;
    expect(gf!.next_match_id).toBe(reset!.id);
    expect(reset!.round).toBeGreaterThan(gf!.round);
    expect(reset!.next_match_id).toBeNull();
  });

  it('4-player → Grand Final has PLAYOFF_FINAL phase label', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const gf = matches.find((m) => m.bracket_side === 'GRAND_FINAL');
    expect(gf?.phase).toBe('PLAYOFF_FINAL');
  });

  it('4-player → WB Final and LB Final have PLAYOFF_SF phase label', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const sfMatches = matches.filter((m) => m.phase === 'PLAYOFF_SF');
    expect(sfMatches).toHaveLength(2); // WB Final + LB Final
    expect(sfMatches.every((m) => m.bracket_side === 'WINNERS' || m.bracket_side === 'LOSERS')).toBe(true);
  });

  it('4-player → WB R1 loser_next_match_id points into LOSERS bracket', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const allIds = new Set(matches.map((m) => m.id));
    const lbIds = new Set(
      matches.filter((m) => m.bracket_side === 'LOSERS').map((m) => m.id),
    );

    const wbR1 = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1).toHaveLength(2);

    for (const m of wbR1) {
      expect(m.loser_next_match_id).not.toBeNull();
      expect(allIds.has(m.loser_next_match_id!)).toBe(true);
      expect(lbIds.has(m.loser_next_match_id!)).toBe(true);
    }
  });

  it('4-player → all loser_next_match_ids (non-null) point to existing matches', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const allIds = new Set(matches.map((m) => m.id));
    for (const m of matches) {
      if (m.loser_next_match_id !== null) {
        expect(allIds.has(m.loser_next_match_id)).toBe(true);
      }
    }
  });

  it('4-player → all next_match_ids (non-null) point to existing matches', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const allIds = new Set(matches.map((m) => m.id));
    for (const m of matches) {
      if (m.next_match_id !== null) {
        expect(allIds.has(m.next_match_id)).toBe(true);
      }
    }
  });

  it('8-player → 15 matches total (bracket reset on)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    expect(matches).toHaveLength(15);
  });

  it('8-player → 7 WB + 6 LB + 2 GRAND_FINAL (GF + reset)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    expect(matches.filter((m) => m.bracket_side === 'WINNERS')).toHaveLength(7);
    expect(matches.filter((m) => m.bracket_side === 'LOSERS')).toHaveLength(6);
    expect(matches.filter((m) => m.bracket_side === 'GRAND_FINAL')).toHaveLength(2);
  });

  it('8-player → no duplicate (round, match_number) pairs', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    const keys = matches.map((m) => `${m.round}:${m.match_number}`);
    expect(new Set(keys).size).toBe(matches.length);
  });

  it('8-player → sorted by (round, match_number)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1]!;
      const curr = matches[i]!;
      expect(prev.round * 10000 + prev.match_number).toBeLessThanOrEqual(
        curr.round * 10000 + curr.match_number,
      );
    }
  });

  it('16-player → 31 matches total (bracket reset on)', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(16));
    expect(matches).toHaveLength(31);
  });

  it('16-player → no duplicate (round, match_number) pairs', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(16));
    const keys = matches.map((m) => `${m.round}:${m.match_number}`);
    expect(new Set(keys).size).toBe(matches.length);
  });

  // Non-power-of-2: 5 players → padded to S=8 → same structure as 8 players = 15 matches (incl. reset).
  it('5-player → padded to 8 (15 matches), 3 WB R1 BYE matches', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(5));
    expect(matches).toHaveLength(15);

    const wbR1 = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1).toHaveLength(4);

    const byeMatches = wbR1.filter((m) => m.status === 'BYE');
    expect(byeMatches).toHaveLength(3);

    for (const bye of byeMatches) {
      expect(bye.winner_id).not.toBeNull();
    }
  });

  it('5-player → all 3 BYE matches have winner_id set to distinct real players', () => {
    const ids = fakeIds(5);
    const matches = generateDoubleElim(T_ID, ids);

    const byeMatches = matches.filter(
      (m) => m.bracket_side === 'WINNERS' && m.round === 1 && m.status === 'BYE',
    );

    expect(byeMatches).toHaveLength(3);
    const byeWinners = byeMatches.map((bye) => bye.winner_id);

    for (const winner of byeWinners) {
      expect(winner).not.toBeNull();
      expect(ids.includes(winner!)).toBe(true);
    }

    expect(new Set(byeWinners).size).toBe(3);
  });

  it('all matches belong to the given tournamentId', () => {
    const matches = generateDoubleElim('custom-tid', fakeIds(4));
    for (const m of matches) {
      expect(m.tournament_id).toBe('custom-tid');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test — POST /api/tournaments/:id/start
// ---------------------------------------------------------------------------

const ORGANIZER_ID = '1c000000-0000-0000-0000-000000000001';
const PLAYER_A_ID  = '1c000000-0000-0000-0000-000000000002';
const PLAYER_B_ID  = '1c000000-0000-0000-0000-000000000003';
const PLAYER_C_ID  = '1c000000-0000-0000-0000-000000000004';

const TOURNAMENT_ID = '1c000000-0000-0000-0001-000000000001';

describe('POST /api/tournaments/:id/start — DOUBLE_ELIMINATION', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      withSocket: false,
      withRedis: false,
      withCron: false,
      withGraphql: false,
      withDraft: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { entity_id: TOURNAMENT_ID } });
    await prisma.auditLog.deleteMany({ where: { actor_id: ORGANIZER_ID } });
    await prisma.match.deleteMany({ where: { tournament_id: TOURNAMENT_ID } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: TOURNAMENT_ID } });
    await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [ORGANIZER_ID, PLAYER_A_ID, PLAYER_B_ID, PLAYER_C_ID] } },
    });
  }

  beforeEach(async () => {
    await cleanup();

    await prisma.user.createMany({
      data: [
        { id: ORGANIZER_ID, discord_id: 'dc-org-de', username: 'organizer_de', role: 'HOST' },
        { id: PLAYER_A_ID,  discord_id: 'dc-pa-de',  username: 'player_a_de',  role: 'USER' },
        { id: PLAYER_B_ID,  discord_id: 'dc-pb-de',  username: 'player_b_de',  role: 'USER' },
        { id: PLAYER_C_ID,  discord_id: 'dc-pc-de',  username: 'player_c_de',  role: 'USER' },
      ],
    });

    await prisma.tournament.create({
      data: {
        id: TOURNAMENT_ID,
        name: 'DE Integration Test',
        slug: `de-integ-test-${TOURNAMENT_ID}`,
        format: 'DOUBLE_ELIMINATION',
        status: 'REGISTRATION_CLOSED',
        host_id: ORGANIZER_ID,
        start_date: new Date('2026-06-01'),
        timezone: 'UTC',
      },
    });

    await prisma.tournamentParticipant.createMany({
      data: [
        { tournament_id: TOURNAMENT_ID, user_id: ORGANIZER_ID, status: 'CHECKED_IN' },
        { tournament_id: TOURNAMENT_ID, user_id: PLAYER_A_ID,  status: 'CHECKED_IN' },
        { tournament_id: TOURNAMENT_ID, user_id: PLAYER_B_ID,  status: 'CHECKED_IN' },
        { tournament_id: TOURNAMENT_ID, user_id: PLAYER_C_ID,  status: 'CHECKED_IN' },
      ],
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns 200 and persists matches with bracket_side set', async () => {
    const cookieStr = await getAuthCookie(app, ORGANIZER_ID, 'HOST');

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/start`,
      headers: { cookie: cookieStr },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tournamentId: string; matches_created: number; rounds: number }>();
    expect(body.tournamentId).toBe(TOURNAMENT_ID);
    // 4 players → 7 matches (WB:3 + LB:2 + GF + bracket-reset GF)
    expect(body.matches_created).toBe(7);

    const dbMatches = await prisma.match.findMany({
      where: { tournament_id: TOURNAMENT_ID, deleted_at: null },
      orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
    });

    expect(dbMatches).toHaveLength(7); // 3 WB + 2 LB + GF + bracket-reset GF (reset on by default)
    expect(dbMatches.some((m) => m.bracket_side === 'WINNERS')).toBe(true);
    expect(dbMatches.some((m) => m.bracket_side === 'LOSERS')).toBe(true);
    expect(dbMatches.some((m) => m.bracket_side === 'GRAND_FINAL')).toBe(true);

    // WB R1 matches have loser_next_match_id set
    const wbR1 = dbMatches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    for (const m of wbR1) {
      expect(m.loser_next_match_id).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function getAuthCookie(
  appInstance: FastifyInstance,
  userId: string,
  role: string,
): Promise<string> {
  const loginRes = await appInstance.inject({
    method: 'POST',
    url: '/auth/test-login',
    payload: { userId, role },
  });

  const setCookie = loginRes.headers['set-cookie'];
  if (!setCookie) {
    throw new Error('test-login did not return a set-cookie header');
  }
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr!.split(';')[0]!;
}

// ---------------------------------------------------------------------------
// DE match progression (integration)
// ---------------------------------------------------------------------------

const DE_ORG_ID   = '2d000000-0000-0000-0000-000000000001';
const DE_P1_ID    = '2d000000-0000-0000-0000-000000000002';
const DE_P2_ID    = '2d000000-0000-0000-0000-000000000003';
const DE_P3_ID    = '2d000000-0000-0000-0000-000000000004';

const DE_TOURN_ID = '2d000000-0000-0000-0001-000000000001';

async function reportResult(
  appInst: FastifyInstance,
  cookie: string,
  matchId: string,
  winnerId: string,
): Promise<void> {
  const res = await appInst.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/result`,
    headers: { cookie },
    payload: { winnerId },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      `reportResult failed for match ${matchId}: HTTP ${res.statusCode} — ${res.body}`,
    );
  }
}

async function loadMatches(tournamentId: string) {
  return prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
  });
}

/**
 * Drive a 4-player DE bracket from start through to (and including) LB Final (round 4),
 * returning the GF match (round 5) with both player slots filled.
 *
 * 4-player structure (R_L=2, no reset):
 *   WB R1   (round 1, 2 matches)  → winners to WB Final, losers to LB r=0
 *   WB Final (round 2, 1 match)   → WB champion; loser drops to LB Final
 *   LB R1   (round 3, 1 match)    → WB R1 losers play each other
 *   LB Final (round 4, 1 match)   → LB R1 winner vs WB Final loser → LB champion
 *   GF      (round 5, 1 match)    → WB champion vs LB champion
 */
async function playToGrandFinal(
  appInst: FastifyInstance,
  cookie: string,
  tournamentId: string,
): Promise<{ gfMatch: Awaited<ReturnType<typeof loadMatches>>[number]; wbChampId: string; lbChampId: string }> {
  // ── Step 1: Start the bracket ────────────────────────────────────────────
  const startRes = await appInst.inject({
    method: 'POST',
    url: `/api/tournaments/${tournamentId}/start`,
    headers: { cookie },
  });
  if (startRes.statusCode !== 200) {
    throw new Error(`start failed: HTTP ${startRes.statusCode} — ${startRes.body}`);
  }

  // ── Step 2: WB R1 (round 1, 2 matches) ──────────────────────────────────
  let matches = await loadMatches(tournamentId);
  const wbR1Matches = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
  if (wbR1Matches.length !== 2) throw new Error(`Expected 2 WB-R1 matches, got ${wbR1Matches.length}`);

  const wbR1M1 = wbR1Matches.find((m) => m.match_number === 1)!;
  const wbR1M2 = wbR1Matches.find((m) => m.match_number === 2)!;
  if (!wbR1M1.player1_id) throw new Error('WB-R1-M1 player1 not set');
  if (!wbR1M2.player1_id) throw new Error('WB-R1-M2 player1 not set');

  const wbR1M1Winner = wbR1M1.player1_id;
  const wbR1M2Winner = wbR1M2.player1_id;

  await reportResult(appInst, cookie, wbR1M1.id, wbR1M1Winner);
  await reportResult(appInst, cookie, wbR1M2.id, wbR1M2Winner);

  // ── Step 3: WB Final (round 2, 1 match) ─────────────────────────────────
  matches = await loadMatches(tournamentId);
  const wbFinal = matches.find(
    (m) => m.bracket_side === 'WINNERS' && m.round === 2,
  )!;
  if (!wbFinal.player1_id || !wbFinal.player2_id) {
    throw new Error(`WB-Final slots not filled: p1=${wbFinal.player1_id} p2=${wbFinal.player2_id}`);
  }
  const wbChampId = wbFinal.player1_id;
  await reportResult(appInst, cookie, wbFinal.id, wbChampId);

  // ── Step 4: LB R1 (round 3, 1 match) ────────────────────────────────────
  matches = await loadMatches(tournamentId);
  const lbR1 = matches.find(
    (m) => m.bracket_side === 'LOSERS' && m.round === 3,
  )!;
  if (!lbR1.player1_id || !lbR1.player2_id) {
    throw new Error(`LB-R1 slots not filled: p1=${lbR1.player1_id} p2=${lbR1.player2_id}`);
  }
  const lbR1Winner = lbR1.player1_id;
  await reportResult(appInst, cookie, lbR1.id, lbR1Winner);

  // ── Step 5: LB Final (round 4, 1 match) — WB Final loser dropped here ───
  matches = await loadMatches(tournamentId);
  const lbFinal = matches.find(
    (m) => m.bracket_side === 'LOSERS' && m.round === 4,
  )!;
  if (!lbFinal.player1_id || !lbFinal.player2_id) {
    throw new Error(`LB-Final slots not filled: p1=${lbFinal.player1_id} p2=${lbFinal.player2_id}`);
  }
  const lbChampId = lbFinal.player1_id;
  await reportResult(appInst, cookie, lbFinal.id, lbChampId);

  // ── Step 6: Return GF match (round 5) ────────────────────────────────────
  matches = await loadMatches(tournamentId);
  const gfMatch = matches.find(
    (m) => m.bracket_side === 'GRAND_FINAL' && m.round === 5,
  )!;

  return { gfMatch, wbChampId, lbChampId };
}

describe('DE match progression (integration)', () => {
  let app: FastifyInstance;

  async function cleanupDE() {
    await prisma.tournamentResult.deleteMany({ where: { tournament_id: DE_TOURN_ID } });
    await prisma.auditLog.deleteMany({ where: { entity_id: DE_TOURN_ID } });
    await prisma.auditLog.deleteMany({ where: { actor_id: DE_ORG_ID } });
    await prisma.match.deleteMany({ where: { tournament_id: DE_TOURN_ID } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: DE_TOURN_ID } });
    await prisma.tournament.deleteMany({ where: { id: DE_TOURN_ID } });
    await prisma.leaderboardEntry.deleteMany({
      where: { user_id: { in: [DE_ORG_ID, DE_P1_ID, DE_P2_ID, DE_P3_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [DE_ORG_ID, DE_P1_ID, DE_P2_ID, DE_P3_ID] } },
    });
  }

  async function setupDE() {
    await cleanupDE();

    await prisma.user.createMany({
      data: [
        { id: DE_ORG_ID, discord_id: 'dc-org-dep', username: 'org_dep',  role: 'HOST' },
        { id: DE_P1_ID,  discord_id: 'dc-p1-dep',  username: 'p1_dep',   role: 'USER' },
        { id: DE_P2_ID,  discord_id: 'dc-p2-dep',  username: 'p2_dep',   role: 'USER' },
        { id: DE_P3_ID,  discord_id: 'dc-p3-dep',  username: 'p3_dep',   role: 'USER' },
      ],
    });

    await prisma.tournament.create({
      data: {
        id: DE_TOURN_ID,
        name: 'DE Progression Test',
        slug: `de-prog-test-${DE_TOURN_ID}`,
        format: 'DOUBLE_ELIMINATION',
        status: 'REGISTRATION_CLOSED',
        host_id: DE_ORG_ID,
        start_date: new Date('2026-07-01'),
        timezone: 'UTC',
      },
    });

    await prisma.tournamentParticipant.createMany({
      data: [
        { tournament_id: DE_TOURN_ID, user_id: DE_ORG_ID, status: 'CHECKED_IN' },
        { tournament_id: DE_TOURN_ID, user_id: DE_P1_ID,  status: 'CHECKED_IN' },
        { tournament_id: DE_TOURN_ID, user_id: DE_P2_ID,  status: 'CHECKED_IN' },
        { tournament_id: DE_TOURN_ID, user_id: DE_P3_ID,  status: 'CHECKED_IN' },
      ],
    });
  }

  beforeAll(async () => {
    app = await buildApp({
      withSocket: false,
      withRedis: false,
      withCron: false,
      withGraphql: false,
      withDraft: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await cleanupDE();
    await app.close();
  });

  beforeEach(async () => {
    await setupDE();
  });

  afterEach(async () => {
    await cleanupDE();
  });

  // ── Test 1: Loser-Drop-Slots ──────────────────────────────────────────────
  it('WB-R1 losers land in correct LB-R1 slots (odd→player1, even→player2)', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'HOST');

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${DE_TOURN_ID}/start`,
      headers: { cookie },
    });
    expect(startRes.statusCode).toBe(200);

    let matches = await loadMatches(DE_TOURN_ID);
    const wbR1Matches = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1Matches).toHaveLength(2);

    const wbR1M1 = wbR1Matches.find((m) => m.match_number === 1)!;
    const wbR1M2 = wbR1Matches.find((m) => m.match_number === 2)!;
    expect(wbR1M1).toBeDefined();
    expect(wbR1M2).toBeDefined();

    expect(wbR1M1.player1_id).not.toBeNull();
    expect(wbR1M1.player2_id).not.toBeNull();
    expect(wbR1M2.player1_id).not.toBeNull();
    expect(wbR1M2.player2_id).not.toBeNull();

    // Report M1: player2 wins → player1 is the loser
    const m1Loser = wbR1M1.player1_id!;
    const m1Winner = wbR1M1.player2_id!;
    await reportResult(app, cookie, wbR1M1.id, m1Winner);

    // Report M2: player2 wins → player1 is the loser
    const m2Loser = wbR1M2.player1_id!;
    const m2Winner = wbR1M2.player2_id!;
    await reportResult(app, cookie, wbR1M2.id, m2Winner);

    // Reload and inspect LB-R1 (round 3)
    matches = await loadMatches(DE_TOURN_ID);
    const lbR1 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 3)!;
    expect(lbR1).toBeDefined();

    expect(lbR1.player1_id).toBe(m1Loser);
    expect(lbR1.player2_id).toBe(m2Loser);
  });

  // ── Test 2: LB Final filled after WB Final ────────────────────────────────
  it('LB Final (round 4) gets both players after LB R1 and WB Final complete', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'HOST');

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${DE_TOURN_ID}/start`,
      headers: { cookie },
    });
    expect(startRes.statusCode).toBe(200);

    let matches = await loadMatches(DE_TOURN_ID);
    const wbR1Matches = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    const wbR1M1 = wbR1Matches.find((m) => m.match_number === 1)!;
    const wbR1M2 = wbR1Matches.find((m) => m.match_number === 2)!;

    // Play WB R1
    await reportResult(app, cookie, wbR1M1.id, wbR1M1.player1_id!);
    await reportResult(app, cookie, wbR1M2.id, wbR1M2.player1_id!);

    // Play LB R1 (round 3)
    matches = await loadMatches(DE_TOURN_ID);
    const lbR1 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 3)!;
    expect(lbR1.player1_id).not.toBeNull();
    expect(lbR1.player2_id).not.toBeNull();

    const lbR1Winner = lbR1.player1_id!;
    await reportResult(app, cookie, lbR1.id, lbR1Winner);

    // Play WB Final (round 2) — WB Final loser drops to LB Final (round 4)
    matches = await loadMatches(DE_TOURN_ID);
    const wbFinal = matches.find((m) => m.bracket_side === 'WINNERS' && m.round === 2)!;
    const wbFinalLoser = wbFinal.player2_id!;
    await reportResult(app, cookie, wbFinal.id, wbFinal.player1_id!);

    // LB Final (round 4) should now have both slots filled
    matches = await loadMatches(DE_TOURN_ID);
    const lbFinal = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 4)!;
    expect(lbFinal).toBeDefined();
    expect(lbFinal.player1_id).not.toBeNull();
    expect(lbFinal.player2_id).not.toBeNull();

    // LB R1 winner must be in the LB Final
    const hasLbR1Winner = lbFinal.player1_id === lbR1Winner || lbFinal.player2_id === lbR1Winner;
    expect(hasLbR1Winner).toBe(true);

    // WB Final loser must be in the LB Final
    const hasWbFinalLoser = lbFinal.player1_id === wbFinalLoser || lbFinal.player2_id === wbFinalLoser;
    expect(hasWbFinalLoser).toBe(true);
  });

  // ── Test 3: GF — WB champion wins → finalize assigns placements ───────────
  it('GF WB-champion win → finalize assigns placement 1 to WB-champ', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'HOST');

    const { gfMatch, wbChampId } = await playToGrandFinal(app, cookie, DE_TOURN_ID);

    expect(gfMatch.player1_id).not.toBeNull();
    expect(gfMatch.player2_id).not.toBeNull();
    expect(gfMatch.player1_id).toBe(wbChampId);

    const gfLoserId = gfMatch.player2_id!;

    // WB champion wins GF — no reset match in Bo3 format
    await reportResult(app, cookie, gfMatch.id, wbChampId);

    // Finalize and check placements
    const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
    await finalizeTournament(prisma, DE_TOURN_ID, DE_ORG_ID);

    const results = await prisma.tournamentResult.findMany({
      where: { tournament_id: DE_TOURN_ID },
    });

    const champResult = results.find((r) => r.user_id === wbChampId);
    const runnerUpResult = results.find((r) => r.user_id === gfLoserId);
    expect(champResult).toBeDefined();
    expect(champResult!.placement).toBe(1);
    expect(runnerUpResult).toBeDefined();
    expect(runnerUpResult!.placement).toBe(2);
  });

  // ── Test 4: GF — LB champion wins → finalize assigns placements ───────────
  it('GF LB-champion win → finalize assigns placement 1 to LB-champ', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'HOST');

    const { gfMatch, wbChampId, lbChampId } = await playToGrandFinal(app, cookie, DE_TOURN_ID);

    expect(gfMatch.player1_id).toBe(wbChampId);
    expect(gfMatch.player2_id).toBe(lbChampId);

    // LB champion wins GF — no reset match in Bo3 format
    await reportResult(app, cookie, gfMatch.id, lbChampId);

    // Finalize and check placements
    const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
    await finalizeTournament(prisma, DE_TOURN_ID, DE_ORG_ID);

    const results = await prisma.tournamentResult.findMany({
      where: { tournament_id: DE_TOURN_ID },
    });

    const champResult = results.find((r) => r.user_id === lbChampId);
    const runnerUpResult = results.find((r) => r.user_id === wbChampId);
    expect(champResult).toBeDefined();
    expect(champResult!.placement).toBe(1);
    expect(runnerUpResult).toBeDefined();
    expect(runnerUpResult!.placement).toBe(2);
  });

  // ── Test 5: Order-Independence — LB-R1 reported BEFORE WB-Final ─────────────
  it('order-independence: reporting LB-R1 before WB-Final does not lose a player slot', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'HOST');

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${DE_TOURN_ID}/start`,
      headers: { cookie },
    });
    expect(startRes.statusCode).toBe(200);

    // ── Step 1: Play both WB-R1 matches ───────────────────────────────────────
    let matches = await loadMatches(DE_TOURN_ID);
    const wbR1 = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1).toHaveLength(2);

    const wbR1M1 = wbR1.find((m) => m.match_number === 1)!;
    const wbR1M2 = wbR1.find((m) => m.match_number === 2)!;
    expect(wbR1M1.player1_id).not.toBeNull();
    expect(wbR1M1.player2_id).not.toBeNull();
    expect(wbR1M2.player1_id).not.toBeNull();
    expect(wbR1M2.player2_id).not.toBeNull();

    const wbR1M1Winner = wbR1M1.player1_id!;
    const wbR1M2Winner = wbR1M2.player1_id!;

    await reportResult(app, cookie, wbR1M1.id, wbR1M1Winner);
    await reportResult(app, cookie, wbR1M2.id, wbR1M2Winner);

    // ── Step 2: Play LB-R1 (round 3) FIRST — before WB-Final (round 2) ───────
    matches = await loadMatches(DE_TOURN_ID);
    const lbR1 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 3)!;
    expect(lbR1).toBeDefined();
    expect(lbR1.player1_id).not.toBeNull();
    expect(lbR1.player2_id).not.toBeNull();

    const lbR1Winner = lbR1.player1_id!;
    await reportResult(app, cookie, lbR1.id, lbR1Winner);

    // ── Step 3: NOW play WB-Final (round 2) ───────────────────────────────────
    matches = await loadMatches(DE_TOURN_ID);
    const wbFinal = matches.find((m) => m.bracket_side === 'WINNERS' && m.round === 2)!;
    expect(wbFinal).toBeDefined();
    expect(wbFinal.player1_id).not.toBeNull();
    expect(wbFinal.player2_id).not.toBeNull();

    const wbFinalWinner = wbFinal.player1_id!;
    const wbFinalLoser  = wbFinal.player2_id!;
    await reportResult(app, cookie, wbFinal.id, wbFinalWinner);

    // ── Step 4: LB Final (round 4) must have both players ─────────────────────
    // It must contain BOTH the LB-R1 winner (advanced through LB) AND the
    // WB-Final loser (just dropped in). Neither slot may be null.
    matches = await loadMatches(DE_TOURN_ID);
    const lbFinal = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 4)!;
    expect(lbFinal).toBeDefined();

    expect(lbFinal.player1_id).not.toBeNull();
    expect(lbFinal.player2_id).not.toBeNull();

    const hasLbR1Winner =
      lbFinal.player1_id === lbR1Winner || lbFinal.player2_id === lbR1Winner;
    expect(hasLbR1Winner).toBe(true);

    const hasWbFinalLoser =
      lbFinal.player1_id === wbFinalLoser || lbFinal.player2_id === wbFinalLoser;
    expect(hasWbFinalLoser).toBe(true);
  });
});
