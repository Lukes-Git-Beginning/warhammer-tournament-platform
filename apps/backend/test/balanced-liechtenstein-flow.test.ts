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
import {
  runBalancedPairingTick,
  startBalancedPlayoffs,
  assignSkillBandsForTournament,
  applyBalancedStartConfig,
} from '../src/lib/balanced-liechtenstein-service.js';
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
    select: { id: true, round: true, player1_id: true, player2_id: true, status: true, phase: true },
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
    // Group phase is exactly two rounds × two matches — no third GROUP round.
    // (Round 3 now holds the auto-launched division playoffs, phase != null.)
    const group = matches.filter((m) => m.phase === null);
    expect(group.filter((m) => m.round === 1)).toHaveLength(2);
    expect(group.filter((m) => m.round === 2)).toHaveLength(2);
    expect(group.filter((m) => m.round === 3)).toHaveLength(0);
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

    // The pairing tick auto-launches the division playoffs when the group finishes.
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

  it('never seeds a REGISTERED (never-checked-in) participant into a division bracket (Big Bees)', async () => {
    // 3 real checked-in contenders + 1 phantom who registered but never checked in.
    // Before the fix the phantom (band 5, 0 points) padded the pool to 4, which turns
    // the division into a final + third-place match — and the phantom filled seed 4 of
    // that third-place match. The pool must be built from checked-in contenders only.
    const { tournamentId } = await setup([5, 5, 5], 2);
    const ghost = await createTestUser({ username: 'BigBees' });
    createdUserIds.push(ghost.id);
    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournamentId, user_id: ghost.id, status: 'REGISTERED', skill_band: 5 },
    });

    await runGroupPhase(tournamentId, 2); // group completes → auto-launch playoffs

    const playoff = await prisma.match.findMany({
      where: { tournament_id: tournamentId, phase: { startsWith: 'PLAYOFF' }, deleted_at: null },
      select: { player1_id: true, player2_id: true },
    });
    const inPlayoffs = new Set(
      playoff.flatMap((m) => [m.player1_id, m.player2_id]).filter((x): x is string => Boolean(x)),
    );
    expect(playoff.length).toBeGreaterThan(0); // the 3 real contenders did generate a bracket
    expect(inPlayoffs.has(ghost.id)).toBe(false); // the phantom is not in it
  });

  it('refuses to generate playoffs twice', async () => {
    const { tournamentId } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runGroupPhase(tournamentId, 2); // auto-launches the division playoffs
    const again = await startBalancedPlayoffs(app, tournamentId);
    expect('error' in again).toBe(true);
  });

  it('auto-launches playoffs even when a group match carries phase SWISS', async () => {
    // A manually-created / forfeit group match stamps phase 'SWISS' (not null). The
    // auto-launch guard must not mistake it for an existing playoff, or the division
    // playoffs never generate. (Regression: a live tournament whose group phase was
    // complete but whose playoffs never auto-started because of one SWISS-phase match.)
    const { tournamentId } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runBalancedPairingTick(app, tournamentId); // round 1

    // Poison one group match with phase 'SWISS', as the create-match/forfeit path does.
    const r1 = (await liveMatches(tournamentId)).filter((m) => m.round === 1);
    await prisma.match.update({ where: { id: r1[0]!.id }, data: { phase: 'SWISS' } });

    // Finish the group phase; the final tick should still auto-launch the playoffs.
    for (const m of (await liveMatches(tournamentId)).filter((m) => m.round === 1)) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);
    for (const m of (await liveMatches(tournamentId)).filter((m) => m.round === 2)) await finish(m.id, m.player1_id!);
    await runBalancedPairingTick(app, tournamentId);

    const finals = await prisma.match.findMany({
      where: { tournament_id: tournamentId, phase: 'PLAYOFF_FINAL', deleted_at: null },
      select: { id: true },
    });
    expect(finals).toHaveLength(2); // playoffs launched despite the SWISS group match
  });

  it('finalizes to complete, distinct placements after division finals', async () => {
    const { tournamentId, users } = await setup([5, 5, 5, 5, 3, 3, 3, 3], 2);
    await runGroupPhase(tournamentId, 2); // auto-launches the division playoffs

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

describe('Balanced Liechtenstein — play-up (requested band)', () => {
  it('sets the effective band to max(computed, requested) at Start', async () => {
    const users = await Promise.all([0, 1, 2, 3].map((i) => createTestUser({ username: `PU${i}` })));
    createdUserIds.push(...users.map((u) => u.id));
    const tournamentId = randomUUID();
    createdTournamentIds.push(tournamentId);
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `test-pu-${tournamentId.slice(0, 8)}`,
        name: 'Play-up Test',
        host_id: users[0]!.id,
        format: 'BALANCED_LIECHTENSTEIN',
        status: 'ONGOING',
        rounds_count: 2,
        start_date: new Date('2026-06-01'),
        timezone: 'Europe/Berlin',
      },
    });
    await prisma.tournamentParticipant.createMany({
      data: [
        { tournament_id: tournamentId, user_id: users[0]!.id, status: 'CHECKED_IN', requested_band: 4 },
        { tournament_id: tournamentId, user_id: users[1]!.id, status: 'CHECKED_IN', requested_band: 5 },
        { tournament_id: tournamentId, user_id: users[2]!.id, status: 'CHECKED_IN' }, // no request
        { tournament_id: tournamentId, user_id: users[3]!.id, status: 'CHECKED_IN', requested_band: 1 },
      ],
    });

    await assignSkillBandsForTournament(app, tournamentId);

    const parts = await prisma.tournamentParticipant.findMany({
      where: { tournament_id: tournamentId },
      select: { user_id: true, skill_band: true },
    });
    const band = new Map(parts.map((p) => [p.user_id, p.skill_band]));
    // These players have no games/calibration → computed band is New (1), so the
    // request raises the effective band but never lowers it.
    expect(band.get(users[0]!.id)).toBe(4); // max(computed, 4)
    expect(band.get(users[1]!.id)).toBe(5); // max(computed, 5)
    expect(band.get(users[3]!.id)).toBe(1); // requested 1 → stays at the computed floor
    expect([null, 1]).toContain(band.get(users[2]!.id)); // no play-up
  });
});

