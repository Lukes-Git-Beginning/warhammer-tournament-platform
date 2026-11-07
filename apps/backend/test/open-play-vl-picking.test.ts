/**
 * VL picking in Open Play (plans/discord-open-play.md §11, 2026-11-06):
 *  - the weekly ban on the profile: one faction, changeable 7 days after the last change, banned for both sides in
 *    every Open Play match of its player (snapshot per match);
 *  - the 3×3 matrix for a 1v1 Bo3 in Land Battle or Conquest, anew every game; its three picks follow Open Play's
 *    pick rule (5 minutes, then cancelled).
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createOpenPlayMatch, openPlayPickMode } from '../src/lib/create-open-play-match.js';
import { autoResolveStaleBlindPicks, OPEN_PLAY_BLIND_PICK_TIMEOUT_MS } from '../src/lib/blind-pick-auto-resolve.js';
import { autoResolveStaleMatrixActions, MATRIX_PICK_TIMEOUT_MS } from '../src/lib/matrix-auto-resolve.js';
import { finalizeGameResult } from '../src/lib/match-games.js';
import { WEEKLY_BAN_LOCK_DAYS } from '../src/lib/weekly-ban.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const matchIds: string[] = [];
let factions: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
  // Factions no Standard Ruleset bans by default (it bans Undead Legions).
  factions = (
    await prisma.faction.findMany({ where: { id: { not: 'undead_legions' } }, select: { id: true }, orderBy: { id: 'asc' }, take: 8 })
  ).map((f) => f.id);
  expect(factions.length).toBe(8);
});

afterEach(async () => {
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

const cookieFor = (userId: string, role = 'USER') => ({ auth_token: app.jwt.sign({ sub: userId, username: 'test', role }) });
const ago = (ms: number) => new Date(Date.now() - ms);
const DAY = 24 * 60 * 60 * 1000;

async function players() {
  const [p1, p2] = await Promise.all([createTestUser(), createTestUser()]);
  userIds.push(p1.id, p2.id);
  return { p1, p2 };
}

const setBan = (userId: string, factionId: string | null) =>
  app.inject({ method: 'PUT', url: '/api/users/me/weekly-ban', cookies: cookieFor(userId), payload: { factionId } });

async function openPlay(p1: string, p2: string, battleType: 'CONQUEST' | 'LAND_BATTLE' | 'DOMINATION', format: 'BO1' | 'BO3') {
  const { matchId } = await createOpenPlayMatch(prisma, p1, p2, 'QUEUE', battleType, 'ONE_V_ONE', format);
  matchIds.push(matchId);
  return matchId;
}

const decision = async (matchId: string, userId: string) =>
  (await app.inject({ method: 'GET', url: `/api/matches/${matchId}/decision`, cookies: cookieFor(userId) })).json() as {
    tournamentMode: string;
    bannedFactions: string[];
    weeklyBans: { userId: string; username: string; factionId: string }[];
    factionMatrix: { revealedAt: string | null; decidedAt: string | null; topPlayerId: string; bottomPlayerId: string } | null;
  };

const matrixLock = (matchId: string, userId: string, picks: string[]) =>
  app.inject({ method: 'POST', url: `/api/matches/${matchId}/matrix/lock`, cookies: cookieFor(userId), payload: { factions: picks } });
const matrixStrike = (matchId: string, userId: string, row: number, col: number) =>
  app.inject({ method: 'POST', url: `/api/matches/${matchId}/matrix/ban`, cookies: cookieFor(userId), payload: { row, col } });

describe('weekly ban on the profile', () => {
  it('sets one at once, then locks every new one for 7 days', async () => {
    const { p1 } = await players();
    expect((await setBan(p1.id, factions[0]!)).statusCode).toBe(200);

    const again = await setBan(p1.id, factions[1]!);
    expect(again.statusCode).toBe(409);
    const opensAt = new Date(again.json().opensAt as string).getTime();
    expect(Math.abs(opensAt - (Date.now() + WEEKLY_BAN_LOCK_DAYS * DAY))).toBeLessThan(60_000);
    // The same faction again changes nothing, and doesn't restart the lock.
    expect((await setBan(p1.id, factions[0]!)).statusCode).toBe(200);

    await prisma.user.update({ where: { id: p1.id }, data: { weekly_ban_set_at: ago(WEEKLY_BAN_LOCK_DAYS * DAY + 1000) } });
    expect((await setBan(p1.id, factions[1]!)).statusCode).toBe(200);

    const pub = (await app.inject({ method: 'GET', url: `/api/users/${p1.id}/weekly-ban` })).json();
    expect(pub.factionId).toBe(factions[1]);
    expect(pub.opensAt).not.toBeNull();
  });

  it('can be dropped any time, and the drop leaves the lock running', async () => {
    const { p1 } = await players();
    const set = (await setBan(p1.id, factions[0]!)).json();

    const dropped = await setBan(p1.id, null);
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json()).toMatchObject({ factionId: null, opensAt: set.opensAt });
    // No new ban before the week is up, and dropping again changes nothing.
    expect((await setBan(p1.id, factions[1]!)).statusCode).toBe(409);
    expect((await setBan(p1.id, null)).json()).toMatchObject({ factionId: null, opensAt: set.opensAt });

    // A drop after the week doesn't start a new lock either.
    await prisma.user.update({ where: { id: p1.id }, data: { weekly_ban_set_at: ago(WEEKLY_BAN_LOCK_DAYS * DAY + 1000) } });
    expect((await setBan(p1.id, factions[1]!)).statusCode).toBe(200);
    await prisma.user.update({ where: { id: p1.id }, data: { weekly_ban_set_at: ago(WEEKLY_BAN_LOCK_DAYS * DAY + 1000) } });
    expect((await setBan(p1.id, null)).json()).toMatchObject({ factionId: null, opensAt: null });
    expect((await setBan(p1.id, factions[2]!)).statusCode).toBe(200);
  });

  it('logs every set, drop and admin reset, and nothing for a no-op', async () => {
    const { p1, p2 } = await players();
    await prisma.user.update({ where: { id: p2.id }, data: { role: 'ADMIN' } });
    await setBan(p1.id, factions[0]!);
    await setBan(p1.id, factions[0]!); // same again: no-op
    await setBan(p1.id, factions[1]!); // locked: no change
    await setBan(p1.id, null);
    await setBan(p1.id, null); // nothing left to drop
    await app.inject({ method: 'DELETE', url: `/api/admin/users/${p1.id}/weekly-ban`, cookies: cookieFor(p2.id, 'ADMIN') });
    const log = await prisma.auditLog.findMany({
      where: { entity_type: 'User', entity_id: p1.id },
      orderBy: { created_at: 'asc' },
      select: { action: true, actor_id: true, old_value: true, new_value: true },
    });
    expect(log).toEqual([
      { action: 'WEEKLY_BAN_SET', actor_id: p1.id, old_value: { factionId: null }, new_value: { factionId: factions[0] } },
      { action: 'WEEKLY_BAN_DROP', actor_id: p1.id, old_value: { factionId: factions[0] }, new_value: { factionId: null } },
      { action: 'WEEKLY_BAN_RESET', actor_id: p2.id, old_value: { factionId: null }, new_value: { factionId: null } },
    ]);
  });

  it('rejects an unknown faction', async () => {
    const { p1 } = await players();
    expect((await setBan(p1.id, 'no_such_faction')).statusCode).toBe(400);
  });

  it('can be cleared with its lock by an admin', async () => {
    const { p1, p2 } = await players();
    await prisma.user.update({ where: { id: p2.id }, data: { role: 'ADMIN' } });
    await setBan(p1.id, factions[0]!);
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${p1.id}/weekly-ban`, cookies: cookieFor(p2.id, 'ADMIN') });
    expect(res.statusCode).toBe(200);
    expect((await setBan(p1.id, factions[2]!)).statusCode).toBe(200);
  });

  it('is banned for both sides in every Open Play match of its player, as it stood when the match began', async () => {
    const { p1, p2 } = await players();
    await setBan(p1.id, factions[0]!);
    await setBan(p2.id, factions[1]!);
    const matchId = await openPlay(p1.id, p2.id, 'DOMINATION', 'BO1');

    const d = await decision(matchId, p1.id);
    expect(d.tournamentMode).toBe('BPT');
    expect(d.bannedFactions).toEqual(expect.arrayContaining([factions[0], factions[1]]));
    expect(d.weeklyBans).toEqual([
      { userId: p1.id, username: p1.username, factionId: factions[0] },
      { userId: p2.id, username: p2.username, factionId: factions[1] },
    ]);

    // Neither may pick his own ban or the opponent's.
    for (const [user, faction] of [[p1.id, factions[0]], [p1.id, factions[1]], [p2.id, factions[0]]] as const) {
      const res = await app.inject({ method: 'POST', url: `/api/matches/${matchId}/decision/blind-pick/lock`, cookies: cookieFor(user), payload: { faction_id: faction } });
      expect(res.statusCode).toBe(422);
    }

    // A ban changed after the match began doesn't reach it.
    await prisma.user.update({ where: { id: p1.id }, data: { weekly_ban_faction_id: factions[2], weekly_ban_set_at: new Date() } });
    expect((await decision(matchId, p1.id)).bannedFactions).not.toContain(factions[2]);
    const ok = await app.inject({ method: 'POST', url: `/api/matches/${matchId}/decision/blind-pick/lock`, cookies: cookieFor(p1.id), payload: { faction_id: factions[2] } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('3×3 matrix in Open Play', () => {
  it('is stamped on a 1v1 Bo3 in Land Battle or Conquest only', () => {
    expect(openPlayPickMode('CONQUEST', 'ONE_V_ONE', 'BO3')).toBe('MATRIX');
    expect(openPlayPickMode('LAND_BATTLE', 'ONE_V_ONE', 'BO3')).toBe('MATRIX');
    expect(openPlayPickMode('DOMINATION', 'ONE_V_ONE', 'BO3')).toBeNull();
    expect(openPlayPickMode('DOMQUEST', 'ONE_V_ONE', 'BO3')).toBeNull();
    expect(openPlayPickMode('CONQUEST', 'ONE_V_ONE', 'BO1')).toBeNull();
    expect(openPlayPickMode('CONQUEST', 'TWO_V_TWO', 'BO3')).toBeNull();
  });

  it('runs the matrix for every game of the series, with the weekly bans out of everyone\'s three', async () => {
    const { p1, p2 } = await players();
    await setBan(p1.id, factions[7]!);
    const matchId = await openPlay(p1.id, p2.id, 'CONQUEST', 'BO3');
    expect(await prisma.matchBlindPick.count({ where: { game: { match_id: matchId } } })).toBe(0);
    expect((await decision(matchId, p1.id)).tournamentMode).toBe('MATRIX');

    // No blind pick in a matrix match.
    const blind = await app.inject({ method: 'POST', url: `/api/matches/${matchId}/decision/blind-pick/lock`, cookies: cookieFor(p1.id), payload: { faction_id: factions[0] } });
    expect(blind.statusCode).toBe(422);
    // The weekly ban can't be among the three, and the three must differ.
    expect((await matrixLock(matchId, p2.id, [factions[0]!, factions[1]!, factions[7]!])).statusCode).toBe(422);
    expect((await matrixLock(matchId, p2.id, [factions[0]!, factions[0]!, factions[1]!])).statusCode).toBe(400);

    for (const game of [1, 2]) {
      expect((await matrixLock(matchId, p1.id, [factions[0]!, factions[1]!, factions[2]!])).statusCode).toBe(200);
      expect((await matrixLock(matchId, p2.id, [factions[3]!, factions[4]!, factions[5]!])).statusCode).toBe(200);
      const revealed = await decision(matchId, p1.id);
      expect(revealed.factionMatrix?.revealedAt).not.toBeNull();

      // Strikes 1-2-2-2 (top, bottom ×2, top ×2, bottom ×2), then top picks one of the two left.
      const top = revealed.factionMatrix!.topPlayerId;
      const bottom = revealed.factionMatrix!.bottomPlayerId;
      const order = [top, bottom, bottom, top, top, bottom, bottom];
      const cells = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0]] as const;
      expect((await matrixStrike(matchId, bottom, 0, 0)).statusCode).toBe(403); // not his turn
      for (let i = 0; i < 7; i++) {
        expect((await matrixStrike(matchId, order[i]!, cells[i]![0], cells[i]![1])).statusCode).toBe(200);
      }
      expect((await matrixStrike(matchId, top, 2, 2)).statusCode).toBe(200);

      const played = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId, game_number: game } });
      expect([played.player1_faction_id, played.player2_faction_id]).toEqual([factions[2], factions[5]]);

      await prisma.matchGame.update({ where: { id: played.id }, data: { reported_winner_id: p1.id, reported_at: new Date() } });
      await finalizeGameResult(app, played.id);
    }

    const done = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true, winner_id: true } });
    expect(done).toEqual({ status: 'COMPLETED', winner_id: p1.id });
    const games = await prisma.matchGame.findMany({ where: { match_id: matchId }, select: { blind_pick: true, faction_matrix: { select: { decided_at: true } } } });
    expect(games).toHaveLength(2);
    expect(games.every((g) => g.blind_pick === null && g.faction_matrix?.decided_at)).toBe(true);
  });

  it('cancels a matrix game nobody locked three for within 5 minutes, and leaves a fresh one alone', async () => {
    const { p1, p2 } = await players();
    const fresh = await openPlay(p1.id, p2.id, 'LAND_BATTLE', 'BO3');
    const stale = await openPlay(p1.id, p2.id, 'LAND_BATTLE', 'BO3');
    await prisma.matchGame.updateMany({ where: { match_id: stale }, data: { created_at: ago(OPEN_PLAY_BLIND_PICK_TIMEOUT_MS + 60_000) } });

    await autoResolveStaleBlindPicks(app);
    const status = async (id: string) => (await prisma.match.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    expect(await status(fresh)).toBe('ONGOING');
    expect(await status(stale)).toBe('CANCELLED');
  });

  it('cancels when only one side locked its three in time, instead of drawing random ones as a tournament does', async () => {
    const { p1, p2 } = await players();
    const matchId = await openPlay(p1.id, p2.id, 'CONQUEST', 'BO3');
    await matrixLock(matchId, p1.id, [factions[0]!, factions[1]!, factions[2]!]);
    await prisma.matchFactionMatrix.updateMany({
      where: { game: { match_id: matchId } },
      data: { first_locked_at: ago(MATRIX_PICK_TIMEOUT_MS + 30_000), p1_locked_at: ago(MATRIX_PICK_TIMEOUT_MS + 30_000) },
    });

    // Past the tournament's 2 minutes: Open Play keeps waiting, nothing is drawn.
    await autoResolveStaleMatrixActions(app);
    const matrix = await prisma.matchFactionMatrix.findFirstOrThrow({ where: { game: { match_id: matchId } } });
    expect(matrix.revealed_at).toBeNull();

    await prisma.matchFactionMatrix.update({ where: { game_id: matrix.game_id }, data: { first_locked_at: ago(OPEN_PLAY_BLIND_PICK_TIMEOUT_MS + 30_000) } });
    await autoResolveStaleBlindPicks(app);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true } })).status).toBe('CANCELLED');
  });
});
