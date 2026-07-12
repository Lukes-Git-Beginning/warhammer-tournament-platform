/**
 * BO2 series ("two-leg home/away", used by 1v3): exactly 2 games, 1–1 = Draw.
 * Exercises finalizeGameResult's series-completion logic directly.
 *
 * Requires real PostgreSQL (Docker up). No Redis, no Socket.IO.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { finalizeGameResult } from '../src/lib/match-games.js';
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

let organizer: TestUser;
let p1: TestUser;
let p2: TestUser;
let tournamentId: string;
let matchId: string;

/** BO2 SWISS match with game 1 already COMPLETED (winner=g1Winner) and game 2
 *  reported (reported_winner_id=g2Winner) and ready to finalize. Returns game 2 id. */
async function setupBo2(g1Winner: () => string, g2Winner: () => string): Promise<string> {
  tournamentId = randomUUID();
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-bo2-${tournamentId.slice(0, 8)}`,
      name: 'BO2 Test Tournament',
      host_id: organizer.id,
      format: 'SWISS',
      mode: 'BPT',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      swiss_match_format: 'BO2',
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
      player1_id: p1.id,
      player2_id: p2.id,
      phase: 'SWISS',
    },
  });

  await prisma.matchGame.create({
    data: { match_id: matchId, game_number: 1, status: 'COMPLETED', winner_id: g1Winner(), played_at: new Date() },
  });
  const g2 = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: 2, status: 'PENDING', reported_winner_id: g2Winner() },
  });
  return g2.id;
}

beforeEach(async () => {
  organizer = await createTestUser({ username: 'Bo2Org' });
  p1 = await createTestUser({ username: 'Bo2P1' });
  p2 = await createTestUser({ username: 'Bo2P2' });
  tournamentId = '';
});

afterEach(async () => {
  if (tournamentId) await cleanupTournament(tournamentId);
  await cleanupUsers([organizer?.id, p1?.id, p2?.id].filter((x): x is string => Boolean(x)));
  tournamentId = '';
});

describe('BO2 series completion', () => {
  it('a 1–1 BO2 completes the match as a Draw (winner_id null)', async () => {
    const g2Id = await setupBo2(() => p1.id, () => p2.id); // 1–1
    await finalizeGameResult(app, g2Id);

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match!.status).toBe('COMPLETED');
    expect(match!.winner_id).toBeNull(); // Draw
    // No third game is created — a BO2 caps at 2 games.
    const games = await prisma.matchGame.count({ where: { match_id: matchId } });
    expect(games).toBe(2);
  });

  it('a 2–0 BO2 completes the match with the sweeping winner', async () => {
    const g2Id = await setupBo2(() => p1.id, () => p1.id); // 2–0 for p1
    await finalizeGameResult(app, g2Id);

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match!.status).toBe('COMPLETED');
    expect(match!.winner_id).toBe(p1.id);
  });
});
