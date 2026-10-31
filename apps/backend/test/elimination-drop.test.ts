/**
 * A drop from a Single / Double Elimination tournament takes the player out of his open match:
 * the opponent advances by walkover right away (also mid-series, with the played game kept), a
 * waiting slot is cleared so the arriving player gets a bye, and a DE loser who dropped is not sent
 * on to the losers bracket. Plus the per-game faction state the game tile reads (Bo3 game 2).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { completeMatch } from '../src/lib/complete-match.js';
import { prisma } from '@rizzotto/db';

const HOST_ID = '3f000000-0000-0000-0000-000000000001';
const PLAYER_IDS = [
  '3f000000-0000-0000-0000-000000000002',
  '3f000000-0000-0000-0000-000000000003',
  '3f000000-0000-0000-0000-000000000004',
  '3f000000-0000-0000-0000-000000000005',
];
const T_ID = '3f000000-0000-0000-0001-000000000001';
const T_SLUG = `elimination-drop-test-${T_ID}`;

let app: FastifyInstance;

async function cookieFor(userId: string, role: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/test-login', payload: { userId, role } });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('test-login did not return a set-cookie header');
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { entity_id: T_ID } });
  await prisma.auditLog.deleteMany({ where: { actor_id: HOST_ID } });
  await prisma.match.deleteMany({ where: { tournament_id: T_ID } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: T_ID } });
  await prisma.tournament.deleteMany({ where: { id: T_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, ...PLAYER_IDS] } } });
}

/** A started 4-player bracket (via the real start route). */
async function startBracket(format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION', mode: 'BPT' | 'MATRIX' = 'BPT') {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: HOST_ID, discord_id: 'dc-host-elimdrop', username: 'host_elimdrop', role: 'HOST' },
      ...PLAYER_IDS.map((id, i) => ({ id, discord_id: `dc-p${i}-elimdrop`, username: `p${i}_elimdrop`, role: 'USER' as const })),
    ],
  });
  await prisma.tournament.create({
    data: {
      id: T_ID,
      name: 'Elimination Drop Test',
      slug: T_SLUG,
      format,
      mode,
      status: 'REGISTRATION_CLOSED',
      host_id: HOST_ID,
      start_date: new Date('2026-06-01'),
      timezone: 'UTC',
    },
  });
  await prisma.tournamentParticipant.createMany({
    data: PLAYER_IDS.map((user_id) => ({ tournament_id: T_ID, user_id, status: 'CHECKED_IN' as const })),
  });
  const res = await app.inject({
    method: 'POST',
    url: `/api/tournaments/${T_ID}/start`,
    headers: { cookie: await cookieFor(HOST_ID, 'HOST') },
  });
  expect(res.statusCode).toBe(200);
}

