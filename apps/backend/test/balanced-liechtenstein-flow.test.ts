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
import { runBalancedPairingTick, startBalancedPlayoffs } from '../src/lib/balanced-liechtenstein-service.js';
import { finalizeTournament } from '../src/lib/finalize-tournament.js';
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
    // finalizeTournament writes LeaderboardEntry rows on the active season; clear
    // them (FK to User) before deleting the test users.
    await prisma.leaderboardEntry.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await cleanupUsers(createdUserIds);
  }
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

/** Run the whole group phase to completion (finish every pending match, re-tick). */
async function runGroupPhase(tournamentId: string, rounds: number): Promise<void> {
  await runBalancedPairingTick(app, tournamentId);
  for (let r = 1; r <= rounds; r++) {
    const pending = (await liveMatches(tournamentId)).filter((m) => m.status === 'PENDING');
    for (const m of pending) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);
  }
}

describe('Balanced Liechtenstein — division playoffs', () => {
  it('refuses playoffs while the group phase is unfinished', async () => {
    const { tournamentId } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId); // only round 1 exists
    const result = await startBalancedPlayoffs(app, tournamentId);
    expect('error' in result).toBe(true);
  });

  it('creates one final per division once the group phase is complete', async () => {
    const { tournamentId } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runGroupPhase(tournamentId, 2);

    const result = await startBalancedPlayoffs(app, tournamentId);
    expect('finals' in result).toBe(true);

    const finals = await prisma.match.findMany({
      where: { tournament_id: tournamentId, phase: 'PLAYOFF_FINAL', deleted_at: null },
      select: { round: true, player1_id: true, player2_id: true, status: true },
    });
    // Two even divisions (4 level-5 + 4 level-3) → two division finals.
    expect(finals).toHaveLength(2);
    expect(finals.every((m) => m.status === 'PENDING' && m.player1_id && m.player2_id)).toBe(true);
    const players = new Set(finals.flatMap((m) => [m.player1_id, m.player2_id]));
    expect(players.size).toBe(4); // four distinct finalists
  });

  it('refuses to generate playoffs twice', async () => {
    const { tournamentId } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runGroupPhase(tournamentId, 2);
    await startBalancedPlayoffs(app, tournamentId);
    const second = await startBalancedPlayoffs(app, tournamentId);
    expect('error' in second).toBe(true);
  });

  it('finalizes to complete, distinct placements after division finals', async () => {
    const { tournamentId, users } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runGroupPhase(tournamentId, 2);
    await startBalancedPlayoffs(app, tournamentId);

    // Play out the division finals.
    const finals = await prisma.match.findMany({
      where: { tournament_id: tournamentId, phase: 'PLAYOFF_FINAL', deleted_at: null },
      select: { id: true, player1_id: true },
    });
    for (const f of finals) await finish(f.id, f.player1_id!);

    const result = await finalizeTournament(prisma, tournamentId, users[0]!.id);
    expect(result.resultCount).toBe(8);

    // Overall placement is Swiss-based: one row per player, a clean 1..8 ranking
    // (no duplicate "1st places" from the parallel division finals).
    const rows = await prisma.tournamentResult.findMany({
      where: { tournament_id: tournamentId },
      select: { user_id: true, placement: true },
    });
    expect(rows).toHaveLength(8); // one result per player
    const placements = rows.map((r) => r.placement);
    // A single coherent ranking (Swiss-based) — someone is 1st, all within range,
    // and it's a real spread rather than the "every division champion is 1st" bug.
    expect(Math.min(...placements)).toBe(1);
    expect(Math.max(...placements)).toBeLessThanOrEqual(8);
    expect(new Set(placements).size).toBeGreaterThan(1);
  });
});
