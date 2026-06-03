/**
 * Integration tests for GET /api/users/:a/vs/:b (Head-to-Head stats).
 *
 * Auth: authenticate required (JWT cookie).
 * Covers:
 *  1. Summary counts (a_wins, b_wins, draws, total) + winrate_a
 *  2. Symmetry: :a/vs/:b vs :b/vs/:a — wins flip, draws/total unchanged
 *  3. Draw regression — winner_id=null matches must be counted, not dropped
 *  4. 404 for unknown user UUID
 *  5. 400 for non-UUID param
 *  6. faction_breakdown is populated when factions are set on matches
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

// Seeded faction slugs (always present in test DB)
const FACTION_A = 'empire';
const FACTION_B = 'bretonnia';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let playerA: TestUser;
let playerB: TestUser;
let organizer: TestUser;
let tournament: TestTournament;
let matchIds: string[];

beforeEach(async () => {
  matchIds = [];
  organizer = await createTestUser({ username: 'H2HOrganizer' });
  playerA   = await createTestUser({ username: 'H2HPlayerA' });
  playerB   = await createTestUser({ username: 'H2HPlayerB' });
  // counts_for_leaderboard defaults to true — no override needed
  tournament = await createTestTournament({ organizerId: organizer.id });
});

afterEach(async () => {
  if (matchIds.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  }
  await cleanupTournament(tournament.id);
  await cleanupUsers([organizer.id, playerA.id, playerB.id]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createMatch(opts: {
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  player1_faction_id?: string | null;
  player2_faction_id?: string | null;
}): Promise<string> {
  const id = randomUUID();
  matchIds.push(id);

  await prisma.match.create({
    data: {
      id,
      tournament_id: tournament.id,
      round: 1,
      match_number: matchIds.length,
      player1_id: opts.player1_id,
      player2_id: opts.player2_id,
      winner_id: opts.winner_id,
      player1_faction_id: opts.player1_faction_id ?? null,
      player2_faction_id: opts.player2_faction_id ?? null,
      status: 'COMPLETED',
      result: opts.winner_id === opts.player1_id
        ? 'PLAYER1_WIN'
        : opts.winner_id === opts.player2_id
          ? 'PLAYER2_WIN'
          : 'DRAW',
      played_at: new Date(),
    } as never,
  });

  return id;
}

function makeToken(userId: string, role: string = 'USER'): string {
  return app.jwt.sign({ sub: userId, discord_id: `disc_${userId}`, username: 'test', role });
}

async function getH2H(a: string, b: string, token: string, query: string = '') {
  return app.inject({
    method: 'GET',
    url: `/api/users/${a}/vs/${b}${query}`,
    cookies: { auth_token: token },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/users/:a/vs/:b', () => {
  it('1. summary counts: a_wins=2, b_wins=1, draws=1, total=4; winrate_a≈0.5', async () => {
    // A wins 2
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerA.id });
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerA.id });
    // B wins 1
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerB.id });
    // Draw 1 (winner_id = null)
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: null });

    const token = makeToken(playerA.id);
    const res = await getH2H(playerA.id, playerB.id, token);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      player_a: { id: string; username: string };
      player_b: { id: string; username: string };
      summary: { a_wins: number; b_wins: number; draws: number; total: number };
      winrate_a: number;
      faction_breakdown: unknown[];
      recent_matches: unknown[];
    }>();

    expect(body.player_a.id).toBe(playerA.id);
    expect(body.player_b.id).toBe(playerB.id);

    expect(body.summary.a_wins).toBe(2);
    expect(body.summary.b_wins).toBe(1);
    expect(body.summary.draws).toBe(1);
    expect(body.summary.total).toBe(4);

    // winrate_a = 2 decisive wins / 4 total = 0.5
    expect(body.winrate_a).toBeCloseTo(0.5, 5);

    expect(Array.isArray(body.faction_breakdown)).toBe(true);
    expect(Array.isArray(body.recent_matches)).toBe(true);
    expect(body.recent_matches.length).toBeGreaterThanOrEqual(1);
  });

  it('2. symmetry: :b/vs/:a flips a_wins and b_wins, draws and total unchanged', async () => {
    // A wins 2, B wins 1, Draw 1
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerA.id });
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerA.id });
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: playerB.id });
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: null });

    const token = makeToken(playerA.id);

    const resAB = await getH2H(playerA.id, playerB.id, token);
    const resBA = await getH2H(playerB.id, playerA.id, token);

    expect(resAB.statusCode).toBe(200);
    expect(resBA.statusCode).toBe(200);

    const ab = resAB.json<{ summary: { a_wins: number; b_wins: number; draws: number; total: number }; winrate_a: number }>();
    const ba = resBA.json<{ summary: { a_wins: number; b_wins: number; draws: number; total: number }; winrate_a: number }>();

    // A vs B: a_wins=2, b_wins=1
    expect(ab.summary.a_wins).toBe(2);
    expect(ab.summary.b_wins).toBe(1);

    // B vs A: perspective flipped — what was a_wins becomes b_wins and vice versa
    expect(ba.summary.a_wins).toBe(1);
    expect(ba.summary.b_wins).toBe(2);

    // Invariants
    expect(ab.summary.draws).toBe(ba.summary.draws);
    expect(ab.summary.total).toBe(ba.summary.total);
    expect(ab.summary.total).toBe(4);
    expect(ab.summary.draws).toBe(1);
  });

  it('3. draw regression: winner_id=null match is counted, not silently dropped', async () => {
    // Only 1 draw — no other matches
    await createMatch({ player1_id: playerA.id, player2_id: playerB.id, winner_id: null });

    const token = makeToken(playerA.id);
    const res = await getH2H(playerA.id, playerB.id, token);

    expect(res.statusCode).toBe(200);
    const body = res.json<{ summary: { draws: number; total: number }; winrate_a: number }>();

    expect(body.summary.draws).toBe(1);
    expect(body.summary.total).toBe(1);
    // no decisive wins → winrate_a = 0
    expect(body.winrate_a).toBe(0);
  });

  it('4. 404 for unknown user UUID', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000099';
    const token = makeToken(playerA.id);

    const res = await getH2H(playerA.id, unknownId, token);
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; statusCode: number }>();
    expect(body.error).toBe('NotFound');
    expect(body.statusCode).toBe(404);
  });

  it('5. 400 for non-UUID param', async () => {
    const token = makeToken(playerA.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/not-a-uuid/vs/${playerB.id}`,
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('BadRequest');
  });

  it('6. faction_breakdown populated when faction IDs set on matches', async () => {
    // A uses FACTION_A, B uses FACTION_B
    // A wins 2, B wins 1 — all with faction IDs set
    await createMatch({
      player1_id: playerA.id,
      player2_id: playerB.id,
      winner_id: playerA.id,
      player1_faction_id: FACTION_A,
      player2_faction_id: FACTION_B,
    });
    await createMatch({
      player1_id: playerA.id,
      player2_id: playerB.id,
      winner_id: playerA.id,
      player1_faction_id: FACTION_A,
      player2_faction_id: FACTION_B,
    });
    await createMatch({
      player1_id: playerA.id,
      player2_id: playerB.id,
      winner_id: playerB.id,
      player1_faction_id: FACTION_A,
      player2_faction_id: FACTION_B,
    });

    const token = makeToken(playerA.id);
    const res = await getH2H(playerA.id, playerB.id, token);

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      faction_breakdown: Array<{
        faction_id: string;
        faction_name: string;
        a_wins: number;
        b_wins: number;
        draws: number;
      }>;
    }>();

    // Should have an entry for FACTION_A (the faction A used)
    const empireRow = body.faction_breakdown.find((r) => r.faction_id === FACTION_A);
    expect(empireRow).toBeDefined();
    expect(empireRow!.a_wins).toBe(2);
    expect(empireRow!.b_wins).toBe(1);
    expect(empireRow!.draws).toBe(0);
  });

  it('7. 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${playerA.id}/vs/${playerB.id}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
