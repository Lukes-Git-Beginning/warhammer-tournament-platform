/**
 * Blind Pick faction bans (Alex 2026-10-10, requested by Humanboy): a BPT tournament can set
 * faction_bans_per_player (0–2). Per game, after the map, both sides ban blind; the bans are
 * revealed together and are unpickable for BOTH sides in that game's blind pick. A side that
 * doesn't ban within the timeout loses its bans.
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { autoResolveStaleBlindPicks, FACTION_BAN_TIMEOUT_MS } from '../src/lib/blind-pick-auto-resolve.js';
import { createTestUser, createTestTournament, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const tournamentIds: string[] = [];
let factions: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
  factions = (await prisma.faction.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 6 })).map((f) => f.id);
  expect(factions.length).toBe(6);
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

const cookieFor = (userId: string) => ({ auth_token: app.jwt.sign({ sub: userId, username: 'test', role: 'USER' }) });

/** A BPT tournament match whose current game has a decided map (the ban step comes right after). */
async function bptMatch(bansPerPlayer: number) {
  const [p1, p2] = await Promise.all([createTestUser(), createTestUser()]);
  userIds.push(p1.id, p2.id);
  const t = await createTestTournament({ organizerId: p1.id });
  tournamentIds.push(t.id);
  await prisma.tournament.update({ where: { id: t.id }, data: { mode: 'BPT', faction_bans_per_player: bansPerPlayer } });
  // Reuse the Open Play builder for the game + decided map, then attach the match to the tournament.
  const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'DOMINATION');
  await prisma.match.update({ where: { id: matchId }, data: { tournament_id: t.id, type: 'TOURNAMENT' } });
  return { matchId, p1, p2 };
}

const banLock = (matchId: string, userId: string, ids: string[]) =>
  app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/decision/faction-bans/lock`,
    cookies: cookieFor(userId),
    payload: { faction_ids: ids },
  });

const pickLock = (matchId: string, userId: string, factionId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/decision/blind-pick/lock`,
    cookies: cookieFor(userId),
    payload: { faction_id: factionId },
  });

