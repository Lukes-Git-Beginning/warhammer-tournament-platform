/**
 * Integration test for BaLi 2.0's pending-bye lifecycle against a real DB — the piece the
 * pure simulation cannot reach (it lives in the service tick, not in planPairings).
 *
 * Covers the three transitions of a PENDING_BYE:
 *   - RECLAIM:      a same-depth free player fills a still-provisional bye → real match,
 *   - CRYSTALLISE:  once the holder has moved on it can no longer be reclaimed → scored bye,
 *   - MARKER:       a marked late joiner with no real game only ever gets 0-point catch-up byes.
 *
 * Requires PostgreSQL with the balanced schema (skill_band, late_joined, PENDING_BYE).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { runBalancedPairingTick } from '../src/lib/balanced-liechtenstein-service.js';
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

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) {
    await prisma.leaderboardEntry.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await cleanupUsers(createdUserIds);
  }
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

async function setup(bands: number[], roundsCount: number): Promise<{ tournamentId: string; users: TestUser[] }> {
  const users: TestUser[] = [];
  for (let i = 0; i < bands.length; i++) users.push(await createTestUser({ username: `PB${i}` }));
  createdUserIds.push(...users.map((u) => u.id));

  const tournamentId = randomUUID();
  createdTournamentIds.push(tournamentId);
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-pb-${tournamentId.slice(0, 8)}`,
      name: 'BaLi Pending-Bye Test',
      host_id: users[0]!.id,
      format: 'BALANCED_LIECHTENSTEIN',
      status: 'ONGOING',
      rounds_count: roundsCount,
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
  });
  await prisma.tournamentParticipant.createMany({
    data: users.map((u, i) => ({
      tournament_id: tournamentId,
      user_id: u.id,
      status: 'CHECKED_IN' as const,
      skill_band: bands[i]!,
    })),
  });
  return { tournamentId, users };
}

async function liveMatches(tournamentId: string) {
  return prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { id: true, round: true, player1_id: true, player2_id: true, status: true, winner_id: true },
    orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
  });
}

async function makePendingBye(tournamentId: string, playerId: string, round: number, matchNumber: number) {
  await prisma.match.create({
    data: {
      id: randomUUID(),
      tournament_id: tournamentId,
      round,
      match_number: matchNumber,
      player1_id: playerId,
      player2_id: null,
      status: 'PENDING_BYE',
      winner_id: null,
      phase: null,
    },
  });
}

describe('BaLi 2.0 — pending-bye lifecycle', () => {
  it('reclaims a PENDING_BYE into a real match when a same-depth player is free', async () => {
    // C sits on a provisional bye at round 1; D is a fresh same-depth player (no match yet).
    const { tournamentId, users } = await setup([3, 3], 3);
    const [c, d] = users;
    await makePendingBye(tournamentId, c!.id, 1, 1);

    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    // Rather than sit D on a second bye, the provisional bye is filled → one real match.
    expect(matches.some((m) => m.status === 'PENDING_BYE')).toBe(false);
    const real = matches.find((m) => m.status === 'PENDING' && m.round === 1);
    expect(real, 'a real round-1 match should exist').toBeDefined();
    expect(new Set([real!.player1_id, real!.player2_id])).toEqual(new Set([c!.id, d!.id]));
  });

  it('crystallises a PENDING_BYE into a scored bye once its holder has moved on', async () => {
    // C has a provisional round-1 bye AND has already been paired forward into round 2 →
    // the round-1 bye can no longer be reclaimed, so it scores.
    const { tournamentId, users } = await setup([3, 3], 3);
    const [c, x] = users;
    await makePendingBye(tournamentId, c!.id, 1, 1);
    await prisma.match.create({
      data: {
        id: randomUUID(),
        tournament_id: tournamentId,
        round: 2,
        match_number: 2,
        player1_id: c!.id,
        player2_id: x!.id,
        status: 'PENDING',
        winner_id: null,
        phase: null,
      },
    });

    await runBalancedPairingTick(app, tournamentId);

    const bye = (await liveMatches(tournamentId)).find((m) => m.round === 1);
    expect(bye!.status).toBe('BYE'); // on-time holder → scored
    expect(bye!.winner_id).toBe(c!.id);
  });

  it('gives a marked late joiner a 0-point catch-up bye, never a scored one', async () => {
    // A lone marked late joiner with no real game byes through the rounds — every one must
    // crystallise as a 0-point CATCHUP_BYE, not a scoring BYE (the reward-for-being-late fix).
    const { tournamentId, users } = await setup([3], 3);
    const [l] = users;
    await prisma.tournamentParticipant.updateMany({
      where: { tournament_id: tournamentId, user_id: l!.id },
      data: { late_joined: true },
    });

    await runBalancedPairingTick(app, tournamentId);

    const byes = await liveMatches(tournamentId);
    expect(byes.length).toBeGreaterThan(0);
    for (const m of byes) {
      expect(m.status).toBe('CATCHUP_BYE');
      expect(m.winner_id).toBeNull();
    }
  });
});
