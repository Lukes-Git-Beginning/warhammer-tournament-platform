/**
 * Integration tests for GET /api/matches/:id (enriched match detail).
 *
 * Covers:
 *  1. COMPLETED match with players, factions, scores and played_at → all fields populated
 *  2. PENDING match without players/factions → relation fields are null
 *  3. Non-existent match → 404
 *  4. Backwards-compat: raw player1_id / player2_id / winner_id still present
 *
 * Requires real PostgreSQL (Docker up). No Redis, no Socket.IO.
 * Factions (empire, bretonnia) are seeded at DB startup.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import {
  createTestUser,
  createTestTournament,
  cleanupTournament,
  cleanupUsers,
  type TestUser,
  type TestTournament,
} from './helpers/db-fixtures.js';

// Seeded faction slugs (always present in the test DB)
const FACTION_P1 = 'empire';
const FACTION_P2 = 'bretonnia';

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
// Per-test state
// ---------------------------------------------------------------------------

let player1: TestUser;
let player2: TestUser;
let organizer: TestUser;
let tournament: TestTournament;
let matchIds: string[];

beforeEach(async () => {
  matchIds = [];
  organizer = await createTestUser({ username: 'DetailOrganizer' });
  player1 = await createTestUser({ username: 'DetailPlayer1' });
  player2 = await createTestUser({ username: 'DetailPlayer2' });
  tournament = await createTestTournament({ organizerId: organizer.id });
});

afterEach(async () => {
  // Delete matches first (FK on tournament), then tournament and users
  if (matchIds.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  }
  await cleanupTournament(tournament.id);
  await cleanupUsers([organizer.id, player1.id, player2.id]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createMatch(opts: {
  player1_id?: string | null;
  player2_id?: string | null;
  winner_id?: string | null;
  player1_faction_id?: string | null;
  player2_faction_id?: string | null;
  status?: string;
  result?: string | null;
  player1_points?: number | null;
  player2_points?: number | null;
  score?: string | null;
  played_at?: Date | null;
  phase?: string | null;
  bracket_side?: string | null;
  scheduled_time?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  matchIds.push(id);

  await prisma.match.create({
    data: {
      id,
      tournament_id: tournament.id,
      round: 1,
      match_number: matchIds.length,
      player1_id: opts.player1_id ?? null,
      player2_id: opts.player2_id ?? null,
      winner_id: opts.winner_id ?? null,
      player1_faction_id: opts.player1_faction_id ?? null,
      player2_faction_id: opts.player2_faction_id ?? null,
      status: (opts.status ?? 'PENDING') as never,
      result: (opts.result ?? null) as never,
      player1_points: opts.player1_points ?? null,
      player2_points: opts.player2_points ?? null,
      score: opts.score ?? null,
      played_at: opts.played_at ?? null,
      phase: (opts.phase ?? null) as never,
      bracket_side: (opts.bracket_side ?? null) as never,
      scheduled_time: opts.scheduled_time ?? null,
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/matches/:id', () => {
  it('1. COMPLETED match with all fields → enriched DTO', async () => {
    const playedAt = new Date('2026-06-01T14:00:00.000Z');

    const matchId = await createMatch({
      player1_id: player1.id,
      player2_id: player2.id,
      winner_id: player1.id,
      player1_faction_id: FACTION_P1,
      player2_faction_id: FACTION_P2,
      status: 'COMPLETED',
      result: 'PLAYER1_WIN',
      player1_points: 1.0,
      player2_points: 0.0,
      score: '20-0',
      played_at: playedAt,
      phase: 'SWISS',
      bracket_side: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}`,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<Record<string, unknown>>();

    // Core fields
    expect(body.id).toBe(matchId);
    expect(body.tournament_id).toBe(tournament.id);
    expect(body.tournament_slug).toBe(tournament.slug);
    expect(body.round).toBe(1);
    expect(body.status).toBe('COMPLETED');
    expect(body.result).toBe('PLAYER1_WIN');
    expect(body.phase).toBe('SWISS');
    expect(body.bracket_side).toBeNull();
    expect(body.score).toBe('20-0');
    expect(body.player1_points).toBe(1.0);
    expect(body.player2_points).toBe(0.0);
    expect(body.played_at).toBe(playedAt.toISOString());

    // Enriched player refs
    const p1 = body.player1 as Record<string, unknown>;
    expect(p1).not.toBeNull();
    expect(p1.id).toBe(player1.id);
    expect(p1.username).toBe(player1.username);

    const p2 = body.player2 as Record<string, unknown>;
    expect(p2).not.toBeNull();
    expect(p2.id).toBe(player2.id);

    const winner = body.winner as Record<string, unknown>;
    expect(winner).not.toBeNull();
    expect(winner.id).toBe(player1.id);
    expect(winner.username).toBe(player1.username);

    // Enriched faction refs
    const f1 = body.player1_faction as Record<string, unknown>;
    expect(f1).not.toBeNull();
    expect(f1.id).toBe(FACTION_P1);
    expect(typeof f1.name).toBe('string');
    expect(f1.name.length).toBeGreaterThan(0);
    // icon_url is null in test DB (not seeded) — either null or a valid string
    expect(f1.icon_url === null || typeof f1.icon_url === 'string').toBe(true);

    const f2 = body.player2_faction as Record<string, unknown>;
    expect(f2).not.toBeNull();
    expect(f2.id).toBe(FACTION_P2);

    // Backwards-compatible raw ID fields
    expect(body.player1_id).toBe(player1.id);
    expect(body.player2_id).toBe(player2.id);
    expect(body.winner_id).toBe(player1.id);
    expect(body.player1_faction_id).toBe(FACTION_P1);
    expect(body.player2_faction_id).toBe(FACTION_P2);
  });

  it('2. PENDING match without players/factions → relation fields are null', async () => {
    const matchId = await createMatch({
      status: 'PENDING',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    expect(body.status).toBe('PENDING');
    expect(body.result).toBeNull();
    expect(body.phase).toBeNull();
    expect(body.bracket_side).toBeNull();
    expect(body.score).toBeNull();
    expect(body.player1_points).toBeNull();
    expect(body.player2_points).toBeNull();
    expect(body.played_at).toBeNull();
    expect(body.player1).toBeNull();
    expect(body.player2).toBeNull();
    expect(body.winner).toBeNull();
    expect(body.player1_faction).toBeNull();
    expect(body.player2_faction).toBeNull();
    expect(body.player1_id).toBeNull();
    expect(body.player2_id).toBeNull();
    expect(body.winner_id).toBeNull();
  });

  it('3. Non-existent match → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/matches/00000000-0000-0000-0000-999999999998',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; statusCode: number }>();
    expect(body.error).toBe('NotFound');
    expect(body.statusCode).toBe(404);
  });

  it('4. played_at and scheduled_time serialize as ISO strings', async () => {
    const scheduledTime = new Date('2026-07-01T10:00:00.000Z');
    const playedAt = new Date('2026-07-01T12:30:00.000Z');

    const matchId = await createMatch({
      player1_id: player1.id,
      player2_id: player2.id,
      status: 'PENDING',
      scheduled_time: scheduledTime,
      played_at: playedAt,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    expect(body.scheduled_time).toBe(scheduledTime.toISOString());
    expect(body.played_at).toBe(playedAt.toISOString());
  });
});

// ---------------------------------------------------------------------------
// can_manage for Open Play matches (tournament_id = null).
// Regression: the endpoint used to gate the canManageTournament call behind
// `if (match.tournament?.id)`, so staff never got can_manage=true on an Open Play
// match — making its replay disputes unresolvable (no host exists there).
// ---------------------------------------------------------------------------

describe('GET /api/matches/:id — can_manage on Open Play', () => {
  async function createOpenPlayMatch(): Promise<string> {
    const id = randomUUID();
    matchIds.push(id);
    await prisma.match.create({
      data: {
        id,
        tournament_id: null,
        round: 0,
        match_number: 0,
        player1_id: player1.id,
        player2_id: player2.id,
        status: 'ONGOING' as never,
      },
    });
    return id;
  }

  it('5. an ADMIN viewer can manage an Open Play match', async () => {
    const matchId = await createOpenPlayMatch();
    const admin = await createTestUser({ username: 'DetailAdmin' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const token = app.jwt.sign({ sub: admin.id, username: admin.username, role: 'ADMIN' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.tournament_id).toBeNull();
    expect(body.can_manage).toBe(true);

    await cleanupUsers([admin.id]);
  });

  it('6. a non-staff stranger cannot manage an Open Play match', async () => {
    const matchId = await createOpenPlayMatch();
    const stranger = await createTestUser({ username: 'DetailStranger' });
    const token = app.jwt.sign({ sub: stranger.id, username: stranger.username, role: 'USER' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.can_manage).toBe(false);

    await cleanupUsers([stranger.id]);
  });

  it('7. an unauthenticated viewer cannot manage an Open Play match', async () => {
    const matchId = await createOpenPlayMatch();

    const res = await app.inject({ method: 'GET', url: `/api/matches/${matchId}` });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.can_manage).toBe(false);
  });
});
