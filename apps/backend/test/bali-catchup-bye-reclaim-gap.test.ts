/**
 * REPRODUCTION (2026-08-23) — "manual interventions break BaLi" root cause.
 *
 * Alex's live case (bottom-of-the-barrel-2d3-2): a resting player (Max) and a late joiner
 * (Solmeer) were BOTH free and in the SAME band, yet the engine did not auto-pair them, so the
 * host had to create the match by hand — which then cascaded (frontier shift, phantom byes,
 * a wrongly-frozen playoff that dropped an undefeated division leader).
 *
 * The engine gap: the pairing tick's RECLAIM step (Step B, runBalancedPairingTick) only reconciles
 * a NEWLY-formed bye (plan.byes) against an existing PENDING_BYE. It never reconciles two ALREADY
 * resting players against each other — and a late joiner rests on a CATCHUP_BYE (created up-front by
 * admitBalancedLateJoiner), which is neither a plan.byes source nor a PENDING_BYE reclaim target.
 *
 * Control case  → an UNPLACED late joiner IS reclaimed into a free player's PENDING_BYE (works today).
 * Bug case      → a late joiner ALREADY holding a CATCHUP_BYE at that round is NOT paired with a
 *                 same-band free player (fails today — the reproduction).
 *
 * Requires PostgreSQL with the balanced schema. Runs in CI.
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
  for (let i = 0; i < bands.length; i++) users.push(await createTestUser({ username: `RG${i}` }));
  createdUserIds.push(...users.map((u) => u.id));

  const tournamentId = randomUUID();
  createdTournamentIds.push(tournamentId);
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      slug: `test-rg-${tournamentId.slice(0, 8)}`,
      name: 'BaLi Catch-up Reclaim Gap',
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

async function markLateJoiner(tournamentId: string, userId: string) {
  await prisma.tournamentParticipant.updateMany({
    where: { tournament_id: tournamentId, user_id: userId },
    data: { late_joined: true },
  });
}

async function makeBye(tournamentId: string, playerId: string, round: number, matchNumber: number, status: 'PENDING_BYE' | 'CATCHUP_BYE') {
  await prisma.match.create({
    data: {
      id: randomUUID(),
      tournament_id: tournamentId,
      round,
      match_number: matchNumber,
      player1_id: playerId,
      player2_id: null,
      status,
      winner_id: null,
      phase: null,
    },
  });
}

describe('BaLi — catch-up-bye reclaim gap (Max + Solmeer)', () => {
  // CONTROL: an UNPLACED same-band late joiner is reclaimed into a resting player's PENDING_BYE.
  // This is expected to PASS on current code — it proves the reclaim itself works for a late joiner,
  // isolating the pre-existing CATCHUP_BYE row (below) as the specific culprit.
  it('reclaims an UNPLACED late joiner into a free player PENDING_BYE (same band)', async () => {
    const { tournamentId, users } = await setup([5, 5], 3);
    const [max, solmeer] = users;
    await markLateJoiner(tournamentId, solmeer!.id); // late joiner, no match row yet (unplaced)
    await makeBye(tournamentId, max!.id, 1, 1, 'PENDING_BYE'); // resting free player

    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    const real = matches.find((m) => m.status === 'PENDING' && m.round === 1);
    expect(real, 'the free player and the unplaced late joiner should be paired').toBeDefined();
    expect(new Set([real!.player1_id, real!.player2_id])).toEqual(new Set([max!.id, solmeer!.id]));
  });

  // BUG: once the late joiner already holds a CATCHUP_BYE at that round (as admitBalancedLateJoiner
  // creates), the tick sees them as "placed" → they never enter plan.byes → the reclaim cannot pair
  // them with the same-band free player. Both stay resting. Expected to FAIL on current code.
  it('pairs a free player with a same-band late joiner who already holds a CATCHUP_BYE', async () => {
    const { tournamentId, users } = await setup([5, 5], 3);
    const [max, solmeer] = users;
    await markLateJoiner(tournamentId, solmeer!.id);
    await makeBye(tournamentId, max!.id, 1, 1, 'PENDING_BYE'); // Max resting on a provisional bye
    await makeBye(tournamentId, solmeer!.id, 1, 2, 'CATCHUP_BYE'); // Solmeer already on a catch-up bye

    await runBalancedPairingTick(app, tournamentId);

    const matches = await liveMatches(tournamentId);
    const real = matches.find((m) => m.status === 'PENDING' && m.round === 1);
    expect(real, 'two free same-band players (PENDING_BYE + CATCHUP_BYE) should be reconciled into a real match').toBeDefined();
    expect(new Set([real!.player1_id, real!.player2_id])).toEqual(new Set([max!.id, solmeer!.id]));
    // And nobody should be left resting once a legal same-band partner exists.
    expect(matches.some((m) => m.status === 'PENDING_BYE' || m.status === 'CATCHUP_BYE')).toBe(false);
  });
});
