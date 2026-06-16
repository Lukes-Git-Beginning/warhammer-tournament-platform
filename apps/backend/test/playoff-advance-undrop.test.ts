/**
 * Defensive guards around playoff advancement and undrop.
 *
 * Covers the bracket bug where a drop (FORFEIT / double-drop CANCELLED) on an
 * unplayed semifinal let advance-playoffs generate the Grand Final + third-place
 * match from phantom players, and where undrop left those forfeited SF rows
 * stuck (player shown as OUT).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = '3e000000-0000-0000-0000-000000000001';
const P1_ID = '3e000000-0000-0000-0000-000000000002';
const P2_ID = '3e000000-0000-0000-0000-000000000003';
const P3_ID = '3e000000-0000-0000-0000-000000000004';
const P4_ID = '3e000000-0000-0000-0000-000000000005';
const TOURN_ID = '3e000000-0000-0000-0001-000000000001';
const TOURN_SLUG = `playoff-guard-test-${TOURN_ID}`;

let app: FastifyInstance;

async function getAuthCookie(userId: string, role: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/test-login', payload: { userId, role } });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('test-login did not return a set-cookie header');
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr!.split(';')[0]!;
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { entity_id: TOURN_ID } });
  await prisma.auditLog.deleteMany({ where: { actor_id: ADMIN_ID } });
  await prisma.match.deleteMany({ where: { tournament_id: TOURN_ID } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: TOURN_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURN_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, P1_ID, P2_ID, P3_ID, P4_ID] } } });
}

async function setup() {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'dc-admin-pg', username: 'admin_pg', role: 'ADMIN' },
      { id: P1_ID, discord_id: 'dc-p1-pg', username: 'p1_pg', role: 'USER' },
      { id: P2_ID, discord_id: 'dc-p2-pg', username: 'p2_pg', role: 'USER' },
      { id: P3_ID, discord_id: 'dc-p3-pg', username: 'p3_pg', role: 'USER' },
      { id: P4_ID, discord_id: 'dc-p4-pg', username: 'p4_pg', role: 'USER' },
    ],
  });
  await prisma.tournament.create({
    data: {
      id: TOURN_ID,
      name: 'Playoff Guard Test',
      slug: TOURN_SLUG,
      format: 'SWISS',
      status: 'ONGOING',
      organizer_id: ADMIN_ID,
      has_third_place_match: true,
      start_date: new Date('2026-06-01'),
      timezone: 'UTC',
    },
  });
  await prisma.tournamentParticipant.createMany({
    data: [
      { tournament_id: TOURN_ID, user_id: P1_ID, status: 'CHECKED_IN' },
      { tournament_id: TOURN_ID, user_id: P2_ID, status: 'CHECKED_IN' },
      { tournament_id: TOURN_ID, user_id: P3_ID, status: 'CHECKED_IN' },
      { tournament_id: TOURN_ID, user_id: P4_ID, status: 'CHECKED_IN' },
    ],
  });
}

/** Create the two semifinal rows (SF1: P1 vs P3, SF2: P2 vs P4). */
async function createSemifinals(opts: {
  sf1: { status: string; winner_id: string | null };
  sf2: { status: string; winner_id: string | null };
}) {
  await prisma.match.createMany({
    data: [
      {
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 1,
        phase: 'PLAYOFF_SF',
        player1_id: P1_ID,
        player2_id: P3_ID,
        status: opts.sf1.status as never,
        winner_id: opts.sf1.winner_id,
      },
      {
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 2,
        phase: 'PLAYOFF_SF',
        player1_id: P2_ID,
        player2_id: P4_ID,
        status: opts.sf2.status as never,
        winner_id: opts.sf2.winner_id,
      },
    ],
  });
}

async function advance(cookie: string) {
  return app.inject({
    method: 'POST',
    url: `/api/tournaments/${TOURN_ID}/advance-playoffs`,
    headers: { cookie },
  });
}

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(setup);
afterEach(cleanup);

