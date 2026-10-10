/**
 * Swiss bye reconciler regression tests (2026-09-27).
 *
 * Bug (live on enticity-presents-the-entry-level-sft-free-dlc-keys-3): a player who entered a round
 * mid-flight (late join, returned from a drop) or was orphaned by a mid-round drop was left idle next
 * to a bye-holder instead of being paired against them, so two players who could have played each
 * other both sat out. Rather than bolt a bye-fill onto every stranding path, a single periodic
 * reconciler (mirroring the Balanced Liechtenstein reconciler) pairs idle players each tick.
 *
 * These call reconcileSwissByes() directly against the real test DB (hermetic fixtures).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { reconcileSwissByes, SWISS_LATE_JOIN_PAIRING_WINDOW_MS } from '../src/lib/tournament-utils.js';
import { createTestUser, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';
import type { TestUser } from './helpers/db-fixtures.js';

let host: TestUser;
let players: TestUser[] = [];
let tournamentId = '';
let createdUserIds: string[] = [];

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSwiss(format: 'SWISS' | 'AUTO_SWISS' = 'SWISS'): Promise<void> {
  const id = randomUUID();
  await prisma.tournament.create({
    data: {
      id,
      slug: `swiss-recon-${id.slice(0, 8)}`,
      name: `Swiss Recon ${id.slice(0, 8)}`,
      host_id: host.id,
      format,
      mode: 'SFT',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      rounds_count: 6,
    },
  });
  tournamentId = id;
}

async function addParticipant(userId: string, status: 'CHECKED_IN' | 'REGISTERED' | 'WITHDREW' = 'CHECKED_IN'): Promise<void> {
  await prisma.tournamentParticipant.create({ data: { tournament_id: tournamentId, user_id: userId, status } });
}

async function addMatch(
  round: number,
  matchNumber: number,
  p1: string | null,
  p2: string | null,
  status: 'PENDING' | 'COMPLETED' | 'BYE' | 'CATCHUP_BYE' | 'CANCELLED',
  opts: { winner?: string | null; withdrawn?: string | null } = {},
): Promise<{ id: string }> {
  return prisma.match.create({
    data: {
      tournament_id: tournamentId,
      round,
      match_number: matchNumber,
      player1_id: p1,
      player2_id: p2,
      winner_id: opts.winner ?? null,
      withdrawn_player_id: opts.withdrawn ?? null,
      status,
      phase: 'SWISS',
    },
    select: { id: true },
  });
}

beforeEach(async () => {
  host = await createTestUser({ username: 'recon-host' });
  players = [];
  for (let i = 0; i < 6; i++) players.push(await createTestUser({ username: `recon-p${i}` }));
  createdUserIds = [host.id, ...players.map((p) => p.id)];
  tournamentId = '';
});

afterEach(async () => {
  if (tournamentId) await cleanupTournament(tournamentId);
  await cleanupUsers(createdUserIds);
});

describe('reconcileSwissByes — pair stranded players against a bye-holder', () => {
  it('pairs a stranded late joiner (no row) with the bye-holder (R2 / R3)', async () => {
    await makeSwiss();
    const [x, y, a, b] = players; // x sits on the bye, a/b played, y is checked in but unpaired
    for (const p of [x, a, b, y]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'PENDING'); // early in the round: nothing finished yet
    const bye = await addMatch(1, 2, x.id, null, 'BYE', { winner: x.id });

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);

    const filled = await prisma.match.findUnique({ where: { id: bye.id } });
    expect(filled!.status).toBe('PENDING');
    expect([filled!.player1_id, filled!.player2_id].sort()).toEqual([x.id, y.id].sort());
    expect(filled!.winner_id).toBeNull(); // the free bye-win is gone
  });

  it('reroutes a survivor orphaned by a mid-round drop onto the bye (R4)', async () => {
    await makeSwiss();
    const [dropper, survivor, z] = players;
    await addParticipant(dropper.id, 'WITHDREW');
    await addParticipant(survivor.id, 'CHECKED_IN');
    await addParticipant(z.id, 'CHECKED_IN');
    const orphan = await addMatch(1, 1, dropper.id, survivor.id, 'PENDING', { withdrawn: dropper.id });
    const bye = await addMatch(1, 2, z.id, null, 'BYE', { winner: z.id });

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);

    const filled = await prisma.match.findUnique({ where: { id: bye.id } });
    expect(filled!.status).toBe('PENDING');
    expect([filled!.player1_id, filled!.player2_id].sort()).toEqual([z.id, survivor.id].sort());

    const orphanRow = await prisma.match.findUnique({ where: { id: orphan.id } });
    expect(orphanRow!.status).toBe('CANCELLED'); // the dead match is retired
  });

  it('pairs two idle bye-holders early in the round (fills one bye, removes the other row)', async () => {
    await makeSwiss();
    const [x, w, a, b] = players;
    for (const p of [x, w, a, b]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'PENDING');
    const bye = await addMatch(1, 2, x.id, null, 'BYE', { winner: x.id });
    const catchup = await addMatch(1, 3, w.id, null, 'CATCHUP_BYE');

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);

    const filled = await prisma.match.findUnique({ where: { id: bye.id } });
    expect(filled!.status).toBe('PENDING');
    expect([filled!.player1_id, filled!.player2_id].sort()).toEqual([x.id, w.id].sort());
    // The superseded catch-up row is removed (soft-deleted) — a CANCELLED solo row would render as
    // a withdrawn player ("OUT" vs TBD) in the bracket.
    const old = await prisma.match.findUnique({ where: { id: catchup.id } });
    expect(old!.deleted_at).not.toBeNull();
  });

  it('pairs two stranded players with no bye into a fresh match', async () => {
    await makeSwiss();
    const [a, b, c, d, y1, y2] = players;
    for (const p of [a, b, c, d, y1, y2]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'PENDING');
    await addMatch(1, 2, c.id, d.id, 'PENDING');

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);

    const newMatch = await prisma.match.findFirst({
      where: { tournament_id: tournamentId, round: 1, status: 'PENDING', OR: [{ player1_id: y1.id }, { player2_id: y1.id }] },
    });
    expect(newMatch).not.toBeNull();
    expect([newMatch!.player1_id, newMatch!.player2_id].sort()).toEqual([y1.id, y2.id].sort());
  });

  it('leaves a single legitimate bye untouched, and is idempotent', async () => {
    await makeSwiss();
    const [x, y, a, b] = players;
    for (const p of [x, a, b, y]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'PENDING');
    const bye = await addMatch(1, 2, x.id, null, 'BYE', { winner: x.id });

    // First run pairs x (bye) with the stranded y.
    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);
    // Second run: everyone has a live game, exactly zero idle → no-op.
    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(0);
    const filled = await prisma.match.findUnique({ where: { id: bye.id } });
    expect(filled!.status).toBe('PENDING');
  });

  it('removes a stray catch-up bye left on a player who already has a real match (manual-fix residue)', async () => {
    await makeSwiss();
    const [g, dn, a, b] = players; // g was manually paired vs dn but kept a leftover catch-up bye
    for (const p of [g, dn, a, b]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'COMPLETED', { winner: a.id });
    const real = await addMatch(1, 2, g.id, dn.id, 'PENDING');
    const stray = await addMatch(1, 3, g.id, null, 'CATCHUP_BYE');

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);

    const strayRow = await prisma.match.findUnique({ where: { id: stray.id } });
    expect(strayRow!.deleted_at).not.toBeNull();
    const realRow = await prisma.match.findUnique({ where: { id: real.id } });
    expect(realRow!.status).toBe('PENDING'); // the real match is untouched
  });

  it('late in the round (a game already finished): a late joiner keeps the catch-up bye, the bye-holder keeps the bye', async () => {
    await makeSwiss();
    const [x, w, a, b, c, d] = players;
    for (const p of [x, w, a, b, c, d]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'COMPLETED', { winner: a.id });
    await addMatch(1, 2, c.id, d.id, 'PENDING'); // the last game of the round is still running
    const bye = await addMatch(1, 3, x.id, null, 'BYE', { winner: x.id });
    const catchup = await addMatch(1, 4, w.id, null, 'CATCHUP_BYE');

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(0);
    expect((await prisma.match.findUnique({ where: { id: bye.id } }))!.status).toBe('BYE');
    const lateRow = await prisma.match.findUnique({ where: { id: catchup.id } });
    expect(lateRow!.status).toBe('CATCHUP_BYE');
    expect(lateRow!.deleted_at).toBeNull();
  });

  it('late in the round (round older than the window): a late joiner without a row gets a catch-up bye', async () => {
    await makeSwiss();
    const [x, y, a, b] = players;
    for (const p of [x, y, a, b]) await addParticipant(p.id);
    const game = await addMatch(1, 1, a.id, b.id, 'PENDING');
    const bye = await addMatch(1, 2, x.id, null, 'BYE', { winner: x.id });
    const old = new Date(Date.now() - SWISS_LATE_JOIN_PAIRING_WINDOW_MS - 60_000);
    await prisma.match.updateMany({ where: { id: { in: [game.id, bye.id] } }, data: { created_at: old } });

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);
    expect((await prisma.match.findUnique({ where: { id: bye.id } }))!.status).toBe('BYE');
    const yRow = await prisma.match.findFirst({ where: { tournament_id: tournamentId, round: 1, player1_id: y.id } });
    expect(yRow!.status).toBe('CATCHUP_BYE');
    expect(yRow!.player2_id).toBeNull();
    // Idempotent: the next pass leaves everything as is.
    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(0);
  });

  it('a survivor orphaned by a drop is still re-paired late in the round (not a late joiner)', async () => {
    await makeSwiss();
    const [dropper, survivor, z, a, b] = players;
    await addParticipant(dropper.id, 'WITHDREW');
    for (const p of [survivor, z, a, b]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'COMPLETED', { winner: a.id });
    await addMatch(1, 2, dropper.id, survivor.id, 'PENDING', { withdrawn: dropper.id });
    const bye = await addMatch(1, 3, z.id, null, 'BYE', { winner: z.id });

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(1);
    const filled = await prisma.match.findUnique({ where: { id: bye.id } });
    expect([filled!.player1_id, filled!.player2_id].sort()).toEqual([z.id, survivor.id].sort());
  });

  it('no-op when the only idle player is a lone legitimate bye', async () => {
    await makeSwiss();
    const [x, a, b] = players;
    for (const p of [x, a, b]) await addParticipant(p.id);
    await addMatch(1, 1, a.id, b.id, 'PENDING');
    const bye = await addMatch(1, 2, x.id, null, 'BYE', { winner: x.id });

    expect(await reconcileSwissByes(prisma, tournamentId)).toBe(0);
    const row = await prisma.match.findUnique({ where: { id: bye.id } });
    expect(row!.status).toBe('BYE');
  });
});
