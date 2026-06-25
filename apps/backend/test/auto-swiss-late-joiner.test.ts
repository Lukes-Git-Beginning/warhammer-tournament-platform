/**
 * Late-joiner regression tests (2026-06-25).
 *
 * Bug: a player checked in AFTER an Auto-Swiss bracket was generated got no BYE
 * in the running round and was ignored by the next round's pairing — because
 * generateNextSwissRound() derived its player set from existing match rows
 * instead of TournamentParticipant.
 *
 * Fix:
 *   A) advanceAutoSwissRound → generateNextSwissRound sources players from
 *      TournamentParticipant (CHECKED_IN / WITHDREW), so a late joiner with no
 *      match row is folded into the next round.
 *   B) createLateJoinerBye() gives a late joiner a BYE in the current Swiss
 *      round, so they appear immediately and are not byed twice.
 *
 * These are integration tests against the real test DB (hermetic fixtures).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';
import type { TestUser } from './helpers/db-fixtures.js';

// No real Discord HTTP — generateNextSwissRound notifies pairings.
vi.mock('../src/lib/discord-notify.js', () => ({
  notifyCheckInReminder: vi.fn().mockResolvedValue(undefined),
  notifyRoundPairings: vi.fn().mockResolvedValue(undefined),
  notifyDispute: vi.fn().mockResolvedValue(undefined),
  notifyTournamentAnnounce: vi.fn().mockResolvedValue(undefined),
}));

import { advanceAutoSwissRound } from '../src/lib/auto-swiss-service.js';
import { createLateJoinerBye } from '../src/lib/tournament-utils.js';

let organizer: TestUser;
let players: TestUser[] = [];
let tournamentId = '';
let createdUserIds: string[] = [];

async function makeTournament(
  opts: { format?: 'AUTO_SWISS' | 'SWISS' | 'SINGLE_ELIMINATION'; roundsCount?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.tournament.create({
    data: {
      id,
      slug: `late-joiner-${id}`,
      name: `Late Joiner Test ${id.slice(0, 8)}`,
      organizer_id: organizer.id,
      format: opts.format ?? 'AUTO_SWISS',
      mode: 'BPT',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
      rounds_count: opts.roundsCount ?? 5,
      playoff_format: 'TOP4',
    },
  });
  return id;
}

async function addParticipant(
  tId: string,
  userId: string,
  status: 'CHECKED_IN' | 'REGISTERED' | 'WITHDREW' = 'CHECKED_IN',
): Promise<void> {
  await prisma.tournamentParticipant.create({
    data: { tournament_id: tId, user_id: userId, status },
  });
}

async function addSwissMatch(
  tId: string,
  round: number,
  matchNumber: number,
  p1: string | null,
  p2: string | null,
  opts: { status: 'COMPLETED' | 'BYE' | 'PENDING'; winner?: string | null },
): Promise<void> {
  await prisma.match.create({
    data: {
      tournament_id: tId,
      round,
      match_number: matchNumber,
      player1_id: p1,
      player2_id: p2,
      winner_id: opts.winner ?? null,
      status: opts.status,
      phase: 'SWISS',
    },
  });
}

/** Round 1: 4 completed matches among players[0..7]; players[8] is the late joiner. */
async function seedRoundOne(tId: string): Promise<void> {
  const o = players;
  await addSwissMatch(tId, 1, 1, o[0]!.id, o[1]!.id, { status: 'COMPLETED', winner: o[0]!.id });
  await addSwissMatch(tId, 1, 2, o[2]!.id, o[3]!.id, { status: 'COMPLETED', winner: o[2]!.id });
  await addSwissMatch(tId, 1, 3, o[4]!.id, o[5]!.id, { status: 'COMPLETED', winner: o[4]!.id });
  await addSwissMatch(tId, 1, 4, o[6]!.id, o[7]!.id, { status: 'COMPLETED', winner: o[6]!.id });
}

beforeEach(async () => {
  organizer = await createTestUser({ username: 'lj-organizer' });
  players = [];
  for (let i = 0; i < 9; i++) {
    players.push(await createTestUser({ username: `lj-player-${i}` }));
  }
  createdUserIds = [organizer.id, ...players.map((p) => p.id)];
  tournamentId = '';
});

afterEach(async () => {
  if (tournamentId) await cleanupTournament(tournamentId);
  await cleanupUsers(createdUserIds);
});

