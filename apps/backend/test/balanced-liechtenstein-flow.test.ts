/**
 * Integration test for the Balanced Liechtenstein pairing tick against a real DB.
 *
 * Drives the incremental flow directly (runBalancedPairingTick) by flipping match
 * statuses, so it needs no map/season/rating data — it verifies that finishing a
 * match creates the next round match by match, and that the tournament runs dry.
 *
 * Requires PostgreSQL with the balanced schema (skill_band + BALANCED_LIECHTENSTEIN).
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
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

/** Create an ONGOING balanced tournament with N checked-in, banded participants. */
async function setup(bands: number[], roundsCount: number): Promise<{ tournamentId: string; users: TestUser[] }> {
  const users: TestUser[] = [];
  for (let i = 0; i < bands.length; i++) users.push(await createTestUser({ username: `BL${i}` }));
  createdUserIds.push(...users.map((u) => u.id));

  const tournamentId = randomUUID();
  createdTournamentIds.push(tournamentId);
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-bl-${tournamentId.slice(0, 8)}`,
      name: 'Balanced Liechtenstein Test',
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
    select: { id: true, round: true, player1_id: true, player2_id: true, status: true },
    orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
  });
}

async function finish(matchId: string, winnerId: string): Promise<void> {
  await prisma.match.update({ where: { id: matchId }, data: { status: 'COMPLETED', winner_id: winnerId } });
}

describe('Balanced Liechtenstein — incremental pairing flow', () => {
  it('creates all of round 1 on the first tick', async () => {
    const { tournamentId } = await setup([3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.round === 1 && m.status === 'PENDING')).toBe(true);
  });

  it('holds the finished pair until the rest of the round catches up', async () => {
    const { tournamentId } = await setup([3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId);
    const [m1] = await liveMatches(tournamentId);

    // Finish only one round-1 match; the other is still ongoing (incoming to pool 2).
    await finish(m1!.id, m1!.player1_id!);
    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    // Still just the two round-1 matches — no round 2 yet.
    expect(matches.filter((m) => m.round === 2)).toHaveLength(0);
  });

  it('pairs the next round match by match, never repeating the last opponent', async () => {
    const { tournamentId } = await setup([3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId);
    const round1 = await liveMatches(tournamentId);

    for (const m of round1) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);

    const round2 = (await liveMatches(tournamentId)).filter((m) => m.round === 2);
    expect(round2).toHaveLength(2);
    // No round-2 pairing may repeat a round-1 pairing.
    const r1Pairs = round1.map((m) => new Set([m.player1_id, m.player2_id]));
    for (const m of round2) {
      const pair = new Set([m.player1_id, m.player2_id]);
      for (const prev of r1Pairs) {
        expect(pair).not.toEqual(prev);
      }
    }
  });

  it('runs dry once everyone has played all rounds', async () => {
    const { tournamentId } = await setup([3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId);
    for (const m of (await liveMatches(tournamentId)).filter((m) => m.round === 1)) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);
    for (const m of (await liveMatches(tournamentId)).filter((m) => m.round === 2)) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    // Exactly two rounds × two matches, nothing more generated.
    expect(matches.filter((m) => m.round === 1)).toHaveLength(2);
    expect(matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(matches.filter((m) => m.round === 3)).toHaveLength(0);
  });

  it('keeps same-band players together and ascends the surplus', async () => {
    // 3 low-band + 1 high-band, one round. Low pair up; the odd low ascends to the high.
    const { tournamentId } = await setup([1, 1, 1, 5], 1);
    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    expect(matches.filter((m) => m.status === 'PENDING')).toHaveLength(2);
  });
});
