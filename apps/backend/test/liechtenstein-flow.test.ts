/**
 * Integration test for the modernised Liechtenstein ASAP engine (2026-09).
 * Exercises: start → round-1 pairing via the tick, ASAP re-pairing on completion, HARD rematch
 * exclusion, group-phase completion → optional TOP-N playoffs, and mid-tournament late join.
 *
 * Requires real PostgreSQL. No Redis (lock is skipped → tick runs inline), no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';
import { runLiechtensteinPairingTick, admitLiechtensteinLateJoiner } from '../src/lib/liechtenstein-service.js';

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

async function makeTournament(opts: { rounds: number; playoffFormat?: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8' }) {
  const id = randomUUID();
  const slug = `test-li-${id.slice(0, 8)}`;
  createdTournamentIds.push(id);
  const h = await createTestUser({ username: `li-host-${id.slice(0, 4)}` });
  createdUserIds.push(h.id);
  await prisma.tournament.create({
    data: {
      id, slug, name: 'Liechtenstein Test', host_id: h.id,
      format: 'LIECHTENSTEIN', mode: 'BPT', competitor_format: 'ONE_V_ONE',
      status: 'ONGOING', rounds_count: opts.rounds, playoff_format: opts.playoffFormat ?? 'NONE',
      playoff_match_format: 'BO1', finale_match_format: 'BO1',
      start_date: new Date('2027-06-01'), timezone: 'Europe/Berlin',
    },
  });
  return { id, slug };
}

async function addPlayers(tournamentId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await createTestUser({ username: `li-p${i}-${tournamentId.slice(0, 4)}` });
    createdUserIds.push(u.id);
    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournamentId, user_id: u.id, status: 'CHECKED_IN' },
    });
    ids.push(u.id);
  }
  return ids;
}

/** Complete every open GROUP match (player1 wins) and tick, until the group phase is done. */
async function playGroup(tournamentId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const pending = await prisma.match.findMany({
      where: { tournament_id: tournamentId, status: { in: ['PENDING', 'ONGOING'] }, phase: null, deleted_at: null },
      select: { id: true, player1_id: true },
    });
    if (pending.length === 0) {
      await runLiechtensteinPairingTick(app, tournamentId);
      const more = await prisma.match.count({
        where: { tournament_id: tournamentId, status: { in: ['PENDING', 'ONGOING'] }, phase: null, deleted_at: null },
      });
      if (more === 0) return;
      continue;
    }
    for (const m of pending) {
      await prisma.match.update({ where: { id: m.id }, data: { status: 'COMPLETED', winner_id: m.player1_id } });
    }
    await runLiechtensteinPairingTick(app, tournamentId);
  }
  throw new Error('group phase did not converge');
}

async function opponentSets(tournamentId: string): Promise<Map<string, Set<string>>> {
  const ms = await prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, phase: null, player2_id: { not: null } },
    select: { player1_id: true, player2_id: true, status: true },
  });
  const map = new Map<string, Set<string>>();
  for (const m of ms) {
    if (m.status === 'CANCELLED' || !m.player1_id || !m.player2_id) continue;
    (map.get(m.player1_id) ?? map.set(m.player1_id, new Set()).get(m.player1_id)!).add(m.player2_id);
    (map.get(m.player2_id) ?? map.set(m.player2_id, new Set()).get(m.player2_id)!).add(m.player1_id);
  }
  return map;
}

