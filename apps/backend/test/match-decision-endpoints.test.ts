/**
 * Integration tests for:
 *   GET  /api/matches/:id/decision
 *   POST /api/matches/:id/decision/random
 *   POST /api/matches/:id/decision/start  (shape completeness)
 *
 * Requires real PostgreSQL (Docker up). No Redis, no Socket.IO.
 * Maps must be seeded (pnpm db:seed) — tests skip if map pool is empty.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import {
  createTestUser,
  cleanupTournament,
  cleanupUsers,
  type TestUser,
} from './helpers/db-fixtures.js';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function cookieFor(userId: string, role = 'USER') {
  const token = app.jwt.sign({ sub: userId, discord_id: `disc_${userId}`, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return { [cookieName]: token };
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let player1: TestUser;
let player2: TestUser;
let organizer: TestUser;
let tournamentId: string;
let tournamentSlug: string;
let matchId: string;
let mapIds: string[];

beforeEach(async () => {
  mapIds = (await prisma.map.findMany({ take: 3, select: { id: true } })).map((m) => m.id);

  organizer = await createTestUser({ username: 'DecisionOrg' });
  player1 = await createTestUser({ username: 'DecisionP1' });
  player2 = await createTestUser({ username: 'DecisionP2' });

  tournamentId = randomUUID();
  tournamentSlug = `test-decision-${tournamentId.slice(0, 8)}`;

  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: tournamentSlug,
      name: 'Decision Test Tournament',
      organizer_id: organizer.id,
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      map_decision_mode: 'RANDOM',
    },
  });

  if (mapIds.length > 0) {
    await prisma.tournamentMapPool.createMany({
      data: mapIds.map((map_id) => ({ tournament_id: tournamentId, map_id })),
    });
  }

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
    },
  });
});

afterEach(async () => {
  await cleanupTournament(tournamentId);
  await cleanupUsers([organizer.id, player1.id, player2.id]);
});

// ---------------------------------------------------------------------------
// GET /api/matches/:id/decision
// ---------------------------------------------------------------------------

describe('GET /api/matches/:id/decision', () => {
  it('returns 404 for non-existent match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${randomUUID()}/decision`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when no decision flow started', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}/decision`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NotFound');
  });

  it('returns full MatchDecisionState after /start (RANDOM mode)', async () => {
    if (mapIds.length === 0) return; // no maps seeded

    await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/start`,
      cookies: cookieFor(player1.id),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}/decision`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matchId).toBe(matchId);
    expect(body.mode).toBe('RANDOM');
    expect(typeof body.topPlayerId).toBe('string');
    expect(typeof body.bottomPlayerId).toBe('string');
    expect(body.seed).toBeTruthy();
    expect(Array.isArray(body.bansTop)).toBe(true);
    expect(Array.isArray(body.bansBottom)).toBe(true);
    expect(typeof body.pickedMapId).toBe('string'); // RANDOM picks immediately
    expect(body.decidedAt).toBeTruthy();
    expect(body.blindPick).toBeNull();
  });

  it('is accessible without auth (public endpoint)', async () => {
    if (mapIds.length === 0) return;

    await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/start`,
      cookies: cookieFor(player1.id),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}/decision`,
      // no cookies
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/matches/:id/decision/random
// ---------------------------------------------------------------------------

describe('POST /api/matches/:id/decision/random', () => {
  it('returns 409 when decision flow not started', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/random`,
      cookies: cookieFor(player1.id),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('returns 422 for PICK_BAN mode match', async () => {
    if (mapIds.length < 3) return;

    // Create a PICK_BAN tournament and match
    const pbTournId = randomUUID();
    await prisma.tournament.create({
      data: {
        id: pbTournId,
        slug: `test-pb-${pbTournId.slice(0, 8)}`,
        name: 'PB Decision Test',
        organizer_id: organizer.id,
        format: 'SWISS',
        status: 'ONGOING',
        start_date: new Date('2026-06-01'),
        timezone: 'Europe/Berlin',
        map_decision_mode: 'PICK_BAN',
      },
    });
    await prisma.tournamentMapPool.createMany({
      data: mapIds.map((map_id) => ({ tournament_id: pbTournId, map_id })),
    });
    const pbMatchId = randomUUID();
    await prisma.match.create({
      data: {
        id: pbMatchId,
        tournament_id: pbTournId,
        round: 1,
        match_number: 1,
        status: 'ONGOING',
        player1_id: player1.id,
        player2_id: player2.id,
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/matches/${pbMatchId}/decision/start`,
      cookies: cookieFor(player1.id),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${pbMatchId}/decision/random`,
      cookies: cookieFor(player1.id),
    });

    await cleanupTournament(pbTournId);

    expect(res.statusCode).toBe(422);
  });

  it('returns full MatchDecisionState for RANDOM mode after start', async () => {
    if (mapIds.length === 0) return;

    await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/start`,
      cookies: cookieFor(player1.id),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/random`,
      cookies: cookieFor(player1.id),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matchId).toBe(matchId);
    expect(body.mode).toBe('RANDOM');
    expect(typeof body.pickedMapId).toBe('string');
    expect(body.decidedAt).toBeTruthy();
    expect(Array.isArray(body.bansTop)).toBe(true);
    expect(body.blindPick).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /start response shape
// ---------------------------------------------------------------------------

describe('POST /api/matches/:id/decision/start — response shape', () => {
  it('returns complete MatchDecisionState including bansTop, bansBottom, decidedAt', async () => {
    if (mapIds.length === 0) return;

    const res = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/decision/start`,
      cookies: cookieFor(player1.id),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.bansTop)).toBe(true);
    expect(Array.isArray(body.bansBottom)).toBe(true);
    expect('decidedAt' in body).toBe(true);
    expect(body.blindPick).toBeNull();
  });
});
