/**
 * Competition tracks (design doc §6/§7): time windows, monthly ladder points, and the
 * three board endpoints (hall-of-fame / quarterly / ladder).
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { currentMonth, currentQuarter, computeLadderStandings, loadCompetitionConfig } from '../src/lib/competition.js';
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

const createdUserIds: string[] = [];
const createdMatchIds: string[] = [];
afterEach(async () => {
  if (createdMatchIds.length) await prisma.match.deleteMany({ where: { id: { in: createdMatchIds } } });
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdMatchIds.length = 0;
  createdUserIds.length = 0;
});

describe('competition time windows', () => {
  it('currentQuarter returns the enclosing calendar quarter (UTC)', () => {
    const q = currentQuarter(new Date('2026-05-15T12:00:00Z'));
    expect(q.from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(q.label).toBe('Q2 2026');
  });
  it('currentMonth returns the enclosing calendar month (UTC)', () => {
    const m = currentMonth(new Date('2026-11-30T23:00:00Z'));
    expect(m.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('ladder standings', () => {
  it('awards monthly Open-Play points (win / loss) from decisive games', async () => {
    const a = await createTestUser({ username: 'LadderA' });
    const b = await createTestUser({ username: 'LadderB' });
    createdUserIds.push(a.id, b.id);

    const matchId = randomUUID();
    createdMatchIds.push(matchId);
    await prisma.match.create({
      data: {
        id: matchId,
        type: 'OPEN_PLAY',
        round: 1,
        match_number: 1,
        player1_id: a.id,
        player2_id: b.id,
        winner_id: a.id,
        status: 'COMPLETED',
        played_at: new Date(),
      },
    });
    await prisma.matchGame.create({
      data: { match_id: matchId, game_number: 1, status: 'COMPLETED', winner_id: a.id, played_at: new Date(), counts_for_leaderboard: true },
    });

    const cfg = await loadCompetitionConfig(prisma);
    const standings = await computeLadderStandings(prisma, currentMonth(), cfg);
    const sa = standings.find((s) => s.playerId === a.id);
    const sb = standings.find((s) => s.playerId === b.id);
    expect(sa?.points).toBe(cfg.ladderWinPoints);
    expect(sa?.wins).toBe(1);
    expect(sb?.points).toBe(cfg.ladderLossPoints);
    expect(sb?.losses).toBe(1);
  });
});

describe('competition board endpoints', () => {
  it('serve the hall-of-fame, quarterly and ladder boards', async () => {
    for (const url of ['/api/leaderboard/hall-of-fame', '/api/leaderboard/quarterly', '/api/leaderboard/ladder']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().entries)).toBe(true);
    }
  });
});
