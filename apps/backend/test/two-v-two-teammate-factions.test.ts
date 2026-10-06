/**
 * Regression tests: a 2v2 team carries TWO factions (captain + teammate, positional *_faction_id_2).
 * Open Play 2v2 and the override/edit/timeout paths used to drop the teammate's faction.
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { finalizeGameResult } from '../src/lib/match-games.js';
import { autoResolveStaleBlindPicks } from '../src/lib/blind-pick-auto-resolve.js';
import { resolveMatchResult } from '../src/lib/match-result-service.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const matchIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (userIds.length) {
    await prisma.auditLog.deleteMany({ where: { actor_id: { in: userIds } } });
    await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: userIds } } });
    await cleanupUsers(userIds);
  }
  matchIds.length = 0;
  userIds.length = 0;
});

async function fourFactions(): Promise<[string, string, string, string]> {
  const f = await prisma.faction.findMany({ take: 4, select: { id: true }, orderBy: { id: 'asc' } });
  expect(f.length).toBeGreaterThanOrEqual(4);
  return [f[0]!.id, f[1]!.id, f[2]!.id, f[3]!.id];
}

/** A match between two (opaque) team ids. Open Play 2v2 = no tournament, competitor_format TWO_V_TWO. */
async function makeMatch(opts: {
  type?: 'OPEN_PLAY' | 'TOURNAMENT';
  format?: 'ONE_V_ONE' | 'TWO_V_TWO';
}) {
  const id = randomUUID();
  const team1 = randomUUID();
  const team2 = randomUUID();
  matchIds.push(id);
  await prisma.match.create({
    data: {
      id,
      type: opts.type ?? 'OPEN_PLAY',
      round: 1,
      match_number: 1,
      player1_id: team1,
      player2_id: team2,
      status: 'ONGOING',
      competitor_format: opts.format ?? 'TWO_V_TWO',
    },
  });
  return { id, team1, team2 };
}

async function makeGame(matchId: string, extra: Record<string, unknown> = {}) {
  return prisma.matchGame.create({ data: { match_id: matchId, game_number: 1, status: 'PENDING', ...extra } });
}

const gameCols = {
  player1_faction_id: true,
  player1_faction_id_2: true,
  player2_faction_id: true,
  player2_faction_id_2: true,
} as const;