describe('Liechtenstein ASAP engine', () => {
  it('generates round 1 on the first tick, re-pairs ASAP, and NEVER repeats a pairing', async () => {
    const { id } = await makeTournament({ rounds: 3 });
    const players = await addPlayers(id, 4);

    // First tick = round 1 (2 matches for 4 players, all paired, no byes).
    await runLiechtensteinPairingTick(app, id);
    const r1 = await prisma.match.findMany({ where: { tournament_id: id, deleted_at: null, phase: null } });
    expect(r1.filter((m) => m.status === 'PENDING' && m.player2_id)).toHaveLength(2);
    expect(r1.filter((m) => m.status === 'BYE')).toHaveLength(0);

    await playGroup(id);

    // 4 players × 3 rounds with hard rematch exclusion = a full round-robin: everyone met everyone once.
    const opps = await opponentSets(id);
    for (const pid of players) {
      const set = opps.get(pid);
      expect(set).toBeDefined();
      expect(set!.size).toBe(3); // played each of the other three exactly once
      expect(set!.has(pid)).toBe(false);
    }
  });

  it('generates the optional TOP-N playoff bracket once the group phase completes', async () => {
    const { id } = await makeTournament({ rounds: 3, playoffFormat: 'TOP2' });
    await addPlayers(id, 4);
    await runLiechtensteinPairingTick(app, id);
    await playGroup(id);
    await runLiechtensteinPairingTick(app, id); // done → generate playoffs

    const finals = await prisma.match.count({
      where: { tournament_id: id, deleted_at: null, phase: 'PLAYOFF_FINAL' },
    });
    expect(finals).toBe(1); // TOP2 → a single grand final of the top two

    // Idempotent: another tick must not create a second final.
    await runLiechtensteinPairingTick(app, id);
    const finals2 = await prisma.match.count({ where: { tournament_id: id, deleted_at: null, phase: 'PLAYOFF_FINAL' } });
    expect(finals2).toBe(1);
  });

  it('an ODD field gets byes and never starves a player (staggered completion → PENDING_BYE path)', async () => {
    const { id } = await makeTournament({ rounds: 3 });
    const players = await addPlayers(id, 5); // odd
    await runLiechtensteinPairingTick(app, id);

    // Complete ONE real match at a time + tick — this staggers frees so the odd-one-out is HELD
    // (PENDING_BYE), exercising the reclaim/crystallise path (the live starvation bug).
    for (let i = 0; i < 80; i++) {
      const one = await prisma.match.findFirst({
        where: { tournament_id: id, status: 'PENDING', phase: null, player2_id: { not: null }, deleted_at: null },
        select: { id: true, player1_id: true },
      });
      if (one) {
        await prisma.match.update({ where: { id: one.id }, data: { status: 'COMPLETED', winner_id: one.player1_id } });
        await runLiechtensteinPairingTick(app, id);
        continue;
      }
      // No real match pending — tick to reclaim/crystallise any rest markers, then check convergence.
      await runLiechtensteinPairingTick(app, id);
      const remaining = await prisma.match.count({
        where: { tournament_id: id, deleted_at: null, phase: null, status: { in: ['PENDING', 'PENDING_BYE'] } },
      });
      if (remaining === 0) break;
    }

    // No leftover rest markers, everyone played exactly 3 rounds (no starvation), byes exist, no rematch.
    const leftoverRest = await prisma.match.count({ where: { tournament_id: id, status: 'PENDING_BYE', deleted_at: null } });
    expect(leftoverRest).toBe(0);
    const byes = await prisma.match.count({ where: { tournament_id: id, status: 'BYE', deleted_at: null } });
    expect(byes).toBeGreaterThanOrEqual(1); // odd field → at least one scored bye
    const all = await prisma.match.findMany({
      where: { tournament_id: id, deleted_at: null, phase: null, status: { in: ['COMPLETED', 'BYE'] } },
      select: { player1_id: true, player2_id: true },
    });
    const rounds = new Map<string, number>();
    const opps = new Map<string, string[]>();
    for (const m of all) {
      for (const pid of [m.player1_id, m.player2_id]) if (pid) rounds.set(pid, (rounds.get(pid) ?? 0) + 1);
      if (m.player1_id && m.player2_id) {
        (opps.get(m.player1_id) ?? opps.set(m.player1_id, []).get(m.player1_id)!).push(m.player2_id);
        (opps.get(m.player2_id) ?? opps.set(m.player2_id, []).get(m.player2_id)!).push(m.player1_id);
      }
    }
    for (const pid of players) {
      expect(rounds.get(pid)).toBe(3); // exactly the target — nobody starved, nobody over-played
      const o = opps.get(pid) ?? [];
      expect(new Set(o).size).toBe(o.length); // no repeated opponent (hard rematch exclusion)
    }
  });

  it('re-pairs a NO_CONTEST pair only as an ABSOLUTE last resort — never stranded on byes (the live bug)', async () => {
    // A NO_CONTEST is avoided harder than any rematch, but it is still a COST, not a hard block. So
    // when the field shrinks until the no-contest pair are the only two left owing a round, they are
    // RE-PAIRED (a real game) rather than both stranded on byes — which is the live bug we hit.
    const { id } = await makeTournament({ rounds: 3 });
    const [A, B, C, D] = await addPlayers(id, 4);
    const mk = (round: number, mn: number, p1: string, p2: string, status: string, winner: string | null) =>
      prisma.match.create({ data: { tournament_id: id, round, match_number: mn, player1_id: p1, player2_id: p2, status: status as never, winner_id: winner } });
    await mk(1, 1, A, C, 'COMPLETED', A);
    await mk(1, 2, B, D, 'COMPLETED', B);
    await mk(2, 1, A, B, 'NO_CONTEST', null); // A and B's match was a no-contest
    await mk(2, 2, C, D, 'COMPLETED', C);
    await prisma.tournamentParticipant.updateMany({ where: { tournament_id: id, user_id: { in: [C, D] } }, data: { status: 'WITHDREW' } });

    await runLiechtensteinPairingTick(app, id);

    const r3 = await prisma.match.findMany({ where: { tournament_id: id, round: { gte: 3 }, deleted_at: null, phase: null }, select: { player1_id: true, player2_id: true, status: true } });
    const abPair = r3.find((m) => m.player2_id && [m.player1_id, m.player2_id].every((x) => x === A || x === B));
    expect(abPair).toBeDefined(); // last resort: the pair play, not stranded
    const byes = await prisma.match.count({ where: { tournament_id: id, status: 'BYE', round: { gte: 3 }, deleted_at: null } });
    expect(byes).toBe(0);
  });

  it('after a NO_CONTEST, each player is re-paired against a DIFFERENT valid opponent (large field)', async () => {
    // The no-contest only excludes the two from each other — both must still be paired against
    // other, not-yet-played opponents in the next round (never stranded when partners exist).
    const { id } = await makeTournament({ rounds: 3 });
    const [A, B, C, D, E, F] = await addPlayers(id, 6);
    const mk = (round: number, mn: number, p1: string, p2: string, status: string, winner: string | null) =>
      prisma.match.create({ data: { tournament_id: id, round, match_number: mn, player1_id: p1, player2_id: p2, status: status as never, winner_id: winner } });
    // R1: A>B, C>D, E>F.
    await mk(1, 1, A, B, 'COMPLETED', A);
    await mk(1, 2, C, D, 'COMPLETED', C);
    await mk(1, 3, E, F, 'COMPLETED', E);
    // R2: A~C (NO_CONTEST), B-F, D-E — no rematches.
    await mk(2, 1, A, C, 'NO_CONTEST', null);
    await mk(2, 2, B, F, 'COMPLETED', B);
    await mk(2, 3, D, E, 'COMPLETED', D);

    await runLiechtensteinPairingTick(app, id);

    const r3 = await prisma.match.findMany({ where: { tournament_id: id, round: { gte: 3 }, deleted_at: null, phase: null }, select: { player1_id: true, player2_id: true, status: true } });
    const opponentOf = (x: string) => r3.filter((m) => m.player2_id && (m.player1_id === x || m.player2_id === x)).map((m) => (m.player1_id === x ? m.player2_id : m.player1_id));
    // A and C are each paired (not byed) against a real, different opponent — never each other.
    expect(opponentOf(A).length).toBe(1);
    expect(opponentOf(C).length).toBe(1);
    expect(opponentOf(A)).not.toContain(C);
    expect(opponentOf(C)).not.toContain(A);
  });

  it('admits a mid-tournament late joiner with catch-up byes, then pairs them in', async () => {
    const { id } = await makeTournament({ rounds: 3 });
    await addPlayers(id, 4);
    await runLiechtensteinPairingTick(app, id); // round 1

    // Complete round 1 so the field is at the frontier (round 2), then a 5th player joins late.
    const r1 = await prisma.match.findMany({ where: { tournament_id: id, status: 'PENDING', phase: null, deleted_at: null }, select: { id: true, player1_id: true } });
    for (const m of r1) await prisma.match.update({ where: { id: m.id }, data: { status: 'COMPLETED', winner_id: m.player1_id } });

    const late = await createTestUser({ username: `li-late-${id.slice(0, 4)}` });
    createdUserIds.push(late.id);
    await prisma.tournamentParticipant.create({ data: { tournament_id: id, user_id: late.id, status: 'CHECKED_IN', late_joined: true } });

    await admitLiechtensteinLateJoiner(app, id, late.id);

    // They received a 0-point catch-up bye for the passed round...
    const catchup = await prisma.match.count({ where: { tournament_id: id, player1_id: late.id, status: 'CATCHUP_BYE' } });
    expect(catchup).toBeGreaterThanOrEqual(1);
    // ...and were then slotted into the frontier — either a real pairing or (odd field) a scoring bye,
    // i.e. they now have at least one match BEYOND the catch-up placeholders.
    const total = await prisma.match.count({
      where: { tournament_id: id, deleted_at: null, status: { not: 'CANCELLED' }, OR: [{ player1_id: late.id }, { player2_id: late.id }] },
    });
    expect(total).toBeGreaterThan(catchup);
  });
});
