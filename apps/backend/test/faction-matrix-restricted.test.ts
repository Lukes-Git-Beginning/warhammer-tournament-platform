/**
 * Integration test for POST /api/matches/:id/matrix/lock — faction validation.
 *
 * Regression guard: `restricted_factions` are NOT a ban. They stay pickable
 * (leaderboard exclusion happens later at game finalization). Only a non-empty
 * `faction_allowlist` is a hard ban.
 *
 * Requires real PostgreSQL with factions seeded (pnpm db:seed) — skips otherwise.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;
let factionIds: string[];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
  factionIds = (await prisma.faction.findMany({ take: 3, select: { id: true } })).map((f) => f.id);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function cookieFor(userId: string, role = 'USER') {
  const token = app.jwt.sign({ sub: userId, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return { [cookieName]: token };
}

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];

async function setupMatrixGame(opts: {
  organizerId: string;
  p1: string;
  p2: string;
  restricted?: string[];
  allowlist?: string[];
}): Promise<{ matchId: string }> {
  const tournamentId = randomUUID();
  createdTournamentIds.push(tournamentId);
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-matrix-${tournamentId.slice(0, 8)}`,
      name: 'Matrix Restricted Test',
      host_id: opts.organizerId,
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      mode: 'MATRIX',
    },
  });
  if (opts.restricted?.length) {
    await prisma.tournamentRestrictedFaction.createMany({
      data: opts.restricted.map((faction_id) => ({ tournament_id: tournamentId, faction_id })),
    });
  }
  if (opts.allowlist?.length) {
    await prisma.tournamentFactionAllowlist.createMany({
      data: opts.allowlist.map((faction_id) => ({ tournament_id: tournamentId, faction_id })),
    });
  }

  const matchId = randomUUID();
  await prisma.match.create({
    data: {
      id: matchId,
      tournament_id: tournamentId,
      round: 1,
      match_number: 1,
      status: 'ONGOING',
      player1_id: opts.p1,
      player2_id: opts.p2,
    },
  });

  // One active game with a decided map and no faction matrix yet — this is the
  // state the lock endpoint expects.
  const game = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: 1, status: 'PENDING' },
  });
  await prisma.matchMapDecision.create({
    data: {
      game_id: game.id,
      mode: 'RANDOM',
      coin_flip_seed: 'test-seed',
      top_player_id: opts.p1,
      bottom_player_id: opts.p2,
      bans_top: [],
      bans_bottom: [],
      picked_map_id: randomUUID(),
      decided_at: new Date(),
    },
  });

  return { matchId };
}

afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

describe('POST /api/matches/:id/matrix/lock — restricted vs allowlist', () => {
  it('lets a player lock a restricted faction (restricted = nerfed, not banned)', async () => {
    if (factionIds.length < 3) return; // factions not seeded

    const [organizer, p1, p2] = await Promise.all([
      createTestUser({ username: 'MatrixOrg' }),
      createTestUser({ username: 'MatrixP1' }),
      createTestUser({ username: 'MatrixP2' }),
    ]);
    createdUserIds.push(organizer.id, p1.id, p2.id);

    // The very faction the player locks is marked restricted.
    const { matchId } = await setupMatrixGame({
      organizerId: organizer.id,
      p1: p1.id,
      p2: p2.id,
      restricted: [factionIds[0]!],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/matrix/lock`,
      cookies: cookieFor(p1.id),
      payload: { factions: [factionIds[0], factionIds[1], factionIds[2]] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('still rejects a faction outside a non-empty allowlist', async () => {
    if (factionIds.length < 3) return;

    const [organizer, p1, p2] = await Promise.all([
      createTestUser({ username: 'MatrixOrg2' }),
      createTestUser({ username: 'MatrixP1b' }),
      createTestUser({ username: 'MatrixP2b' }),
    ]);
    createdUserIds.push(organizer.id, p1.id, p2.id);

    // Allowlist permits only factions 1 and 2 — locking faction 0 must fail.
    const { matchId } = await setupMatrixGame({
      organizerId: organizer.id,
      p1: p1.id,
      p2: p2.id,
      allowlist: [factionIds[1]!, factionIds[2]!],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/matrix/lock`,
      cookies: cookieFor(p1.id),
      payload: { factions: [factionIds[0], factionIds[1], factionIds[2]] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('not permitted');
  });
});