describe('2v2 teammate factions — write paths', () => {
  it('Open Play 2v2: finalising a game stamps the teammate factions on the game AND the match', async () => {
    const [f0, f1, f2, f3] = await fourFactions();
    const m = await makeMatch({});
    const game = await makeGame(m.id);
    await prisma.matchBlindPick.create({
      data: {
        game_id: game.id,
        player1_faction_id: f0, player1_faction_id_2: f1,
        player2_faction_id: f2, player2_faction_id_2: f3,
        player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date(),
      },
    });
    await prisma.matchGame.update({ where: { id: game.id }, data: { reported_winner_id: m.team1 } });

    await finalizeGameResult(app, game.id);

    const g = await prisma.matchGame.findUnique({ where: { id: game.id }, select: gameCols });
    expect(g).toEqual({
      player1_faction_id: f0, player1_faction_id_2: f1,
      player2_faction_id: f2, player2_faction_id_2: f3,
    });
    const match = await prisma.match.findUnique({ where: { id: m.id }, select: { status: true, ...gameCols } });
    expect(match?.status).toBe('COMPLETED');
    expect([match?.player1_faction_id_2, match?.player2_faction_id_2]).toEqual([f1, f3]);
  });

  it('Open Play 1v1: no teammate factions are written', async () => {
    const [f0, , f2] = await fourFactions();
    const m = await makeMatch({ format: 'ONE_V_ONE' });
    // 1v1 slots are real users (the audit log FK points at User).
    const u1 = await createTestUser({ username: 'tm-fac-u1' });
    const u2 = await createTestUser({ username: 'tm-fac-u2' });
    userIds.push(u1.id, u2.id);
    await prisma.match.update({ where: { id: m.id }, data: { player1_id: u1.id, player2_id: u2.id } });
    m.team1 = u1.id;
    const game = await makeGame(m.id);
    await prisma.matchBlindPick.create({
      data: {
        game_id: game.id, player1_faction_id: f0, player2_faction_id: f2,
        player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date(),
      },
    });
    await prisma.matchGame.update({ where: { id: game.id }, data: { reported_winner_id: m.team1 } });
    await finalizeGameResult(app, game.id);
    const g = await prisma.matchGame.findUnique({ where: { id: game.id }, select: gameCols });
    expect(g?.player1_faction_id_2).toBeNull();
    expect(g?.player2_faction_id_2).toBeNull();
  });

  it('blind-pick timeout (2v2 tournament match): the timed-out team gets a distinct random teammate faction', async () => {
    const [f0, f1] = await fourFactions();
    const m = await makeMatch({ type: 'TOURNAMENT' });
    const game = await makeGame(m.id);
    // Team 1 locked its pair long ago; team 2 never responded.
    await prisma.matchBlindPick.create({
      data: {
        game_id: game.id,
        player1_faction_id: f0, player1_faction_id_2: f1,
        player1_locked_at: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await autoResolveStaleBlindPicks(app);

    const bp = await prisma.matchBlindPick.findUnique({ where: { game_id: game.id } });
    expect(bp?.revealed_at).not.toBeNull();
    expect(bp?.player2_faction_id).toBeTruthy();
    expect(bp?.player2_faction_id_2).toBeTruthy();
    expect(bp?.player2_faction_id_2).not.toBe(bp?.player2_faction_id);
    // The locked side is untouched.
    expect([bp?.player1_faction_id, bp?.player1_faction_id_2]).toEqual([f0, f1]);
  });

  it('host override: writes teammate factions, and keeps stored ones when not re-sent', async () => {
    const [f0, f1, f2, f3] = await fourFactions();
    const m = await makeMatch({});
    await makeGame(m.id, { player1_faction_id: f0, player1_faction_id_2: f1, player2_faction_id: f2, player2_faction_id_2: f3 });

    // Re-saving without teammate fields (e.g. an older client) must not wipe them.
    await resolveMatchResult(prisma, m.id, 'PLAYER1_WIN', { override: true, player1FactionId: f0, player2FactionId: f2 });
    let g = await prisma.matchGame.findFirst({ where: { match_id: m.id }, select: gameCols });
    expect([g?.player1_faction_id_2, g?.player2_faction_id_2]).toEqual([f1, f3]);

    // Explicit values overwrite game and match.
    await resolveMatchResult(prisma, m.id, 'PLAYER1_WIN', {
      override: true,
      player1FactionId: f0, player2FactionId: f2,
      player1FactionId2: f3, player2FactionId2: f1,
    });
    g = await prisma.matchGame.findFirst({ where: { match_id: m.id }, select: gameCols });
    expect([g?.player1_faction_id_2, g?.player2_faction_id_2]).toEqual([f3, f1]);
    const match = await prisma.match.findUnique({ where: { id: m.id }, select: gameCols });
    expect([match?.player1_faction_id_2, match?.player2_faction_id_2]).toEqual([f3, f1]);
  });

  it('host override (per-game series rows): teammate factions are written and preserved', async () => {
    const [f0, f1, f2, f3] = await fourFactions();
    const m = await makeMatch({});
    await makeGame(m.id, { player1_faction_id_2: f1, player2_faction_id_2: f3 });

    // Game 1 omits teammate fields (kept); game 2 is new and carries them.
    await resolveMatchResult(prisma, m.id, 'PLAYER1_WIN', {
      override: true,
      games: [
        { gameNumber: 1, player1FactionId: f0, player2FactionId: f2, winnerId: m.team1 },
        { gameNumber: 2, player1FactionId: f0, player2FactionId: f2, player1FactionId2: f3, player2FactionId2: f1, winnerId: m.team1 },
      ],
    });
    const games = await prisma.matchGame.findMany({ where: { match_id: m.id }, orderBy: { game_number: 'asc' }, select: gameCols });
    expect([games[0]?.player1_faction_id_2, games[0]?.player2_faction_id_2]).toEqual([f1, f3]);
    expect([games[1]?.player1_faction_id_2, games[1]?.player2_faction_id_2]).toEqual([f3, f1]);
  });

  it('staff game edit: sets teammate factions on a 2v2 match, rejects them on a 1v1 match', async () => {
    const [f0, f1, f2, f3] = await fourFactions();
    const admin = await createTestUser({ username: 'tm-fac-admin' });
    userIds.push(admin.id);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
    const cookies = { [cookieName]: app.jwt.sign({ sub: admin.id, username: 'test', role: 'ADMIN' }) };

    const two = await makeMatch({});
    await makeGame(two.id, { status: 'COMPLETED', winner_id: two.team1, player1_faction_id: f0, player2_faction_id: f2 });
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${two.id}/games/1`,
      cookies,
      payload: { player1FactionId2: f1, player2FactionId2: f3 },
    });
    expect(ok.statusCode).toBe(200);
    const g = await prisma.matchGame.findFirst({ where: { match_id: two.id }, select: gameCols });
    expect([g?.player1_faction_id_2, g?.player2_faction_id_2]).toEqual([f1, f3]);

    const one = await makeMatch({ format: 'ONE_V_ONE' });
    await makeGame(one.id, { status: 'COMPLETED', winner_id: one.team1, player1_faction_id: f0, player2_faction_id: f2 });
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/matches/${one.id}/games/1`,
      cookies,
      payload: { player1FactionId2: f1 },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('2v2 teammate factions — read path', () => {
  it('GET /api/matches/:id enriches the teammate factions like the captain ones', async () => {
    const [f0, f1, f2, f3] = await fourFactions();
    const m = await makeMatch({});
    await prisma.match.update({
      where: { id: m.id },
      data: { player1_faction_id: f0, player1_faction_id_2: f1, player2_faction_id: f2, player2_faction_id_2: f3 },
    });
    const res = await app.inject({ method: 'GET', url: `/api/matches/${m.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.player1_faction_id_2).toBe(f1);
    expect(body.player1_faction_2).toMatchObject({ id: f1 });
    expect(typeof body.player1_faction_2.name).toBe('string');
    expect(body.player2_faction_2).toMatchObject({ id: f3 });
  });

  it('1v1 match: teammate faction relations are null', async () => {
    const m = await makeMatch({ format: 'ONE_V_ONE' });
    const body = (await app.inject({ method: 'GET', url: `/api/matches/${m.id}` })).json();
    expect(body.player1_faction_2).toBeNull();
    expect(body.player2_faction_2).toBeNull();
  });
});

describe('2v2 teammate factions — backfill migration', () => {
  const sqlPath = fileURLToPath(
    new URL('../../../packages/db/prisma/migrations/20261006100000_backfill_open_play_2v2_teammate_factions/migration.sql', import.meta.url),
  );
  async function runBackfill() {
    const statements = readFileSync(sqlPath, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements) await prisma.$executeRawUnsafe(s);
  }

  it('fills missing teammate factions of Open Play 2v2 games from the blind pick, mirrors game 1 onto the match, is idempotent, and leaves 1v1 alone', async () => {
    const [f0, f1, f2, f3] = await fourFactions();

    const two = await makeMatch({});
    const g2 = await makeGame(two.id, { status: 'COMPLETED', player1_faction_id: f0, player2_faction_id: f2 });
    await prisma.match.update({ where: { id: two.id }, data: { player1_faction_id: f0, player2_faction_id: f2 } });
    await prisma.matchBlindPick.create({
      data: {
        game_id: g2.id,
        player1_faction_id: f0, player1_faction_id_2: f1, player2_faction_id: f2, player2_faction_id_2: f3,
        player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date(),
      },
    });

    // 1v1 control: a stray _2 on its blind pick must NOT be copied.
    const one = await makeMatch({ format: 'ONE_V_ONE' });
    const g1 = await makeGame(one.id, { status: 'COMPLETED', player1_faction_id: f0, player2_faction_id: f2 });
    await prisma.matchBlindPick.create({
      data: {
        game_id: g1.id, player1_faction_id: f0, player1_faction_id_2: f1, player2_faction_id: f2,
        player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date(),
      },
    });

    await runBackfill();
    await runBackfill(); // idempotent

    const gg = await prisma.matchGame.findUnique({ where: { id: g2.id }, select: gameCols });
    expect([gg?.player1_faction_id_2, gg?.player2_faction_id_2]).toEqual([f1, f3]);
    const mm = await prisma.match.findUnique({ where: { id: two.id }, select: gameCols });
    expect([mm?.player1_faction_id_2, mm?.player2_faction_id_2]).toEqual([f1, f3]);

    const g1after = await prisma.matchGame.findUnique({ where: { id: g1.id }, select: gameCols });
    expect(g1after?.player1_faction_id_2).toBeNull();
  });
});
