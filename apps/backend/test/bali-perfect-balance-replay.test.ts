/**
 * END-TO-END REPLAY (2026-10-12) — enticity-presents-rizzottos-celebration-of-perfect-balance through
 * the REAL runBalancedPairingTick (pending byes, reclaim, crystallisation, playoff start included).
 *
 * The real field and bands, with the two events that broke it: FoK drops out of his R2 game against
 * Stelios (so Stelios replays R2 late and falls behind, and Tobiaz waits for him), Stelios' games always
 * finish last, and TL drops out of his R5 game. The engine picks every pairing itself; the test only
 * plays the games. Before the lookahead fix this field produced Stelios–Tobiaz three rounds in a row and
 * two final-round byes; now nobody meets the same opponent in consecutive rounds and nobody rests twice.
 *
 * Requires PostgreSQL with the balanced schema.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { runBalancedPairingTick } from '../src/lib/balanced-liechtenstein-service.js';
import { createTestUser, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ withSocket: false, withRedis: false, withCron: false }); await app.ready(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];
afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

const FIELD: Array<[string, number]> = [
  ['Maze', 5], ['Stelios', 4], ['Dniper', 2], ['Arkhan', 4], ['Brief', 3], ['sabayua', 3], ['Tobiaz', 4], ['anderland', 3],
  ['Dat', 5], ['Boss', 5], ['Berrserk', 5], ['Ahzek', 5], ['Chosen', 5], ['TL', 5], ['FoK', 5], ['Racar', 3],
];

/** Deterministic mulberry32 PRNG — reproducible completion orders. */
function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('BaLi — perfect-balance replay through the real tick', () => {
  it.each([1, 2, 3])('no consecutive rematch and nobody rests twice (completion order %i)', async (seed) => {
    const users = [];
    for (const [name] of FIELD) users.push(await createTestUser({ username: `PBR_${name}` }));
    createdUserIds.push(...users.map((u) => u.id));
    const idOf = new Map(FIELD.map(([name], i) => [name, users[i]!.id]));
    const nameOf = new Map(FIELD.map(([name], i) => [users[i]!.id, name]));

    const tournamentId = randomUUID();
    createdTournamentIds.push(tournamentId);
    await prisma.tournament.create({
      data: {
        id: tournamentId, slug: `test-pbr-${tournamentId.slice(0, 8)}`, name: 'perfect-balance replay', host_id: users[0]!.id,
        format: 'BALANCED_LIECHTENSTEIN', status: 'ONGOING', rounds_count: 5, playoff_format: 'TOP4',
        start_date: new Date('2026-06-01'), timezone: 'Europe/Berlin',
      },
    });
    await prisma.tournamentParticipant.createMany({
      data: FIELD.map(([, band], i) => ({ tournament_id: tournamentId, user_id: users[i]!.id, status: 'CHECKED_IN' as const, skill_band: band })),
    });

    const rand = makeRand(seed);
    const withdraw = async (name: string, matchId: string) => {
      await prisma.tournamentParticipant.updateMany({ where: { tournament_id: tournamentId, user_id: idOf.get(name)! }, data: { status: 'WITHDREW' } });
      await prisma.match.update({ where: { id: matchId }, data: { status: 'CANCELLED', withdrawn_player_id: idOf.get(name)! } });
    };
    const involves = (m: { player1_id: string | null; player2_id: string | null }, name: string) =>
      m.player1_id === idOf.get(name) || m.player2_id === idOf.get(name);

    await runBalancedPairingTick(app, tournamentId);
    for (let step = 0; step < 200; step++) {
      const open = await prisma.match.findMany({
        where: { tournament_id: tournamentId, deleted_at: null, status: 'PENDING', phase: null },
        select: { id: true, round: true, player1_id: true, player2_id: true },
      });
      if (open.length === 0) break;
      // FoK drops out of his R2 game vs Stelios; TL drops out of his R5 game — each the moment it exists.
      const fok = open.find((m) => m.round === 2 && involves(m, 'FoK') && involves(m, 'Stelios'))
        ?? open.find((m) => m.round === 2 && involves(m, 'FoK'));
      const tl = open.find((m) => m.round === 5 && involves(m, 'TL'));
      if (fok) await withdraw('FoK', fok.id);
      else if (tl) await withdraw('TL', tl.id);
      else {
        // Stelios' games always finish last; everything else in a seeded random order.
        const fast = open.filter((m) => !involves(m, 'Stelios'));
        const pool = fast.length > 0 ? fast : open;
        const pick = pool[Math.floor(rand() * pool.length)]!;
        await prisma.match.update({ where: { id: pick.id }, data: { status: 'COMPLETED', winner_id: pick.player1_id } });
      }
      await runBalancedPairingTick(app, tournamentId);
    }

    const group = await prisma.match.findMany({
      where: { tournament_id: tournamentId, deleted_at: null, phase: null, status: { not: 'CANCELLED' } },
      select: { round: true, player1_id: true, player2_id: true, status: true },
    });
    const show = (r: (typeof group)[number]) =>
      `R${r.round} ${nameOf.get(r.player1_id!)}–${r.player2_id ? nameOf.get(r.player2_id) : '(bye)'} ${r.status}`;

    // Every remaining competitor finished all five rounds (a game or a bye each round).
    const active = FIELD.map(([n]) => n).filter((n) => n !== 'FoK' && n !== 'TL');
    for (const n of active) {
      const rounds = group.filter((g) => involves(g, n)).map((g) => g.round).sort();
      expect(rounds, `${n} rounds: ${group.filter((g) => involves(g, n)).map(show).join(', ')}`).toEqual([1, 2, 3, 4, 5]);
    }
    // Nobody faces the same opponent in two consecutive rounds.
    const games = group.filter((g) => g.player2_id !== null);
    const lastMet = new Map<string, number>();
    for (const g of [...games].sort((a, b) => a.round - b.round)) {
      const key = [g.player1_id, g.player2_id].sort().join('|');
      expect(lastMet.get(key), `consecutive rematch: ${show(g)}\n${games.map(show).join('\n')}`).not.toBe(g.round - 1);
      lastMet.set(key, g.round);
    }
    // Nobody rests twice, and no provisional bye is left unsettled.
    const byes = group.filter((g) => g.player2_id === null && g.status !== 'CATCHUP_BYE');
    for (const n of active) {
      expect(byes.filter((b) => involves(b, n)).length, `${n} byes: ${byes.map(show).join(', ')}`).toBeLessThanOrEqual(1);
    }
    expect(byes.filter((b) => b.status === 'PENDING_BYE').map(show)).toEqual([]);
  }, 120_000);
});
