/**
 * Hidden replays (Alex 2026-11-06): a player can keep his replays hidden for 30 days after each game. A game's
 * replay is hidden while either of its players has the option on (read live). The game's players and staff
 * still see it; everyone else gets no link, and the file itself answers 403.
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { REPLAY_DIR } from '../src/lib/replays.js';
import { REPLAY_HIDE_DAYS } from '../src/lib/replay-privacy.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const matchIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterEach(async () => {
  for (const id of matchIds) await rm(join(REPLAY_DIR, id), { recursive: true, force: true });
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (userIds.length) await cleanupUsers(userIds);
  matchIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const DAY = 24 * 60 * 60 * 1000;
const cookieFor = (u: TestUser) => ({ auth_token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) });

/** A played Open Play game between a and b, with its replay on disk. */
async function playedGame(a: TestUser, b: TestUser, playedAt = new Date()) {
  const { matchId } = await createOpenPlayMatch(prisma, a.id, b.id, 'QUEUE', 'DOMINATION');
  matchIds.push(matchId);
  const replayUrl = `/uploads/replays/${matchId}/game1.replay`;
  await mkdir(join(REPLAY_DIR, matchId), { recursive: true });
  await writeFile(join(REPLAY_DIR, matchId, 'game1.replay'), Buffer.from([0xcb, 0xab, 0, 0]));
  await prisma.match.update({ where: { id: matchId }, data: { status: 'COMPLETED', winner_id: a.id, played_at: playedAt } });
  await prisma.matchGame.updateMany({
    where: { match_id: matchId },
    data: { status: 'COMPLETED', winner_id: a.id, replay_url: replayUrl, played_at: playedAt, player1_faction_id: 'empire', player2_faction_id: 'dwarfs' },
  });
  return { matchId, replayUrl };
}

async function people() {
  const [a, b, c, admin] = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
  userIds.push(a.id, b.id, c.id, admin.id);
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  return { a, b, c, admin };
}

const listRow = async (playerId: string, viewer?: TestUser) => {
  const res = await app.inject({ method: 'GET', url: `/api/meta/games?playerId=${playerId}`, ...(viewer ? { cookies: cookieFor(viewer) } : {}) });
  return (res.json() as { games: { replayUrl: string | null; replayHiddenUntil: string | null }[] }).games[0]!;
};
const fileStatus = async (url: string, viewer?: TestUser) =>
  (await app.inject({ method: 'GET', url, ...(viewer ? { cookies: cookieFor(viewer) } : {}) })).statusCode;
const hide = (u: TestUser, hidden: boolean) =>
  app.inject({ method: 'PUT', url: '/api/users/me/replay-privacy', cookies: cookieFor(u), payload: { hidden } });

describe('hidden replays', () => {
  it('stays open while nobody hides his replays', async () => {
    const { a, b, c } = await people();
    const { replayUrl } = await playedGame(a, b);
    expect((await listRow(a.id, c)).replayUrl).toBe(replayUrl);
    expect(await fileStatus(replayUrl, c)).toBe(200);
  });

  it('hides a fresh replay from everyone but the players and staff once one player turns it on', async () => {
    const { a, b, c, admin } = await people();
    const playedAt = new Date();
    const { matchId, replayUrl } = await playedGame(a, b, playedAt);
    expect((await hide(b, true)).json()).toEqual({ hidden: true, days: REPLAY_HIDE_DAYS });

    const outsider = await listRow(a.id, c);
    expect(outsider.replayUrl).toBeNull();
    expect(new Date(outsider.replayHiddenUntil!).getTime()).toBe(playedAt.getTime() + REPLAY_HIDE_DAYS * DAY);
    expect((await listRow(a.id)).replayUrl).toBeNull(); // signed out
    expect((await listRow(a.id, a)).replayUrl).toBe(replayUrl); // the opponent of the one who hides
    expect((await listRow(a.id, admin)).replayUrl).toBe(replayUrl);

    const tile = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/games`, cookies: cookieFor(c) })).json() as {
      games: { replayUrl: string | null; replayHiddenUntil?: string }[];
    };
    expect(tile.games[0]!.replayUrl).toBeNull();
    expect(tile.games[0]!.replayHiddenUntil).toBeTruthy();

    expect(await fileStatus(replayUrl, c)).toBe(403);
    expect(await fileStatus(replayUrl)).toBe(403);
    expect(await fileStatus(replayUrl, a)).toBe(200);
    expect(await fileStatus(replayUrl, admin)).toBe(200);

    // Turned off again: open at once.
    await hide(b, false);
    expect((await listRow(a.id, c)).replayUrl).toBe(replayUrl);
    expect(await fileStatus(replayUrl, c)).toBe(200);
  });

  it('opens a replay 30 days after its game', async () => {
    const { a, b, c } = await people();
    const { replayUrl } = await playedGame(a, b, new Date(Date.now() - (REPLAY_HIDE_DAYS * DAY + 60_000)));
    await hide(a, true);
    expect((await listRow(a.id, c)).replayUrl).toBe(replayUrl);
    expect(await fileStatus(replayUrl, c)).toBe(200);
  });

  it('reads the setting back', async () => {
    const { a } = await people();
    const get = async () => (await app.inject({ method: 'GET', url: '/api/users/me/replay-privacy', cookies: cookieFor(a) })).json();
    expect(await get()).toEqual({ hidden: false, days: REPLAY_HIDE_DAYS });
    await hide(a, true);
    expect(await get()).toEqual({ hidden: true, days: REPLAY_HIDE_DAYS });
  });
});
