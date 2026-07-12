/**
 * Integration tests for the 1v3 mode ("Set Faction vs. One of Three Counterpicks"):
 *   POST /api/matches/:id/one-v-three/offer   (Picker offers 3)
 *   POST /api/matches/:id/one-v-three/select  (Runner picks 1)
 *   GET  /api/matches/:id/decision            (coin-flip roles + set faction)
 *
 * Requires real PostgreSQL (Docker up) + seeded factions. Skips if <4 factions.
 * No Redis, no Socket.IO.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
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

let organizer: TestUser;
let player1: TestUser;
let player2: TestUser;
let tournamentId: string;
let matchId: string;
let gameId: string;
let factionIds: string[];

/** set faction = factionIds[0]; the offerable pool = factionIds[1..] */
async function setup1v3(): Promise<void> {
  organizer = await createTestUser({ username: 'OvtOrg' });
  player1 = await createTestUser({ username: 'OvtP1' });
  player2 = await createTestUser({ username: 'OvtP2' });

  tournamentId = randomUUID();
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-1v3-${tournamentId.slice(0, 8)}`,
      name: '1v3 Test Tournament',
      host_id: organizer.id,
      format: 'SWISS',
      mode: 'ONE_V_THREE',
      set_faction_id: factionIds[0],
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      map_decision_mode: 'RANDOM',
    },
  });

  matchId = randomUUID();
  await prisma.match.create({
    data: {
      id: matchId,
      tournament_id: tournamentId,
      round: 1,
      match_number: 1,
      status: 'ONGOING',
      player1_id: player1.id,
      player2_id: player2.id,
      phase: 'SWISS',
    },
  });

  // A game with a map decision → the faction phase begins.
  const game = await prisma.matchGame.create({ data: { match_id: matchId, game_number: 1 } });
  gameId = game.id;
  await prisma.matchMapDecision.create({
    data: {
      game_id: gameId,
      mode: 'RANDOM',
      coin_flip_seed: 'test-seed',
      top_player_id: player1.id,
      bottom_player_id: player2.id,
      bans_top: [],
      bans_bottom: [],
      decided_at: new Date(),
    },
  });
}

/** GET /decision establishes the coin flip; return {runnerId, pickerId}. */
async function resolveRoles(): Promise<{ runnerId: string; pickerId: string }> {
  const res = await app.inject({ method: 'GET', url: `/api/matches/${matchId}/decision` });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.tournamentMode).toBe('ONE_V_THREE');
  expect(body.oneVThree?.setFactionId).toBe(factionIds[0]);
  const fm = await prisma.matchFactionMatrix.findUnique({ where: { game_id: gameId } });
  expect(fm).not.toBeNull();
  return { runnerId: fm!.top_player_id, pickerId: fm!.bottom_player_id };
}

beforeEach(async () => {
  factionIds = (await prisma.faction.findMany({ take: 4, select: { id: true } })).map((f) => f.id);
  if (factionIds.length >= 4) await setup1v3();
});

afterEach(async () => {
  if (tournamentId) await cleanupTournament(tournamentId);
  const ids = [organizer?.id, player1?.id, player2?.id].filter((x): x is string => Boolean(x));
  if (ids.length) await cleanupUsers(ids);
  tournamentId = '';
});

describe('1v3 mode — decision + offer/select', () => {
  it('coin flip assigns Runner + Picker to the two players', async () => {
    if (factionIds.length < 4) return;
    const { runnerId, pickerId } = await resolveRoles();
    expect(new Set([runnerId, pickerId])).toEqual(new Set([player1.id, player2.id]));
    expect(runnerId).not.toBe(pickerId);
  });

  it('rejects offering the set faction (no mirror)', async () => {
    if (factionIds.length < 4) return;
    const { pickerId } = await resolveRoles();
    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/offer`,
      cookies: cookieFor(pickerId),
      payload: { factions: [factionIds[0], factionIds[1], factionIds[2]] }, // includes the set faction
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-distinct offer', async () => {
    if (factionIds.length < 4) return;
    const { pickerId } = await resolveRoles();
    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/offer`,
      cookies: cookieFor(pickerId),
      payload: { factions: [factionIds[1], factionIds[1], factionIds[2]] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an offer from the Runner (only the Picker offers)', async () => {
    if (factionIds.length < 4) return;
    const { runnerId } = await resolveRoles();
    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/offer`,
      cookies: cookieFor(runnerId),
      payload: { factions: [factionIds[1], factionIds[2], factionIds[3]] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('completes the offer→select flow and resolves the game factions', async () => {
    if (factionIds.length < 4) return;
    const { runnerId, pickerId } = await resolveRoles();
    const runnerIsP1 = runnerId === player1.id;

    const offer = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/offer`,
      cookies: cookieFor(pickerId),
      payload: { factions: [factionIds[1], factionIds[2], factionIds[3]] },
    });
    expect(offer.statusCode).toBe(200);

    // Picker cannot select.
    const wrongSelect = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/select`,
      cookies: cookieFor(pickerId),
      payload: { factionId: factionIds[1] },
    });
    expect(wrongSelect.statusCode).toBe(422);

    // Runner cannot select a faction that was not offered.
    const badSelect = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/select`,
      cookies: cookieFor(runnerId),
      payload: { factionId: factionIds[0] }, // the set faction was never offered
    });
    expect(badSelect.statusCode).toBe(400);

    // Runner selects one of the three.
    const select = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/one-v-three/select`,
      cookies: cookieFor(runnerId),
      payload: { factionId: factionIds[2] },
    });
    expect(select.statusCode).toBe(200);

    // Resolved onto the game: Runner = set faction, Picker = the chosen counter.
    const game = await prisma.matchGame.findUnique({ where: { id: gameId } });
    const runnerFaction = runnerIsP1 ? game!.player1_faction_id : game!.player2_faction_id;
    const pickerFaction = runnerIsP1 ? game!.player2_faction_id : game!.player1_faction_id;
    expect(runnerFaction).toBe(factionIds[0]); // set faction
    expect(pickerFaction).toBe(factionIds[2]); // chosen counter
  });
});
