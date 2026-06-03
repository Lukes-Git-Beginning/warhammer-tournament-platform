/**
 * Tests for double-elimination bracket generation and HTTP integration.
 *
 * Unit tests cover generateDoubleElim() structure and linking.
 * Integration test covers POST /api/tournaments/:id/start with DOUBLE_ELIMINATION.
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
  // 4 players:
  //   WB: R_W=2, counts: 2+1 = 3
  //   LB: R_L = 2*2-1 = 3 rounds
  //     LB R1 (drop, r=0): S>>(0+2)=4>>2=1 match
  //     LB R2 (consol, r=1): 4>>(0+2)=1 match
  //     LB R3 (drop, r=2): 4>>(1+2)=4>>3=0 → max(0,1)=1 match (WB R2 loser)
  //   GF: 1, Reset: 1
  //   Total: 3+3+1+1 = 8
  it('4-player → 8 matches total', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    expect(matches).toHaveLength(8);
  });

  it('4-player → correct bracket_side distribution', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const winners = matches.filter((m) => m.bracket_side === 'WINNERS');
    const losers = matches.filter((m) => m.bracket_side === 'LOSERS');
    const gf = matches.filter((m) => m.bracket_side === 'GRAND_FINAL');

    expect(winners).toHaveLength(3);
    expect(losers).toHaveLength(3);
    expect(gf).toHaveLength(2); // Grand Final + Reset
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

  it('4-player → Grand Final has next_match_id pointing to Reset Match', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(4));
    const gfMatches = matches.filter((m) => m.bracket_side === 'GRAND_FINAL');
    expect(gfMatches).toHaveLength(2);

    // GF is the one with a next_match_id, Reset is the one without
    const gf = gfMatches.find((m) => m.next_match_id !== null);
    const reset = gfMatches.find((m) => m.next_match_id === null);
    expect(gf).toBeDefined();
    expect(reset).toBeDefined();
    expect(gf!.next_match_id).toBe(reset!.id);
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

  // 8 players:
  //   S=8, R_W=3, WB: 4+2+1=7
  //   LB: R_L=5, counts: r=0→8>>2=2, r=1→2, r=2→8>>3=1, r=3→1, r=4→8>>4=0→max(0,1)=1 → 2+2+1+1+1=7
  //   GF+Reset=2 → Total=7+7+2=16
  it('8-player → 16 matches total', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    expect(matches).toHaveLength(16);
  });

  it('8-player → 7 WB + 7 LB + 2 GRAND_FINAL', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(8));
    expect(matches.filter((m) => m.bracket_side === 'WINNERS')).toHaveLength(7);
    expect(matches.filter((m) => m.bracket_side === 'LOSERS')).toHaveLength(7);
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

  // 16 players:
  //   S=16, R_W=4, WB=8+4+2+1=15
  //   LB: R_L=7, counts: r=0→4,r=1→4,r=2→2,r=3→2,r=4→1,r=5→1,r=6→max(0,1)=1 → 4+4+2+2+1+1+1=15
  //   GF+Reset=2 → Total=15+15+2=32
  it('16-player → 32 matches total', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(16));
    expect(matches).toHaveLength(32);
  });

  it('16-player → no duplicate (round, match_number) pairs', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(16));
    const keys = matches.map((m) => `${m.round}:${m.match_number}`);
    expect(new Set(keys).size).toBe(matches.length);
  });

  // Non-power-of-2: 5 players → padded to 8 → same structure as 8 players = 16 matches.
  // Standard seed order distributes BYEs evenly: seeds 1–5 are real, seeds 6–8 are BYE slots.
  // Seed-slot order for size 8: [1,8,4,5,2,7,3,6]
  // seeded = [p1,null,p4,p5,p2,null,p3,null]  (seeds 6,7,8 = null → positions 1,5,7)
  // WB R1 pairs: M1=(p1,null)→BYE, M2=(p4,p5)→PENDING, M3=(p2,null)→BYE, M4=(p3,null)→BYE
  // 3 BYE matches (one real player vs null each), 1 real match — no empty (null,null) matches.
  it('5-player → padded to 8 (16 matches), 3 WB R1 BYE matches', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(5));
    expect(matches).toHaveLength(16);

    const wbR1 = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1).toHaveLength(4);

    // BYEs are distributed via standard seed order: 3 BYE matches, 1 real match.
    // Each BYE match has exactly one real player (never both null).
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

    // Every BYE winner must be a real participant
    for (const winner of byeWinners) {
      expect(winner).not.toBeNull();
      expect(ids.includes(winner!)).toBe(true);
    }

    // All three BYE winners must be pairwise distinct (no player counted twice)
    const uniqueWinners = new Set(byeWinners);
    expect(uniqueWinners.size).toBe(3);
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
    await prisma.auditLog.deleteMany({
      where: { entity_id: TOURNAMENT_ID },
    });
    await prisma.auditLog.deleteMany({
      where: { actor_id: ORGANIZER_ID },
    });
    await prisma.match.deleteMany({
      where: { tournament_id: TOURNAMENT_ID },
    });
    await prisma.tournamentParticipant.deleteMany({
      where: { tournament_id: TOURNAMENT_ID },
    });
    await prisma.tournament.deleteMany({
      where: { id: TOURNAMENT_ID },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ORGANIZER_ID, PLAYER_A_ID, PLAYER_B_ID, PLAYER_C_ID] } },
    });
  }

  beforeEach(async () => {
    await cleanup();

    await prisma.user.createMany({
      data: [
        { id: ORGANIZER_ID, discord_id: 'dc-org-de', username: 'organizer_de', role: 'ORGANIZER' },
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
        organizer_id: ORGANIZER_ID,
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
    const cookieStr = await getAuthCookie(app, ORGANIZER_ID, 'ORGANIZER');

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/start`,
      headers: { cookie: cookieStr },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tournamentId: string; matches_created: number; rounds: number }>();
    expect(body.tournamentId).toBe(TOURNAMENT_ID);
    // 4 players → 8 matches
    expect(body.matches_created).toBe(8);

    const dbMatches = await prisma.match.findMany({
      where: { tournament_id: TOURNAMENT_ID, deleted_at: null },
      orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
    });

    expect(dbMatches).toHaveLength(8);
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

// Distinct IDs to avoid collisions with the bracket-start suite above.
const DE_ORG_ID   = '2d000000-0000-0000-0000-000000000001';
const DE_P1_ID    = '2d000000-0000-0000-0000-000000000002';
const DE_P2_ID    = '2d000000-0000-0000-0000-000000000003';
const DE_P3_ID    = '2d000000-0000-0000-0000-000000000004';

const DE_TOURN_ID = '2d000000-0000-0000-0001-000000000001';

// Report a match result via HTTP and assert status 200.
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

// Load all matches for a tournament ordered by (round, match_number).
async function loadMatches(tournamentId: string) {
  return prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
  });
}

/**
 * Drive the bracket from start through to (and including) LB Final (round 5),
 * returning the GF match (round 6) with both player slots set.
 *
 * `wbR1M1WinsPlayer` – true  → DE_P1_ID wins WB-R1-M1 (odd), false → DE_P2_ID wins
 * `wbR1M2WinsPlayer` – true  → DE_P3_ID wins WB-R1-M2 (even), false → DE_ORG_ID wins
 * `wbFinalWinner`    – which of the two WB-R1 winners proceeds through WB-Final
 * `lbFinalWinner`    – which player wins the LB path
 *
 * For simplicity the helper always makes the same deterministic choices:
 *   WB-R1-M1 winner = DE_P1_ID (first of the two WB-R1-M1 players)
 *   WB-R1-M2 winner = DE_P3_ID (first of the two WB-R1-M2 players)
 *   WB-Final winner = WB-R1-M1 winner (DE_P1_ID)
 *   LB matches      = always pick player1 of the respective match
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

  // Match with match_number 1 (odd) and match_number 2 (even)
  const wbR1M1 = wbR1Matches.find((m) => m.match_number === 1)!;
  const wbR1M2 = wbR1Matches.find((m) => m.match_number === 2)!;
  if (!wbR1M1.player1_id) throw new Error('WB-R1-M1 player1 not set');
  if (!wbR1M2.player1_id) throw new Error('WB-R1-M2 player1 not set');

  // winner of M1 = player1 of M1, winner of M2 = player1 of M2
  const wbR1M1Winner = wbR1M1.player1_id;
  const wbR1M1Loser  = wbR1M1.player2_id!;
  const wbR1M2Winner = wbR1M2.player1_id;
  const wbR1M2Loser  = wbR1M2.player2_id!;

  await reportResult(appInst, cookie, wbR1M1.id, wbR1M1Winner);
  await reportResult(appInst, cookie, wbR1M2.id, wbR1M2Winner);

  // ── Step 3: WB Final (round 2, 1 match) ─────────────────────────────────
  matches = await loadMatches(tournamentId);
  const wbFinal = matches.find(
    (m) => m.bracket_side === 'WINNERS' && m.round === 2,
  )!;
  if (!wbFinal.player1_id || !wbFinal.player2_id) {
    throw new Error(`WB-Final slots not filled after WB-R1: p1=${wbFinal.player1_id} p2=${wbFinal.player2_id}`);
  }
  // WB champion = player1 of WB Final (which is wbR1M1Winner per slot rule)
  const wbChampId = wbFinal.player1_id;
  const wbFinalLoser = wbFinal.player2_id;
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

  // ── Step 5: LB R4 is auto-BYE'd (round 4) — skip it, then LB R5 ────────
  matches = await loadMatches(tournamentId);

  // LB round 5 should now have one slot filled (from BYE promotion of round 4).
  // The WB-Final loser drops into round 5 as the other slot.
  const lbR5 = matches.find(
    (m) => m.bracket_side === 'LOSERS' && m.round === 5,
  )!;
  if (!lbR5.player1_id || !lbR5.player2_id) {
    throw new Error(`LB-R5 slots not filled before playing: p1=${lbR5.player1_id} p2=${lbR5.player2_id}. wbFinalLoser=${wbFinalLoser}`);
  }
  const lbChampId = lbR5.player1_id;
  await reportResult(appInst, cookie, lbR5.id, lbChampId);

  // ── Step 6: Return GF match ───────────────────────────────────────────────
  matches = await loadMatches(tournamentId);
  const gfMatch = matches.find(
    (m) => m.bracket_side === 'GRAND_FINAL' && m.round === 6,
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
    await prisma.user.deleteMany({
      where: { id: { in: [DE_ORG_ID, DE_P1_ID, DE_P2_ID, DE_P3_ID] } },
    });
  }

  async function setupDE() {
    await cleanupDE();

    await prisma.user.createMany({
      data: [
        { id: DE_ORG_ID, discord_id: 'dc-org-dep', username: 'org_dep',  role: 'ORGANIZER' },
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
        organizer_id: DE_ORG_ID,
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
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'ORGANIZER');

    // Start bracket
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${DE_TOURN_ID}/start`,
      headers: { cookie },
    });
    expect(startRes.statusCode).toBe(200);

    let matches = await loadMatches(DE_TOURN_ID);
    const wbR1Matches = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1Matches).toHaveLength(2);

    const wbR1M1 = wbR1Matches.find((m) => m.match_number === 1)!; // odd
    const wbR1M2 = wbR1Matches.find((m) => m.match_number === 2)!; // even
    expect(wbR1M1).toBeDefined();
    expect(wbR1M2).toBeDefined();

    // Both matches must have two players
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

    // Reload and inspect LB-R1
    matches = await loadMatches(DE_TOURN_ID);
    const lbR1 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 3)!;
    expect(lbR1).toBeDefined();

    // Odd match_number (1) loser → player1 slot
    expect(lbR1.player1_id).toBe(m1Loser);
    // Even match_number (2) loser → player2 slot
    expect(lbR1.player2_id).toBe(m2Loser);
  });

  // ── Test 2: Degenerate LB round becomes BYE ───────────────────────────────
  it('LB round 4 auto-promotes to BYE after LB round 3 completes', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'ORGANIZER');

    // Start + WB-R1
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

    await reportResult(app, cookie, wbR1M1.id, wbR1M1.player1_id!);
    await reportResult(app, cookie, wbR1M2.id, wbR1M2.player1_id!);

    // WB-R1 losers are now in LB-R1 (round 3)
    matches = await loadMatches(DE_TOURN_ID);
    const lbR1 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 3)!;
    expect(lbR1.player1_id).not.toBeNull();
    expect(lbR1.player2_id).not.toBeNull();

    const lbR1Winner = lbR1.player1_id!;
    await reportResult(app, cookie, lbR1.id, lbR1Winner);

    // Reload — LB round 4 should be BYE, with winner = lbR1Winner
    matches = await loadMatches(DE_TOURN_ID);
    const lbR4 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 4)!;
    expect(lbR4).toBeDefined();
    expect(lbR4.status).toBe('BYE');
    expect(lbR4.winner_id).toBe(lbR1Winner);

    // The LB R4 winner (= lbR1Winner) must already be slotted into LB round 5
    const lbR5 = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 5)!;
    expect(lbR5).toBeDefined();
    const r5HasPlayer = lbR5.player1_id === lbR1Winner || lbR5.player2_id === lbR1Winner;
    expect(r5HasPlayer).toBe(true);
  });

  // ── Test 3: GF — WB champion wins → Reset = FORFEIT ──────────────────────
  it('GF WB-champion win → Reset match is FORFEIT; finalize assigns placement 1 to WB-champ', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'ORGANIZER');

    const { gfMatch, wbChampId } = await playToGrandFinal(app, cookie, DE_TOURN_ID);

    expect(gfMatch.player1_id).not.toBeNull();
    expect(gfMatch.player2_id).not.toBeNull();

    // WB champion is player1 of GF
    expect(gfMatch.player1_id).toBe(wbChampId);

    const gfLoserId = gfMatch.player2_id!;

    // WB champion wins GF
    await reportResult(app, cookie, gfMatch.id, wbChampId);

    // Reset match must be FORFEIT
    const matches = await loadMatches(DE_TOURN_ID);
    const resetMatch = matches.find(
      (m) => m.bracket_side === 'GRAND_FINAL' && m.round === 7,
    )!;
    expect(resetMatch).toBeDefined();
    expect(resetMatch.status).toBe('FORFEIT');
    expect(resetMatch.winner_id).toBe(wbChampId);

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

  // ── Test 4: GF — LB champion wins → Reset is PENDING, then played ─────────
  it('GF LB-champion win → Reset match is PENDING with both slots; Reset win finalizes correctly', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'ORGANIZER');

    const { gfMatch, wbChampId, lbChampId } = await playToGrandFinal(app, cookie, DE_TOURN_ID);

    expect(gfMatch.player1_id).not.toBeNull();
    expect(gfMatch.player2_id).not.toBeNull();
    expect(gfMatch.player1_id).toBe(wbChampId);
    expect(gfMatch.player2_id).toBe(lbChampId);

    // LB champion wins GF
    await reportResult(app, cookie, gfMatch.id, lbChampId);

    // Reset match must be PENDING with both slots set
    let matches = await loadMatches(DE_TOURN_ID);
    const resetMatch = matches.find(
      (m) => m.bracket_side === 'GRAND_FINAL' && m.round === 7,
    )!;
    expect(resetMatch).toBeDefined();
    expect(resetMatch.status).toBe('PENDING');
    expect(resetMatch.player1_id).not.toBeNull(); // WB champ
    expect(resetMatch.player2_id).not.toBeNull(); // LB champ
    expect(resetMatch.player2_id).toBe(lbChampId);

    // Play Reset — LB champion wins again
    await reportResult(app, cookie, resetMatch.id, lbChampId);

    // Finalize and check placements
    const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
    await finalizeTournament(prisma, DE_TOURN_ID, DE_ORG_ID);

    const results = await prisma.tournamentResult.findMany({
      where: { tournament_id: DE_TOURN_ID },
    });

    const champResult = results.find((r) => r.user_id === lbChampId);
    expect(champResult).toBeDefined();
    expect(champResult!.placement).toBe(1);
  });

  // ── Test 5: Order-Independence — LB-R1 reported BEFORE WB-Final ─────────────
  // Regression for the bug where a loser-drop (using old parity heuristic) would
  // overwrite a player already advanced into the LB match by an earlier winner
  // progression. With the slotForFeeder fix the slot is derived from the static
  // feeder structure, so order of result reporting cannot cause overwrites.
  it('order-independence: reporting LB-R1 before WB-Final does not lose a player slot', async () => {
    const cookie = await getAuthCookie(app, DE_ORG_ID, 'ORGANIZER');

    // Start bracket
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
    const wbR1M1Loser  = wbR1M1.player2_id!;
    const wbR1M2Loser  = wbR1M2.player2_id!;

    await reportResult(app, cookie, wbR1M1.id, wbR1M1Winner);
    await reportResult(app, cookie, wbR1M2.id, wbR1M2Winner);

    // ── Step 2: Play LB-R1 (round 3) FIRST — before WB-Final (round 2) ───────
    // After WB-R1, both losers are in LB-R1 (round 3). Play that immediately.
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

    // ── Step 4: Load LB-Final (round 5, highest LB round) ─────────────────────
    // It must contain BOTH the LB-R1 winner (who advanced through the bracket)
    // AND the WB-Final loser (who just dropped in). Neither slot may be null and
    // neither player may have been overwritten by the other.
    matches = await loadMatches(DE_TOURN_ID);
    const lbFinal = matches.find((m) => m.bracket_side === 'LOSERS' && m.round === 5)!;
    expect(lbFinal).toBeDefined();

    // Both slots filled — order-independence guarantee
    expect(lbFinal.player1_id).not.toBeNull();
    expect(lbFinal.player2_id).not.toBeNull();

    // The LB-Final contains the LB-R1 winner
    const hasLbR1Winner =
      lbFinal.player1_id === lbR1Winner || lbFinal.player2_id === lbR1Winner;
    expect(hasLbR1Winner).toBe(true);

    // The LB-Final contains the WB-Final loser
    const hasWbFinalLoser =
      lbFinal.player1_id === wbFinalLoser || lbFinal.player2_id === wbFinalLoser;
    expect(hasWbFinalLoser).toBe(true);

    // Sanity: the two players are distinct
    expect(lbFinal.player1_id).not.toBe(lbFinal.player2_id);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle-completion tests — non-power-of-2 field sizes (5, 6, 7 players)
// ---------------------------------------------------------------------------
//
// For each field size we:
//   1. Start the tournament.
//   2. Drive it to completion via a generic playOutTournament() loop.
//   3. Assert: no match is left PENDING/ONGOING, exactly one GRAND_FINAL is
//      COMPLETED, and finalizeTournament() produces N unique placements (1..N).
//
// These tests prove that distributed BYE seeding + topological resolution +
// order-independent slot assignment together result in a fully playable bracket
// regardless of field size — no stuck matches, no orphaned slots.

// ── ID constants ──────────────────────────────────────────────────────────────
// Prefix 3e000000-* to avoid collisions with suites above.

const LC_ORG_ID = '3e000000-0000-0000-0000-000000000001';

// 7 players + 1 organizer — enough for all three field sizes.
const LC_PLAYER_IDS = [
  '3e000000-0000-0000-0000-000000000002',
  '3e000000-0000-0000-0000-000000000003',
  '3e000000-0000-0000-0000-000000000004',
  '3e000000-0000-0000-0000-000000000005',
  '3e000000-0000-0000-0000-000000000006',
  '3e000000-0000-0000-0000-000000000007',
  '3e000000-0000-0000-0000-000000000008',
];

// Deterministic tournament IDs — one per field size.
const LC_TOURN_5 = '3e000000-0000-0000-0001-000000000005';
const LC_TOURN_6 = '3e000000-0000-0000-0001-000000000006';
const LC_TOURN_7 = '3e000000-0000-0000-0001-000000000007';

/**
 * Drive a tournament to completion by repeatedly finding the first playable
 * match (PENDING or ONGOING, both player slots set) and reporting player1 wins.
 *
 * Throws if iteration exceeds `cap` to guard against infinite loops caused by
 * stuck brackets — a cap hit IS a bug in the bracket logic and must be reported.
 */