async function drop(userId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/tournaments/${T_SLUG}/participants/${userId}/drop`,
    headers: { cookie: await cookieFor(HOST_ID, 'HOST') },
  });
  expect(res.statusCode).toBe(200);
}

const getMatch = (id: string) => prisma.match.findUniqueOrThrow({ where: { id } });

/** The two first-round matches with both players set (WB R1 for DE). */
async function firstRound() {
  const all = await prisma.match.findMany({
    where: { tournament_id: T_ID, deleted_at: null, round: 1, player1_id: { not: null }, player2_id: { not: null } },
    orderBy: { match_number: 'asc' },
  });
  return all.filter((m) => m.bracket_side === null || m.bracket_side === 'WINNERS');
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

describe('Single Elimination drop', () => {
  it('the opponent wins by walkover and advances', async () => {
    await startBracket('SINGLE_ELIMINATION');
    const [m1] = await firstRound();
    const dropped = m1!.player1_id!;
    const opponent = m1!.player2_id!;

    await drop(dropped);

    const settled = await getMatch(m1!.id);
    expect(settled.status).toBe('FORFEIT');
    expect(settled.winner_id).toBe(opponent);
    expect(settled.score).toBe('W/O');
    expect(settled.withdrawn_player_id).toBe(dropped);
    const next = await getMatch(m1!.next_match_id!);
    expect([next.player1_id, next.player2_id]).toContain(opponent);
    expect([next.player1_id, next.player2_id]).not.toContain(dropped);
  });

  it('mid-series: the played game stays, the unplayed one goes, the opponent advances', async () => {
    await startBracket('SINGLE_ELIMINATION');
    const [m1] = await firstRound();
    const dropped = m1!.player1_id!;
    const opponent = m1!.player2_id!;
    await prisma.match.update({ where: { id: m1!.id }, data: { status: 'ONGOING' } });
    await prisma.matchGame.create({
      data: { match_id: m1!.id, game_number: 1, status: 'COMPLETED', winner_id: dropped, reported_winner_id: dropped, confirmed_at: new Date() },
    });
    await prisma.matchGame.create({ data: { match_id: m1!.id, game_number: 2, status: 'PENDING' } });

    await drop(dropped);

    const settled = await getMatch(m1!.id);
    expect(settled.status).toBe('FORFEIT');
    expect(settled.winner_id).toBe(opponent);
    const games = await prisma.matchGame.findMany({ where: { match_id: m1!.id }, orderBy: { game_number: 'asc' } });
    expect(games.map((g) => g.game_number)).toEqual([1]);
    const next = await getMatch(m1!.next_match_id!);
    expect([next.player1_id, next.player2_id]).toContain(opponent);
  });

  it('a player waiting for his next opponent is cleared, and the arriving player gets a bye', async () => {
    await startBracket('SINGLE_ELIMINATION');
    const [m1, m2] = await firstRound();
    const finalId = m1!.next_match_id!;

    // m1 goes to its player2 by walkover, who now waits in the final.
    await drop(m1!.player1_id!);
    const waiting = m1!.player2_id!;
    expect([(await getMatch(finalId)).player1_id, (await getMatch(finalId)).player2_id]).toContain(waiting);

    // The waiting player drops too: his final slot is cleared.
    await drop(waiting);
    const cleared = await getMatch(finalId);
    expect([cleared.player1_id, cleared.player2_id]).not.toContain(waiting);
    expect(cleared.status).toBe('PENDING');

    // m2 is decided normally; its winner reaches the final and takes it on a bye.
    await completeMatch(app, { matchId: m2!.id, winnerId: m2!.player1_id, actorId: HOST_ID, skipStats: true });
    const final = await getMatch(finalId);
    expect(final.status).toBe('BYE');
    expect(final.winner_id).toBe(m2!.player1_id);
  });

  it('a voided walkover cannot be applied twice', async () => {
    await startBracket('SINGLE_ELIMINATION');
    const [m1] = await firstRound();
    await drop(m1!.player1_id!);
    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${m1!.id}/void-dropped`,
      headers: { cookie: await cookieFor(HOST_ID, 'HOST') },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('Double Elimination drop', () => {
  it('the dropped loser is not sent to the losers bracket; the other loser gets a bye there', async () => {
    await startBracket('DOUBLE_ELIMINATION');
    const [m1, m2] = await firstRound();
    const dropped = m1!.player1_id!;
    const opponent = m1!.player2_id!;
    const lbId = m1!.loser_next_match_id!;
    expect(lbId).toBe(m2!.loser_next_match_id);

    await drop(dropped);

    const settled = await getMatch(m1!.id);
    expect(settled.status).toBe('FORFEIT');
    expect(settled.winner_id).toBe(opponent);
    const wbFinal = await getMatch(m1!.next_match_id!);
    expect([wbFinal.player1_id, wbFinal.player2_id]).toContain(opponent);
    const lb = await getMatch(lbId);
    expect([lb.player1_id, lb.player2_id]).not.toContain(dropped);

    // m2's loser lands in that losers-bracket match alone and advances on a bye.
    const m2Loser = m2!.player2_id!;
    await completeMatch(app, { matchId: m2!.id, winnerId: m2!.player1_id, actorId: HOST_ID, skipStats: true });
    const lbAfter = await getMatch(lbId);
    expect(lbAfter.status).toBe('BYE');
    expect(lbAfter.winner_id).toBe(m2Loser);
    const lbNext = await getMatch(lbAfter.next_match_id!);
    expect([lbNext.player1_id, lbNext.player2_id]).toContain(m2Loser);
  });

  it('both first-round losers dropped: the empty losers match closes and the bracket moves on', async () => {
    await startBracket('DOUBLE_ELIMINATION');
    const [m1, m2] = await firstRound();
    const lbId = m1!.loser_next_match_id!;

    await drop(m1!.player1_id!);
    await drop(m2!.player1_id!);

    const lb = await getMatch(lbId);
    expect(lb.status).toBe('FORFEIT');
    expect(lb.winner_id).toBeNull();
  });
});

describe('Bo3 game tile faction state', () => {
  it('game 2 of a MATRIX match is not decided just because game 1 was', async () => {
    await startBracket('SINGLE_ELIMINATION', 'MATRIX');
    const [m1] = await firstRound();
    await prisma.match.update({ where: { id: m1!.id }, data: { status: 'ONGOING' } });
    const g1 = await prisma.matchGame.create({
      data: { match_id: m1!.id, game_number: 1, status: 'COMPLETED', winner_id: m1!.player1_id, player1_faction_id: 'f-a', player2_faction_id: 'f-x' },
    });
    await prisma.matchFactionMatrix.create({
      data: { game_id: g1.id, p1_factions: ['f-a', 'f-b', 'f-c'], p2_factions: ['f-x', 'f-y', 'f-z'], picked_cell: '0,0', revealed_at: new Date(), decided_at: new Date() },
    });
    const g2 = await prisma.matchGame.create({ data: { match_id: m1!.id, game_number: 2, status: 'PENDING' } });
    await prisma.matchMapDecision.create({
      data: {
        game_id: g2.id, mode: 'RANDOM', coin_flip_seed: 's', top_player_id: m1!.player1_id!, bottom_player_id: m1!.player2_id!,
        bans_top: [], bans_bottom: [], picked_map_id: 'map-1', decided_at: new Date(),
      },
    });

    const viewer = { cookie: await cookieFor(m1!.player1_id!, 'USER') };
    const res = await app.inject({ method: 'GET', url: `/api/matches/${m1!.id}/games`, headers: viewer });
    expect(res.statusCode).toBe(200);
    const games = res.json<{ games: { gameNumber: number; factionsDecided: boolean; pickedFactions: unknown }[] }>().games;
    const [game1, game2] = [games.find((g) => g.gameNumber === 1)!, games.find((g) => g.gameNumber === 2)!];
    expect(game1.factionsDecided).toBe(true);
    expect(game1.pickedFactions).toEqual({ player1FactionId: 'f-a', player2FactionId: 'f-x' });
    expect(game2.factionsDecided).toBe(false);
    expect(game2.pickedFactions).toBeNull();

    // Once game 2's own matrix is decided, it is.
    await prisma.matchFactionMatrix.create({
      data: { game_id: g2.id, p1_factions: ['f-a', 'f-b', 'f-c'], p2_factions: ['f-x', 'f-y', 'f-z'], picked_cell: '1,2', revealed_at: new Date(), decided_at: new Date() },
    });
    const after = (await app.inject({ method: 'GET', url: `/api/matches/${m1!.id}/games`, headers: viewer }))
      .json<{ games: { gameNumber: number; factionsDecided: boolean; pickedFactions: unknown }[] }>().games
      .find((g) => g.gameNumber === 2)!;
    expect(after.factionsDecided).toBe(true);
    expect(after.pickedFactions).toEqual({ player1FactionId: 'f-b', player2FactionId: 'f-z' });
  });
});
