/**
 * Deleting a tournament (Alex 2026-10-10): its OPEN matches go with it, so nobody keeps a "current
 * match" in a tournament that no longer exists; finished games stay. Also: a superseded one-player
 * Swiss bye row (CANCELLED) is hidden from the bracket instead of rendering as "OUT vs TBD".
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createTestUser, createTestTournament, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const tournamentIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterEach(async () => {
  for (const id of tournamentIds) await cleanupTournament(id);
  if (userIds.length) await cleanupUsers(userIds);
  tournamentIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const cookieFor = (userId: string, role = 'USER') => ({ auth_token: app.jwt.sign({ sub: userId, username: 'test', role }) });

async function setup() {
  const [host, opp] = await Promise.all([createTestUser(), createTestUser()]);
  userIds.push(host.id, opp.id);
  const t = await createTestTournament({ organizerId: host.id });
  tournamentIds.push(t.id);
  const open = await prisma.match.create({
    data: { tournament_id: t.id, round: 2, match_number: 1, player1_id: host.id, player2_id: opp.id, status: 'PENDING', type: 'TOURNAMENT', phase: 'SWISS' },
  });
  const done = await prisma.match.create({
    data: { tournament_id: t.id, round: 1, match_number: 1, player1_id: host.id, player2_id: opp.id, status: 'COMPLETED', winner_id: host.id, type: 'TOURNAMENT', phase: 'SWISS' },
  });
  return { host, opp, t, open, done };
}

const activeMatchIds = async (userId: string) =>
  (await app.inject({ method: 'GET', url: '/api/me/active-matches', cookies: cookieFor(userId) }))
    .json<{ items: { matchId: string }[] }>()
    .items.map((i) => i.matchId);

describe('deleting a tournament', () => {
  it('removes its open matches, keeps finished ones, and clears the "current match"', async () => {
    const { host, t, open, done } = await setup();
    expect(await activeMatchIds(host.id)).toContain(open.id);

    const del = await app.inject({ method: 'DELETE', url: `/api/tournaments/${t.slug}`, cookies: cookieFor(host.id) });
    expect(del.statusCode).toBe(204);

    expect((await prisma.match.findUnique({ where: { id: open.id } }))!.deleted_at).not.toBeNull();
    expect((await prisma.match.findUnique({ where: { id: done.id } }))!.deleted_at).toBeNull();
    expect(await activeMatchIds(host.id)).not.toContain(open.id);
  });

  it('a leftover open match of an already-deleted tournament is not shown as current', async () => {
    const { host, t, open } = await setup();
    // Deleted before this fix: the tournament is gone but its match was never touched.
    await prisma.tournament.update({ where: { id: t.id }, data: { deleted_at: new Date() } });
    expect(await activeMatchIds(host.id)).not.toContain(open.id);
  });
});

describe('bracket: superseded Swiss bye rows', () => {
  it('hides a cancelled one-player Swiss row but keeps real matches', async () => {
    const { opp, t, open } = await setup();
    const stale = await prisma.match.create({
      data: { tournament_id: t.id, round: 2, match_number: 2, player1_id: opp.id, player2_id: null, status: 'CANCELLED', type: 'TOURNAMENT', phase: 'SWISS' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/${t.slug}/bracket` });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ matches: { matchId: string }[] }>().matches.map((m) => m.matchId);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(stale.id);
  });
});