async function playOutTournament(
  appInst: FastifyInstance,
  cookie: string,
  tournamentId: string,
  cap = 100,
): Promise<void> {
  for (let iter = 0; iter < cap; iter++) {
    const matches = await loadMatches(tournamentId);
    const playable = matches.find(
      (m) =>
        (m.status === 'PENDING' || m.status === 'ONGOING') &&
        m.player1_id !== null &&
        m.player2_id !== null,
    );
    if (!playable) return; // bracket complete
    await reportResult(appInst, cookie, playable.id, playable.player1_id!);
  }
  throw new Error(
    `playOutTournament hit iteration cap (${cap}) for tournament ${tournamentId} — stuck bracket detected`,
  );
}

async function cleanupLC(tournamentId: string, playerIds: string[]) {
  await prisma.tournamentResult.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.auditLog.deleteMany({ where: { entity_id: tournamentId } });
  await prisma.auditLog.deleteMany({ where: { actor_id: LC_ORG_ID } });
  await prisma.match.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  await prisma.user.deleteMany({
    where: { id: { in: [LC_ORG_ID, ...playerIds] } },
  });
}

async function setupLC(tournamentId: string, playerIds: string[], slug: string) {
  await cleanupLC(tournamentId, playerIds);

  // Organizer + all players for this field size
  await prisma.user.createMany({
    data: [
      { id: LC_ORG_ID, discord_id: `dc-lc-org-${tournamentId}`, username: `lc_org_${slug}`, role: 'ORGANIZER' },
      ...playerIds.map((id, idx) => ({
        id,
        discord_id: `dc-lc-p${idx + 1}-${tournamentId}`,
        username: `lc_p${idx + 1}_${slug}`,
        role: 'USER' as const,
      })),
    ],
    skipDuplicates: true,
  });

  await prisma.tournament.create({
    data: {
      id: tournamentId,
      name: `LC ${slug} Test`,
      slug: `lc-${slug}-${tournamentId}`,
      format: 'DOUBLE_ELIMINATION',
      status: 'REGISTRATION_CLOSED',
      organizer_id: LC_ORG_ID,
      start_date: new Date('2026-08-01'),
      timezone: 'UTC',
    },
  });

  await prisma.tournamentParticipant.createMany({
    data: [
      { tournament_id: tournamentId, user_id: LC_ORG_ID, status: 'CHECKED_IN' },
      ...playerIds.map((id) => ({
        tournament_id: tournamentId,
        user_id: id,
        status: 'CHECKED_IN' as const,
      })),
    ],
  });
}