describe('POST /advance-playoffs — resolution guard', () => {
  it('blocks (422) when a semifinal is CANCELLED (double-drop, no winner)', async () => {
    const cookie = await getAuthCookie(ADMIN_ID, 'ADMIN');
    await createSemifinals({
      sf1: { status: 'COMPLETED', winner_id: P1_ID },
      sf2: { status: 'CANCELLED', winner_id: null },
    });

    const res = await advance(cookie);
    expect(res.statusCode).toBe(422);

    const generated = await prisma.match.findMany({
      where: { tournament_id: TOURN_ID, phase: { in: ['PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] } },
    });
    expect(generated).toHaveLength(0);
  });

  it('blocks (422) when a semifinal is FORFEIT without a winner', async () => {
    const cookie = await getAuthCookie(ADMIN_ID, 'ADMIN');
    await createSemifinals({
      sf1: { status: 'COMPLETED', winner_id: P1_ID },
      sf2: { status: 'FORFEIT', winner_id: null },
    });

    const res = await advance(cookie);
    expect(res.statusCode).toBe(422);
  });

  it('advances (200) when both semifinals are COMPLETED — GF and third-place hold distinct players', async () => {
    const cookie = await getAuthCookie(ADMIN_ID, 'ADMIN');
    await createSemifinals({
      sf1: { status: 'COMPLETED', winner_id: P1_ID }, // loser P3
      sf2: { status: 'COMPLETED', winner_id: P2_ID }, // loser P4
    });

    const res = await advance(cookie);
    expect(res.statusCode).toBe(200);

    const gf = await prisma.match.findFirst({ where: { tournament_id: TOURN_ID, phase: 'PLAYOFF_FINAL' } });
    const third = await prisma.match.findFirst({ where: { tournament_id: TOURN_ID, phase: 'PLAYOFF_THIRD_PLACE' } });
    expect(gf).not.toBeNull();
    expect(third).not.toBeNull();

    const gfPlayers = [gf!.player1_id, gf!.player2_id].sort();
    const thirdPlayers = [third!.player1_id, third!.player2_id].sort();
    expect(gfPlayers).toEqual([P1_ID, P2_ID].sort());
    expect(thirdPlayers).toEqual([P3_ID, P4_ID].sort());
    // The two nodes must not share any player.
    expect(gfPlayers.some((id) => thirdPlayers.includes(id))).toBe(false);
  });

  it('advances (200) when a semifinal is FORFEIT with a winner (legitimate one-sided drop)', async () => {
    const cookie = await getAuthCookie(ADMIN_ID, 'ADMIN');
    await createSemifinals({
      sf1: { status: 'COMPLETED', winner_id: P1_ID },
      sf2: { status: 'FORFEIT', winner_id: P2_ID },
    });

    const res = await advance(cookie);
    expect(res.statusCode).toBe(200);

    const gf = await prisma.match.findFirst({ where: { tournament_id: TOURN_ID, phase: 'PLAYOFF_FINAL' } });
    expect(gf).not.toBeNull();
    expect([gf!.player1_id, gf!.player2_id].sort()).toEqual([P1_ID, P2_ID].sort());
  });
});

describe('POST /undrop — restores drop-caused playoff matches', () => {
  it('resets never-played playoff FORFEIT/CANCELLED matches but leaves Swiss and played matches alone', async () => {
    const cookie = await getAuthCookie(ADMIN_ID, 'ADMIN');

    // P3 dropped — mark withdrawn.
    await prisma.tournamentParticipant.updateMany({
      where: { tournament_id: TOURN_ID, user_id: P3_ID },
      data: { status: 'WITHDREW' },
    });

    // (a) Never-played playoff SF forfeited by P3's drop → should be restored.
    const playoffForfeit = await prisma.match.create({
      data: {
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 1,
        phase: 'PLAYOFF_SF',
        player1_id: P1_ID,
        player2_id: P3_ID,
        status: 'FORFEIT',
        winner_id: P1_ID,
        played_at: null,
      },
    });

    // (b) Swiss FORFEIT involving P3 → must stay untouched (reflects standings).
    const swissForfeit = await prisma.match.create({
      data: {
        tournament_id: TOURN_ID,
        round: 1,
        match_number: 2,
        phase: 'SWISS',
        player1_id: P2_ID,
        player2_id: P3_ID,
        status: 'FORFEIT',
        winner_id: P2_ID,
        played_at: null,
      },
    });

    // (c) Playoff match that was actually played (played_at set) → must stay.
    const playedPlayoff = await prisma.match.create({
      data: {
        tournament_id: TOURN_ID,
        round: 2,
        match_number: 1,
        phase: 'PLAYOFF_SF',
        player1_id: P4_ID,
        player2_id: P3_ID,
        status: 'FORFEIT',
        winner_id: P4_ID,
        played_at: new Date('2026-06-02'),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURN_SLUG}/participants/${P3_ID}/undrop`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ undroped: boolean; matchesRestored: number }>();
    expect(body.matchesRestored).toBe(1);

    const participant = await prisma.tournamentParticipant.findFirst({
      where: { tournament_id: TOURN_ID, user_id: P3_ID },
    });
    expect(participant!.status).toBe('CHECKED_IN');

    const a = await prisma.match.findUnique({ where: { id: playoffForfeit.id } });
    expect(a!.status).toBe('PENDING');
    expect(a!.winner_id).toBeNull();

    const b = await prisma.match.findUnique({ where: { id: swissForfeit.id } });
    expect(b!.status).toBe('FORFEIT');

    const c = await prisma.match.findUnique({ where: { id: playedPlayoff.id } });
    expect(c!.status).toBe('FORFEIT');
  });
});
