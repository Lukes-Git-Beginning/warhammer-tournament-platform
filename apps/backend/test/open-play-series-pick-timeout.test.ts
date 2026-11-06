/**
 * Open Play pick timeout in a series: when neither player has picked, the 5-minute deadline runs
 * from the GAME's creation, not the match's. Game 2 of a Bo3 is created when game 1 is confirmed,
 * long after the match was, and must not be cancelled (with a no-show strike for both) at once.
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { autoResolveStaleBlindPicks, OPEN_PLAY_BLIND_PICK_TIMEOUT_MS } from '../src/lib/blind-pick-auto-resolve.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const matchIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterEach(async () => {
  // The cancel logs a CANCEL per player, which references the users.
  await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: userIds } } });
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (userIds.length) await cleanupUsers(userIds);
  matchIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const ago = (ms: number) => new Date(Date.now() - ms);
const LONG_AGO = 40 * 60 * 1000; // a played game 1
const PAST_DEADLINE = OPEN_PLAY_BLIND_PICK_TIMEOUT_MS + 60 * 1000;

/** A Bo3 Open Play match created 40 minutes ago whose game 1 is done and game 2 was just created. */
async function seriesAtGameTwo() {
  const [p1, p2] = await Promise.all([createTestUser(), createTestUser()]);
  userIds.push(p1.id, p2.id);
  const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'CONQUEST', 'ONE_V_ONE', 'BO3');
  matchIds.push(matchId);
  await prisma.match.update({ where: { id: matchId }, data: { created_at: ago(LONG_AGO) } });
  await prisma.matchGame.updateMany({
    where: { match_id: matchId, game_number: 1 },
    data: { status: 'COMPLETED', winner_id: p1.id, created_at: ago(LONG_AGO) },
  });
  const pickedAt = ago(LONG_AGO - 60 * 1000);
  await prisma.matchBlindPick.updateMany({
    where: { game: { match_id: matchId, game_number: 1 } },
    data: { player1_faction_id: 'empire', player2_faction_id: 'dwarfs', player1_locked_at: pickedAt, player2_locked_at: pickedAt, revealed_at: pickedAt },
  });
  const game2 = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: 2, battle_type: 'CONQUEST', blind_pick: { create: {} } },
  });
  return { matchId, game2Id: game2.id };
}

const status = async (matchId: string) =>
  (await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true } })).status;

describe('Open Play pick timeout in a series', () => {
  it('leaves a freshly created game 2 alone although the match is older than the deadline', async () => {
    const { matchId } = await seriesAtGameTwo();
    await autoResolveStaleBlindPicks(app);
    expect(await status(matchId)).toBe('ONGOING');
  });

  it('cancels once nobody has picked for game 2 within the deadline', async () => {
    const { matchId, game2Id } = await seriesAtGameTwo();
    await prisma.matchGame.update({ where: { id: game2Id }, data: { created_at: ago(PAST_DEADLINE) } });
    await autoResolveStaleBlindPicks(app);
    expect(await status(matchId)).toBe('CANCELLED');
    // Game 1 keeps its result; only the unplayed game 2 is cancelled.
    const games = await prisma.matchGame.findMany({ where: { match_id: matchId }, orderBy: { game_number: 'asc' }, select: { status: true } });
    expect(games.map((g) => g.status)).toEqual(['COMPLETED', 'CANCELLED']);
  });

  it('still cancels a game 1 nobody picked for within the deadline', async () => {
    const [p1, p2] = await Promise.all([createTestUser(), createTestUser()]);
    userIds.push(p1.id, p2.id);
    const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'DOMINATION');
    matchIds.push(matchId);
    await prisma.match.update({ where: { id: matchId }, data: { created_at: ago(PAST_DEADLINE) } });
    await prisma.matchGame.updateMany({ where: { match_id: matchId }, data: { created_at: ago(PAST_DEADLINE) } });
    await autoResolveStaleBlindPicks(app);
    expect(await status(matchId)).toBe('CANCELLED');
  });
});
