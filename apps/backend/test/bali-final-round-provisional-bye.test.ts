/**
 * Final-round byes are PROVISIONAL (2026-10-12, perfect-balance follow-up). A final-round bye used to
 * score immediately, so when TL dropped in R5 his opponent BERRSERK got a second final-round bye
 * beside anderland's instead of the two playing each other. Now a final-round bye starts as a
 * PENDING_BYE like every other round and:
 *   - RECLAIM:     a player freed in the final round (opponent dropped) turns it into a real match,
 *   - SETTLE:      once the whole group phase is through it crystallises into a scored bye,
 *   - EARLY START: a division whose bands finished early still starts on time — the bye's point
 *                  already counts for the seeding, and it crystallises as soon as the holder is seated.
 *
 * Drives the real runBalancedPairingTick. Requires PostgreSQL with the balanced schema.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { runBalancedPairingTick, scoreProvisionalFinalByes } from '../src/lib/balanced-liechtenstein-service.js';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ withSocket: false, withRedis: false, withCron: false }); await app.ready(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];
afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

async function setup(bands: number[], opts: { playoffFormat?: 'TOP2' } = {}) {
  const users: TestUser[] = [];
  for (let i = 0; i < bands.length; i++) users.push(await createTestUser({ username: `FRB${i}` }));
  createdUserIds.push(...users.map((u) => u.id));
  const tournamentId = randomUUID();
  createdTournamentIds.push(tournamentId);
  await prisma.tournament.create({
    data: {
      id: tournamentId, slug: `test-frb-${tournamentId.slice(0, 8)}`, name: 'BaLi final-round bye',
      host_id: users[0]!.id, format: 'BALANCED_LIECHTENSTEIN', status: 'ONGOING', rounds_count: 2,
      start_date: new Date('2026-06-01'), timezone: 'Europe/Berlin',
      ...(opts.playoffFormat ? { playoff_format: opts.playoffFormat } : {}),
    },
  });
  await prisma.tournamentParticipant.createMany({
    data: users.map((u, i) => ({ tournament_id: tournamentId, user_id: u.id, status: 'CHECKED_IN' as const, skill_band: bands[i]! })),
  });
  let n = 1;
  const match = async (round: number, a: TestUser, b: TestUser | null, status: 'PENDING' | 'COMPLETED' | 'BYE', winner?: TestUser) => {
    const id = randomUUID();
    await prisma.match.create({
      data: {
        id, tournament_id: tournamentId, round, match_number: n++, player1_id: a.id, player2_id: b?.id ?? null,
        status, winner_id: winner?.id ?? (status === 'BYE' ? a.id : null), phase: null,
      },
    });
    return id;
  };
  return { tournamentId, users, match };
}

const rowsOf = (tournamentId: string) =>
  prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { id: true, round: true, player1_id: true, player2_id: true, status: true, winner_id: true, phase: true },
    orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
  });

describe('BaLi — final-round byes are provisional', () => {
  it('turns the provisional bye into a real match when a final-round opponent drops', async () => {
    const { tournamentId, users, match } = await setup([3, 3, 3, 3, 3]);
    const [x, y, z, w, v] = users as [TestUser, TestUser, TestUser, TestUser, TestUser];
    await match(1, x, w, 'COMPLETED', x);
    await match(1, y, v, 'COMPLETED', y);
    await match(1, z, null, 'BYE');
    const yz = await match(2, y, z, 'PENDING');
    await match(2, w, v, 'PENDING');

    // X is the odd one out of the closed final round → a bye, but only a provisional one while
    // other final-round games are still running.
    await runBalancedPairingTick(app, tournamentId);
    const xBye = (await rowsOf(tournamentId)).find((m) => m.round === 2 && m.player1_id === x.id && m.player2_id === null);
    expect(xBye?.status).toBe('PENDING_BYE');

    // Z drops mid-game → Y is free in the final round. Instead of a second bye, Y takes X's bye.
    await prisma.tournamentParticipant.updateMany({ where: { tournament_id: tournamentId, user_id: z.id }, data: { status: 'WITHDREW' } });
    await prisma.match.update({ where: { id: yz }, data: { status: 'CANCELLED', withdrawn_player_id: z.id } });
    await runBalancedPairingTick(app, tournamentId);

    const r2 = (await rowsOf(tournamentId)).filter((m) => m.round === 2 && m.status !== 'CANCELLED');
    expect(r2.filter((m) => m.player2_id === null), `no bye left in R2: ${JSON.stringify(r2)}`).toEqual([]);
    const xy = r2.find((m) => new Set([m.player1_id, m.player2_id]).has(x.id));
    expect(new Set([xy?.player1_id, xy?.player2_id])).toEqual(new Set([x.id, y.id]));
    expect(xy?.status).toBe('PENDING');
  });

  it('settles the provisional bye into a scored bye once the group phase is through', async () => {
    const { tournamentId, users, match } = await setup([3, 3, 3, 3, 3]);
    const [x, y, z, w, v] = users as [TestUser, TestUser, TestUser, TestUser, TestUser];
    await match(1, x, w, 'COMPLETED', x);
    await match(1, y, v, 'COMPLETED', y);
    await match(1, z, null, 'BYE');
    const yz = await match(2, y, z, 'PENDING');
    const wv = await match(2, w, v, 'PENDING');
    await runBalancedPairingTick(app, tournamentId);

    await prisma.match.updateMany({ where: { id: { in: [yz, wv] } }, data: { status: 'COMPLETED' } });
    await runBalancedPairingTick(app, tournamentId);

    const xBye = (await rowsOf(tournamentId)).find((m) => m.round === 2 && m.player1_id === x.id && m.player2_id === null);
    expect(xBye?.status).toBe('BYE');
    expect(xBye?.winner_id).toBe(x.id);
  });

  it('starts a finished division on time, seeding the bye point, and then settles the bye', async () => {
    // Two divisions (TOP2 → own-band pools of ≥4): five b5s (finished) and four b2s (still in R2).
    const { tournamentId, users, match } = await setup([5, 5, 5, 5, 5, 2, 2, 2, 2], { playoffFormat: 'TOP2' });
    const [x, b1, b2, b3, b4, l1, l2, l3, l4] = users as TestUser[] as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
    await match(1, x, b1, 'COMPLETED', x);
    await match(1, b2, b3, 'COMPLETED', b2);
    await match(1, b4, null, 'BYE');
    await match(1, l1, l2, 'COMPLETED', l1);
    await match(1, l3, l4, 'COMPLETED', l3);
    await match(2, b2, b4, 'COMPLETED', b2);
    await match(2, b1, b3, 'COMPLETED', b1);
    await match(2, l1, l3, 'PENDING');
    await match(2, l2, l4, 'PENDING');

    // X is the odd b5 → final-round bye. Only with that point does X (1 win + bye = 2) make the
    // band-5 final beside B2 (2 wins); without it B4 (bye + loss, stronger Buchholz) would edge X out.
    await runBalancedPairingTick(app, tournamentId);

    const rows = await rowsOf(tournamentId);
    const final = rows.find((m) => m.phase === 'PLAYOFF_FINAL');
    expect(final, 'the finished band-5 division starts while the b2s are still playing').toBeDefined();
    expect(new Set([final!.player1_id, final!.player2_id])).toEqual(new Set([x.id, b2.id]));
    const xBye = rows.find((m) => m.round === 2 && m.player1_id === x.id && m.player2_id === null);
    expect(xBye?.status, 'seated in the playoffs → the bye can no longer be reclaimed').toBe('BYE');
    expect(xBye?.winner_id).toBe(x.id);
    expect(rows.filter((m) => m.phase === 'PLAYOFF_FINAL')).toHaveLength(1); // b2 division still open
  });
});

describe('scoreProvisionalFinalByes', () => {
  const row = (round: number, p1: string, p2: string | null, status: string, winner: string | null = null) => ({
    round, player1_id: p1, player2_id: p2, status, winner_id: winner,
  });

  it('scores a final-round PENDING_BYE as a BYE for its holder', () => {
    const out = scoreProvisionalFinalByes([row(3, 'a', null, 'PENDING_BYE')], 3, new Set());
    expect(out[0]).toMatchObject({ status: 'BYE', winner_id: 'a' });
  });

  it('leaves earlier-round pending byes and a catching-up late joiner unscored', () => {
    const rows = [row(2, 'a', null, 'PENDING_BYE'), row(3, 'late', null, 'PENDING_BYE'), row(1, 'late', null, 'CATCHUP_BYE')];
    const out = scoreProvisionalFinalByes(rows, 3, new Set(['late']));
    expect(out.map((m) => m.status)).toEqual(['PENDING_BYE', 'PENDING_BYE', 'CATCHUP_BYE']);
  });

  it('scores a late joiner who has already played a real game', () => {
    const rows = [row(2, 'late', 'b', 'COMPLETED', 'b'), row(3, 'late', null, 'PENDING_BYE')];
    expect(scoreProvisionalFinalByes(rows, 3, new Set(['late']))[1]).toMatchObject({ status: 'BYE', winner_id: 'late' });
  });
});
