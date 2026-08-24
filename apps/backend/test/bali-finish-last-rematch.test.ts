/**
 * REPRODUCTION (2026-08-23) — friday-balanced-liechtenstein-bpt: Dniper (b2) & Kite (b2) played
 * each other in BOTH round 1 (#5) and round 2 (#19). The audit log proves: #19 was a normal
 * tick-created match (no manual edit, no override), there were NO withdrawals around R2, and the
 * Dniper-Kite R1 match (#5) was reported LAST — after every other R1 match AND after R2 had already
 * begun forming. So the immediate rematch came from the pairing TICK when the pair finished last.
 *
 * This drives the REAL runBalancedPairingTick (not a planPairings hand-sim): it completes the 8
 * round-1 matches in the audit's order with the b2 pair LAST, ticking after each, then asserts that
 * the two b2 players are NOT paired against each other again in round 2 (an immediate rematch is a
 * hard block). If the tick produces the rematch, this test fails → the bug is reproduced.
 *
 * Requires PostgreSQL with the balanced schema.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { runBalancedPairingTick } from '../src/lib/balanced-liechtenstein-service.js';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ withSocket: false, withRedis: false, withCron: false }); await app.ready(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];
afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) {
    await prisma.leaderboardEntry.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await cleanupUsers(createdUserIds);
  }
  createdTournamentIds.length = 0; createdUserIds.length = 0;
});

describe('BaLi — immediate rematch when the pair finishes last (friday-bpt Dniper/Kite)', () => {
  it('never re-pairs the two band-2 players in round 2 after they finished round 1 last', async () => {
    // Real round-1 band distribution: 2×b2, 4×b3, 2×b4, 8×b5 = 16 players.
    const bands = [2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5];
    const users: TestUser[] = [];
    for (let i = 0; i < bands.length; i++) users.push(await createTestUser({ username: `FL${i}_b${bands[i]}` }));
    createdUserIds.push(...users.map((u) => u.id));
    const uid = (i: number) => users[i]!.id;

    const tournamentId = randomUUID();
    createdTournamentIds.push(tournamentId);
    await prisma.tournament.create({
      data: {
        id: tournamentId, slug: `test-fl-${tournamentId.slice(0, 8)}`, name: 'BaLi finish-last rematch',
        host_id: uid(0), format: 'BALANCED_LIECHTENSTEIN', status: 'ONGOING', rounds_count: 6,
        start_date: new Date('2026-06-01'), timezone: 'Europe/Berlin',
      },
    });
    await prisma.tournamentParticipant.createMany({
      data: users.map((u, i) => ({ tournament_id: tournamentId, user_id: u.id, status: 'CHECKED_IN' as const, skill_band: bands[i]! })),
    });

    // Round-1 pairings (same-band, matching the real bracket): [b2 pair], [b3 pair], [b3 pair],
    // [b4 pair], and 4 b5 pairs. The b2 pair is players 0 & 1.
    const r1 = [
      [0, 1], // b2  — Dniper vs Kite (the pair that will finish LAST)
      [2, 3], // b3
      [4, 5], // b3
      [6, 7], // b4
      [8, 9], [10, 11], [12, 13], [14, 15], // b5
    ];
    let n = 1;
    const matchIdByPair = new Map<number, string>();
    for (let p = 0; p < r1.length; p++) {
      const id = randomUUID();
      matchIdByPair.set(p, id);
      await prisma.match.create({
        data: {
          id, tournament_id: tournamentId, round: 1, match_number: n++,
          player1_id: uid(r1[p]![0]!), player2_id: uid(r1[p]![1]!), status: 'PENDING', phase: null,
        },
      });
    }

    // Complete R1 in the AUDIT order — every non-b2 match first, the b2 pair (index 0) LAST — and
    // run the real pairing tick after each completion (as the real event-driven tick does).
    const completionOrder = [1, 2, 3, 4, 5, 6, 7, 0]; // pair index 0 (b2) is last
    for (const p of completionOrder) {
      const id = matchIdByPair.get(p)!;
      await prisma.match.update({ where: { id }, data: { status: 'COMPLETED', winner_id: uid(r1[p]![0]!) } });
      await runBalancedPairingTick(app, tournamentId);
    }

    // Assert: the two band-2 players are NOT paired against each other again in round 2.
    const r2 = await prisma.match.findMany({
      where: { tournament_id: tournamentId, round: 2, deleted_at: null },
      select: { player1_id: true, player2_id: true, status: true },
    });
    const rematch = r2.find(
      (m) => (m.player1_id === uid(0) && m.player2_id === uid(1)) || (m.player1_id === uid(1) && m.player2_id === uid(0)),
    );
    expect(rematch, `round 2 should NOT re-pair the two b2 players (immediate rematch). r2=${JSON.stringify(r2)}`).toBeUndefined();
  });
});
