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
  // seeded = [p1,p2,p3,p4,p5,null,null,null]
  // WB R1 M1=(p1,p2) PENDING, M2=(p3,p4) PENDING, M3=(p5,null) BYE, M4=(null,null) PENDING
  // Only M3 is BYE — M4 has both slots null, which is a degenerate case but not a BYE per spec.
  it('5-player → padded to 8 (16 matches), 1 WB R1 BYE match', () => {
    const matches = generateDoubleElim(T_ID, fakeIds(5));
    expect(matches).toHaveLength(16);

    const wbR1 = matches.filter((m) => m.bracket_side === 'WINNERS' && m.round === 1);
    expect(wbR1).toHaveLength(4);

    // Exactly 1 BYE: the p5-vs-null match
    const byeMatches = wbR1.filter((m) => m.status === 'BYE');
    expect(byeMatches).toHaveLength(1);

    for (const bye of byeMatches) {
      expect(bye.winner_id).not.toBeNull();
    }
  });

  it('5-player → BYE match has winner_id set to the real player', () => {
    const ids = fakeIds(5);
    const matches = generateDoubleElim(T_ID, ids);

    const byeMatches = matches.filter(
      (m) => m.bracket_side === 'WINNERS' && m.round === 1 && m.status === 'BYE',
    );

    expect(byeMatches).toHaveLength(1);
    for (const bye of byeMatches) {
      const winner = bye.winner_id;
      expect(winner).not.toBeNull();
      // winner must be one of the real participant IDs
      expect(ids.includes(winner!)).toBe(true);
    }
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