describe('Balanced Liechtenstein — auto-sizing gate', () => {
  it('keeps the fixed round count when auto_sizing is off, and derives it when on', async () => {
    const users = await Promise.all([0, 1, 2, 3].map((i) => createTestUser({ username: `AS${i}` })));
    createdUserIds.push(...users.map((u) => u.id));
    const tournamentId = randomUUID();
    createdTournamentIds.push(tournamentId);
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `test-as-${tournamentId.slice(0, 8)}`,
        name: 'Auto-size Gate Test',
        host_id: users[0]!.id,
        format: 'BALANCED_LIECHTENSTEIN',
        status: 'ONGOING',
        rounds_count: 6,
        auto_sizing: false,
        start_date: new Date('2026-06-01'),
        timezone: 'Europe/Berlin',
      },
    });
    await prisma.tournamentParticipant.createMany({
      data: users.map((u) => ({ tournament_id: tournamentId, user_id: u.id, status: 'CHECKED_IN' as const })),
    });

    // auto_sizing off → the host's fixed round count is preserved (gate returns early).
    await applyBalancedStartConfig(app, tournamentId);
    let t = await prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { rounds_count: true },
    });
    expect(t.rounds_count).toBe(6);

    // Flip auto_sizing on → round count is derived from the 4 checked-in players (→ 3).
    await prisma.tournament.update({ where: { id: tournamentId }, data: { auto_sizing: true } });
    await applyBalancedStartConfig(app, tournamentId);
    t = await prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { rounds_count: true },
    });
    expect(t.rounds_count).toBe(3);
  });
});