describe('Auto Swiss — late joiner pairing (Schritt A)', () => {
  it('includes a late joiner (no match row) in the next generated round', async () => {
    tournamentId = await makeTournament({ format: 'AUTO_SWISS', roundsCount: 5 });
    const late = players[8]!;
    for (const p of players) await addParticipant(tournamentId, p.id, 'CHECKED_IN'); // all 9 checked in
    await seedRoundOne(tournamentId); // late joiner has no round-1 match

    await advanceAutoSwissRound(prisma, tournamentId);

    const round2 = await prisma.match.findMany({
      where: { tournament_id: tournamentId, round: 2, phase: 'SWISS' },
    });
    expect(round2.length).toBeGreaterThan(0);

    const placed = new Set(
      round2.flatMap((m) => [m.player1_id, m.player2_id].filter((x): x is string => x !== null)),
    );
    expect(placed.has(late.id)).toBe(true); // late joiner is no longer ignored
    expect(placed.size).toBe(9); // all 9 players placed in round 2
  });

  it('does not pair a never-checked-in (REGISTERED) participant', async () => {
    tournamentId = await makeTournament({ format: 'AUTO_SWISS', roundsCount: 5 });
    const ghost = players[8]!;
    for (const p of players.slice(0, 8)) await addParticipant(tournamentId, p.id, 'CHECKED_IN');
    await addParticipant(tournamentId, ghost.id, 'REGISTERED'); // registered but never checked in
    await seedRoundOne(tournamentId);

    await advanceAutoSwissRound(prisma, tournamentId);

    const round2 = await prisma.match.findMany({
      where: { tournament_id: tournamentId, round: 2, phase: 'SWISS' },
    });
    const placed = new Set(
      round2.flatMap((m) => [m.player1_id, m.player2_id].filter((x): x is string => x !== null)),
    );
    expect(placed.has(ghost.id)).toBe(false);
    expect(placed.size).toBe(8);
  });
});

describe('createLateJoinerBye (Schritt B)', () => {
  it('gives a late joiner a BYE in the current round, then they are paired next round', async () => {
    tournamentId = await makeTournament({ format: 'AUTO_SWISS', roundsCount: 5 });
    const late = players[8]!;
    for (const p of players) await addParticipant(tournamentId, p.id, 'CHECKED_IN');
    await seedRoundOne(tournamentId);

    const bye = await createLateJoinerBye(prisma, tournamentId, late.id);
    expect(bye).not.toBeNull();
    expect(bye!.round).toBe(1);

    const r1bye = await prisma.match.findFirst({
      where: { tournament_id: tournamentId, round: 1, status: 'BYE', player1_id: late.id },
    });
    expect(r1bye).not.toBeNull();
    expect(r1bye!.player2_id).toBeNull();
    expect(r1bye!.winner_id).toBe(late.id);
    expect(r1bye!.phase).toBe('SWISS');

    // Advancing must not bye the same player twice — they get a real opponent.
    await advanceAutoSwissRound(prisma, tournamentId);
    const round2 = await prisma.match.findMany({
      where: { tournament_id: tournamentId, round: 2, phase: 'SWISS' },
    });
    const lateMatch = round2.find((m) => m.player1_id === late.id || m.player2_id === late.id);
    expect(lateMatch).toBeDefined();
    expect(lateMatch!.status).not.toBe('BYE');
    expect(lateMatch!.player1_id && lateMatch!.player2_id).toBeTruthy();
  });

  it('is idempotent — returns null if the player already has a match this round', async () => {
    tournamentId = await makeTournament({ format: 'AUTO_SWISS', roundsCount: 5 });
    const late = players[8]!;
    await addParticipant(tournamentId, late.id, 'CHECKED_IN');
    await seedRoundOne(tournamentId);

    expect(await createLateJoinerBye(prisma, tournamentId, late.id)).not.toBeNull();
    expect(await createLateJoinerBye(prisma, tournamentId, late.id)).toBeNull();
  });

  it('is a no-op for non-Swiss formats', async () => {
    tournamentId = await makeTournament({ format: 'SINGLE_ELIMINATION', roundsCount: 1 });
    const late = players[8]!;
    await addParticipant(tournamentId, late.id, 'CHECKED_IN');
    expect(await createLateJoinerBye(prisma, tournamentId, late.id)).toBeNull();
  });

  it('is a no-op when no Swiss round exists yet', async () => {
    tournamentId = await makeTournament({ format: 'AUTO_SWISS', roundsCount: 5 });
    const late = players[8]!;
    await addParticipant(tournamentId, late.id, 'CHECKED_IN');
    expect(await createLateJoinerBye(prisma, tournamentId, late.id)).toBeNull();
  });
});