describe('DE lifecycle completion — non-power-of-2 field sizes', () => {
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
  });

  // ── 5-player lifecycle ────────────────────────────────────────────────────
  describe('5-player', () => {
    const playerIds = LC_PLAYER_IDS.slice(0, 4); // 4 players + 1 organizer = 5 participants
    const tournamentId = LC_TOURN_5;

    beforeEach(async () => {
      await setupLC(tournamentId, playerIds, '5p');
    });

    afterEach(async () => {
      await cleanupLC(tournamentId, playerIds);
    });

    it('plays to completion with no stuck matches and correct placements', async () => {
      const cookie = await getAuthCookie(app, LC_ORG_ID, 'ORGANIZER');
      const participantCount = playerIds.length + 1; // players + organizer

      const startRes = await app.inject({
        method: 'POST',
        url: `/api/tournaments/${tournamentId}/start`,
        headers: { cookie },
      });
      expect(startRes.statusCode).toBe(200);

      // Drive to completion — throws if stuck
      await playOutTournament(app, cookie, tournamentId);

      // Assertion A: no match remains PENDING or ONGOING
      const matches = await loadMatches(tournamentId);
      const stuck = matches.filter((m) => m.status === 'PENDING' || m.status === 'ONGOING');
      expect(stuck).toHaveLength(0);

      // Assertion B: exactly one GRAND_FINAL match is COMPLETED (the decisive game)
      const completedGFs = matches.filter(
        (m) => m.bracket_side === 'GRAND_FINAL' && m.status === 'COMPLETED',
      );
      expect(completedGFs).toHaveLength(1);

      // Assertion C: finalize produces N placements covering 1..N
      const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
      await finalizeTournament(prisma, tournamentId, LC_ORG_ID);

      const results = await prisma.tournamentResult.findMany({
        where: { tournament_id: tournamentId },
      });
      expect(results).toHaveLength(participantCount);

      const placements = results.map((r) => r.placement).sort((a, b) => a - b);
      expect(placements[0]).toBe(1);
      const uniquePlacements = new Set(placements);
      expect(uniquePlacements.size).toBe(participantCount);
    });
  });

  // ── 6-player lifecycle ────────────────────────────────────────────────────
  describe('6-player', () => {
    const playerIds = LC_PLAYER_IDS.slice(0, 5); // 5 players + 1 organizer = 6 participants
    const tournamentId = LC_TOURN_6;

    beforeEach(async () => {
      await setupLC(tournamentId, playerIds, '6p');
    });

    afterEach(async () => {
      await cleanupLC(tournamentId, playerIds);
    });

    it('plays to completion with no stuck matches and correct placements', async () => {
      const cookie = await getAuthCookie(app, LC_ORG_ID, 'ORGANIZER');
      const participantCount = playerIds.length + 1;

      const startRes = await app.inject({
        method: 'POST',
        url: `/api/tournaments/${tournamentId}/start`,
        headers: { cookie },
      });
      expect(startRes.statusCode).toBe(200);

      await playOutTournament(app, cookie, tournamentId);

      const matches = await loadMatches(tournamentId);
      const stuck = matches.filter((m) => m.status === 'PENDING' || m.status === 'ONGOING');
      expect(stuck).toHaveLength(0);

      const completedGFs = matches.filter(
        (m) => m.bracket_side === 'GRAND_FINAL' && m.status === 'COMPLETED',
      );
      expect(completedGFs).toHaveLength(1);

      const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
      await finalizeTournament(prisma, tournamentId, LC_ORG_ID);

      const results = await prisma.tournamentResult.findMany({
        where: { tournament_id: tournamentId },
      });
      expect(results).toHaveLength(participantCount);

      const placements = results.map((r) => r.placement).sort((a, b) => a - b);
      expect(placements[0]).toBe(1);
      const uniquePlacements = new Set(placements);
      expect(uniquePlacements.size).toBe(participantCount);
    });
  });

  // ── 7-player lifecycle ────────────────────────────────────────────────────
  describe('7-player', () => {
    const playerIds = LC_PLAYER_IDS.slice(0, 6); // 6 players + 1 organizer = 7 participants
    const tournamentId = LC_TOURN_7;

    beforeEach(async () => {
      await setupLC(tournamentId, playerIds, '7p');
    });

    afterEach(async () => {
      await cleanupLC(tournamentId, playerIds);
    });

    it('plays to completion with no stuck matches and correct placements', async () => {
      const cookie = await getAuthCookie(app, LC_ORG_ID, 'ORGANIZER');
      const participantCount = playerIds.length + 1;

      const startRes = await app.inject({
        method: 'POST',
        url: `/api/tournaments/${tournamentId}/start`,
        headers: { cookie },
      });
      expect(startRes.statusCode).toBe(200);

      await playOutTournament(app, cookie, tournamentId);

      const matches = await loadMatches(tournamentId);
      const stuck = matches.filter((m) => m.status === 'PENDING' || m.status === 'ONGOING');
      expect(stuck).toHaveLength(0);

      const completedGFs = matches.filter(
        (m) => m.bracket_side === 'GRAND_FINAL' && m.status === 'COMPLETED',
      );
      expect(completedGFs).toHaveLength(1);

      const { finalizeTournament } = await import('../src/lib/finalize-tournament.js');
      await finalizeTournament(prisma, tournamentId, LC_ORG_ID);

      const results = await prisma.tournamentResult.findMany({
        where: { tournament_id: tournamentId },
      });
      expect(results).toHaveLength(participantCount);

      const placements = results.map((r) => r.placement).sort((a, b) => a - b);
      expect(placements[0]).toBe(1);
      const uniquePlacements = new Set(placements);
      expect(uniquePlacements.size).toBe(participantCount);
    });
  });
});