type BanState = {
  perPlayer: number;
  player1Locked: boolean;
  player2Locked: boolean;
  revealedAt: string | null;
  player1Bans: string[];
  player2Bans: string[];
};
const decisionBans = async (matchId: string) =>
  (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/decision` })).json<{ factionBans: BanState | null }>()
    .factionBans;

describe('Blind Pick faction bans', () => {
  it('hides the bans until both sides locked, then reveals them to everyone', async () => {
    const { matchId, p1, p2 } = await bptMatch(2);
    expect(await decisionBans(matchId)).toMatchObject({ perPlayer: 2, player1Locked: false, revealedAt: null });

    const first = await banLock(matchId, p1.id, [factions[0]!, factions[1]!]);
    expect(first.statusCode).toBe(200);
    expect(first.json<BanState>()).toMatchObject({ player1Locked: true, player2Locked: false, player1Bans: [], revealedAt: null });

    const second = await banLock(matchId, p2.id, [factions[1]!, factions[2]!]); // overlap is fine
    expect(second.statusCode).toBe(200);
    const state = await decisionBans(matchId);
    expect(state?.revealedAt).not.toBeNull();
    expect(state?.player1Bans).toEqual([factions[0], factions[1]]);
    expect(state?.player2Bans).toEqual([factions[1], factions[2]]);
  });

  it('blocks the blind pick until the bans are revealed, then blocks banned factions for both sides', async () => {
    const { matchId, p1, p2 } = await bptMatch(1);
    expect((await pickLock(matchId, p1.id, factions[3]!)).statusCode).toBe(422); // ban step first

    await banLock(matchId, p1.id, [factions[0]!]);
    await banLock(matchId, p2.id, [factions[1]!]);

    // p1 can't pick the faction p1 banned, nor the one p2 banned.
    const ownBan = await pickLock(matchId, p1.id, factions[0]!);
    expect(ownBan.statusCode).toBe(422);
    expect(ownBan.json<{ message: string }>().message).toMatch(/banned for this game/i);
    expect((await pickLock(matchId, p1.id, factions[1]!)).statusCode).toBe(422);
    expect((await pickLock(matchId, p1.id, factions[3]!)).statusCode).toBe(200);
  });

  it('requires exactly the set number of distinct bans and rejects a second lock', async () => {
    const { matchId, p1 } = await bptMatch(2);
    expect((await banLock(matchId, p1.id, [factions[0]!])).statusCode).toBe(400);
    expect((await banLock(matchId, p1.id, [factions[0]!, factions[0]!])).statusCode).toBe(400);
    expect((await banLock(matchId, p1.id, [factions[0]!, factions[1]!])).statusCode).toBe(200);
    expect((await banLock(matchId, p1.id, [factions[2]!, factions[3]!])).statusCode).toBe(409);
  });

  it('only a match participant can ban', async () => {
    const { matchId } = await bptMatch(1);
    const outsider = await createTestUser();
    userIds.push(outsider.id);
    expect((await banLock(matchId, outsider.id, [factions[0]!])).statusCode).toBe(403);
  });

  it('bans off (0): no ban step — the decision state has none and the pick works directly', async () => {
    const { matchId, p1 } = await bptMatch(0);
    expect(await decisionBans(matchId)).toBeNull();
    expect((await banLock(matchId, p1.id, [factions[0]!])).statusCode).toBe(422);
    expect((await pickLock(matchId, p1.id, factions[0]!)).statusCode).toBe(200);
  });

  it('a side that does not ban in time loses its bans; the game moves on to the pick', async () => {
    const { matchId, p1, p2 } = await bptMatch(2);
    await banLock(matchId, p1.id, [factions[0]!, factions[1]!]);
    // Age p1's lock past the timeout.
    await prisma.matchBlindPick.updateMany({
      where: { game: { match_id: matchId } },
      data: { player1_bans_locked_at: new Date(Date.now() - FACTION_BAN_TIMEOUT_MS - 1000) },
    });
    await autoResolveStaleBlindPicks(app);

    const state = await decisionBans(matchId);
    expect(state?.revealedAt).not.toBeNull();
    expect(state?.player1Bans).toEqual([factions[0], factions[1]]);
    expect(state?.player2Bans).toEqual([]);
    expect((await pickLock(matchId, p2.id, factions[2]!)).statusCode).toBe(200);
  });

  it('the pick timeout never auto-assigns a banned faction', async () => {
    const { matchId, p1, p2 } = await bptMatch(2);
    // Restrict the pool to 5 factions; ban 4 of them → the only legal random pick is the 5th.
    const t = await prisma.match.findUnique({ where: { id: matchId }, select: { tournament_id: true } });
    await prisma.tournamentFactionAllowlist.createMany({
      data: factions.slice(0, 5).map((faction_id) => ({ tournament_id: t!.tournament_id!, faction_id })),
    });
    await banLock(matchId, p1.id, [factions[0]!, factions[1]!]);
    await banLock(matchId, p2.id, [factions[2]!, factions[3]!]);
    // p1 picks the last unbanned faction; p2 times out → random pick from what's left.
    expect((await pickLock(matchId, p1.id, factions[4]!)).statusCode).toBe(200);
    await prisma.matchBlindPick.updateMany({
      where: { game: { match_id: matchId } },
      data: { player1_locked_at: new Date(Date.now() - 3 * 60 * 1000) },
    });
    await autoResolveStaleBlindPicks(app);
    const row = await prisma.matchBlindPick.findFirst({ where: { game: { match_id: matchId } } });
    expect(row?.revealed_at).not.toBeNull();
    expect(row?.player2_faction_id).toBe(factions[4]); // the only allowed faction nobody banned
  });
});
