// ---------------------------------------------------------------------------
// Auto Swiss Service
// Handles automated tournament lifecycle for AUTO_SWISS format:
//   startAutoSwiss()             — configure + generate round 1 at start_date
//   advanceAutoSwissRound()      — advance Swiss rounds; start playoffs when done
//   repairBrokenAutoSwiss()      — startup heal: fix tournaments stuck due to
//                                  wrong format being saved at creation time
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@rizzotto/db';
import {
  generateSwissRound,
  computeSwissStandings,
  sortSwissStandings,
} from './swiss.js';
import { notifyRoundPairings, notifyMatchesCreated } from './discord-notify.js';

// ---------------------------------------------------------------------------
// Config: derive rounds + playoff format from check-in count
// ---------------------------------------------------------------------------

export function autoSwissConfig(checkInCount: number): {
  rounds: number;
  playoffFormat: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
} | null {
  if (checkInCount >= 16) return { rounds: 4, playoffFormat: 'TOP8' };
  if (checkInCount >= 8)  return { rounds: 5, playoffFormat: 'TOP4' };
  if (checkInCount >= 4)  return { rounds: 3, playoffFormat: 'TOP2' };
  return null;
}

// ---------------------------------------------------------------------------
// startAutoSwiss — called by cron at start_date
// ---------------------------------------------------------------------------

export async function startAutoSwiss(prisma: PrismaClient, tournamentId: string): Promise<void> {
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournamentId, status: 'CHECKED_IN', deleted_at: null },
    select: { user_id: true, faction_id: true },
  });

  const config = autoSwissConfig(participants.length);
  if (!config) {
    // Not enough players — log and leave in REGISTRATION_CLOSED (host handles it)
    await prisma.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: tournamentId,
        action: 'auto_swiss_insufficient_players',
        new_value: { count: participants.length, required: 4 },
      },
    });
    return;
  }

  const factionById = new Map(participants.map((p) => [p.user_id, p.faction_id ?? null]));
  const participantIds = participants.map((p) => p.user_id);

  const swissPlayers = participantIds.map((userId) => ({
    userId,
    score: 0,
    avoid: [] as string[],
    receivedBye: false,
    factionId: factionById.get(userId) ?? null,
  }));

  const round1Matches = generateSwissRound(tournamentId, swissPlayers, 1);

  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        status: 'ONGOING',
        rounds_count: config.rounds,
        playoff_format: config.playoffFormat,
        swiss_match_format: 'BO1',
        playoff_match_format: 'BO1',
        finale_match_format: 'BO1',
      },
    });

    await tx.match.createMany({
      data: round1Matches.map((m) => ({
        id: m.id,
        tournament_id: m.tournament_id,
        round: m.round,
        match_number: m.match_number,
        player1_id: m.player1_id,
        player2_id: m.player2_id,
        status: m.status as 'PENDING' | 'ONGOING' | 'COMPLETED' | 'BYE',
        winner_id: m.winner_id,
        phase: 'SWISS' as const,
      })),
    });

    await tx.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: tournamentId,
        action: 'auto_swiss_start',
        new_value: { participants: participants.length, rounds: config.rounds, playoff: config.playoffFormat },
      },
    });
  });

  // B22: notify round-1 pairings for Auto Swiss too.
  await notifyMatchesCreated(tournamentId, 1, round1Matches);
}

// ---------------------------------------------------------------------------
// advanceAutoSwissRound — called by cron every minute
// ---------------------------------------------------------------------------

export async function advanceAutoSwissRound(prisma: PrismaClient, tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true, name: true, slug: true, start_date: true,
      rounds_count: true, playoff_format: true, has_third_place_match: true,
    },
  });
  if (!tournament?.rounds_count) return;

  const allMatches = await prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { id: true, round: true, phase: true, status: true, player1_id: true, player2_id: true, winner_id: true, match_number: true },
  });

  const swissMatches = allMatches.filter((m) => m.phase === 'SWISS');
  if (swissMatches.length === 0) return;

  const maxSwissRound = Math.max(...swissMatches.map((m) => m.round));
  const currentRoundMatches = swissMatches.filter((m) => m.round === maxSwissRound);
  const incompleteSwiss = currentRoundMatches.filter((m) => m.status !== 'COMPLETED' && m.status !== 'BYE' && m.status !== 'FORFEIT' && m.status !== 'CANCELLED' && m.status !== 'NO_CONTEST');

  if (incompleteSwiss.length > 0) return; // current round not done

  const playoffMatches = allMatches.filter((m) => m.phase?.startsWith('PLAYOFF'));

  // If playoffs already started → check completion
  if (playoffMatches.length > 0) {
    const pendingPlayoffs = playoffMatches.filter((m) => m.status !== 'COMPLETED' && m.status !== 'BYE');
    if (pendingPlayoffs.length === 0) {
      await prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED' } });
    }
    return;
  }

  // More Swiss rounds to play
  if (maxSwissRound < tournament.rounds_count) {
    await generateNextSwissRound(prisma, tournament, swissMatches, maxSwissRound + 1);
    return;
  }

  // Swiss done — start playoffs
  await startPlayoffs(prisma, tournament, swissMatches, maxSwissRound);
}

// ---------------------------------------------------------------------------
// Internal: generate next Swiss round
// ---------------------------------------------------------------------------

async function generateNextSwissRound(
  prisma: PrismaClient,
  tournament: { id: string; name: string; slug: string; start_date: Date },
  swissMatches: { id: string; round: number; phase: string | null; status: string; player1_id: string | null; player2_id: string | null; winner_id: string | null; match_number: number }[],
  targetRound: number,
): Promise<void> {
  const matchPlayerIds = swissMatches.flatMap((m) =>
    [m.player1_id, m.player2_id].filter((id): id is string => id !== null),
  );

  // Source the player set from TournamentParticipant — not only from existing
  // match rows — so a player checked in after round 1 (late joiner) is folded
  // into pairing. CHECKED_IN + WITHDREW is the active set; anyone already in a
  // match row is unioned in to preserve their faction/status. REGISTERED is
  // excluded: in Auto Swiss only CHECKED_IN players were ever in the bracket.
  const dbParticipants = await prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournament.id,
      deleted_at: null,
      OR: [
        { status: { in: ['CHECKED_IN', 'WITHDREW'] } },
        { user_id: { in: matchPlayerIds } },
      ],
    },
    select: { user_id: true, faction_id: true, status: true },
  });
  const participantIds = dbParticipants.map((p) => p.user_id);
  const factionById = new Map(dbParticipants.map((p) => [p.user_id, p.faction_id ?? null]));
  const withdrawnIds = new Set(dbParticipants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));

  const completed = swissMatches
    .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST')
    .map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id, status: m.status }));

  const rawStandings = computeSwissStandings(participantIds, completed, withdrawnIds);
  const standings = sortSwissStandings(rawStandings, completed);

  const avoidMap = new Map<string, string[]>(participantIds.map((id) => [id, []]));
  const byeMap = new Map<string, boolean>();
  const noContestMap = new Map<string, string[]>(participantIds.map((id) => [id, []]));
  for (const m of swissMatches) {
    if (m.player1_id && m.player2_id) {
      avoidMap.get(m.player1_id)?.push(m.player2_id);
      avoidMap.get(m.player2_id)?.push(m.player1_id);
      if (m.status === 'NO_CONTEST') {
        noContestMap.get(m.player1_id)?.push(m.player2_id);
        noContestMap.get(m.player2_id)?.push(m.player1_id);
      }
    }
    if (m.status === 'BYE') {
      const byePlayer = m.player1_id ?? m.player2_id;
      if (byePlayer) byeMap.set(byePlayer, true);
    }
  }

  const swissPlayers = standings.filter((s) => !s.dropped).map((s) => ({
    userId: s.userId,
    score: s.score,
    avoid: avoidMap.get(s.userId) ?? [],
    receivedBye: byeMap.get(s.userId) ?? false,
    factionId: factionById.get(s.userId) ?? null,
    noContestAvoid: noContestMap.get(s.userId) ?? [],
  }));

  const newMatches = generateSwissRound(tournament.id, swissPlayers, targetRound);

  await prisma.$transaction(async (tx) => {
    await tx.match.createMany({
      data: newMatches.map((m) => ({
        id: m.id,
        tournament_id: m.tournament_id,
        round: m.round,
        match_number: m.match_number,
        player1_id: m.player1_id,
        player2_id: m.player2_id,
        status: m.status as 'PENDING' | 'ONGOING' | 'COMPLETED' | 'BYE',
        winner_id: m.winner_id,
        phase: 'SWISS' as const,
      })),
    });
    await tx.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: tournament.id,
        action: 'auto_swiss_next_round',
        new_value: { round: targetRound, matches: newMatches.length },
      },
    });
  });

  // Notify pairings — non-fatal
  try {
    const pairings = (await Promise.all(
      newMatches
        .filter((m) => m.player1_id && m.player2_id)
        .map(async (m) => {
          const [p1, p2] = await Promise.all([
            prisma.user.findUnique({ where: { id: m.player1_id! }, select: { username: true, discord_id: true } }),
            prisma.user.findUnique({ where: { id: m.player2_id! }, select: { username: true, discord_id: true } }),
          ]);
          if (!p1?.discord_id || !p2?.discord_id) return null;
          return { matchId: m.id, player1: { discord_id: p1.discord_id, username: p1.username }, player2: { discord_id: p2.discord_id, username: p2.username }, round: targetRound, map: null };
        }),
    )).filter((p): p is NonNullable<typeof p> => p !== null);

    if (pairings.length > 0) {
      await notifyRoundPairings(
        { id: tournament.id, name: tournament.name, slug: tournament.slug, start_date: tournament.start_date },
        targetRound,
        pairings,
      );
    }
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Internal: start playoffs — generate all rounds upfront with next_match_id
// linking so completeMatch() handles winner advancement automatically.
// ---------------------------------------------------------------------------

async function startPlayoffs(
  prisma: PrismaClient,
  tournament: { id: string; rounds_count: number | null; playoff_format: string | null; has_third_place_match: boolean },
  swissMatches: { player1_id: string | null; player2_id: string | null; winner_id: string | null; status: string; round: number }[],
  swissRoundCount: number,
): Promise<void> {
  const playoffRound = swissRoundCount + 1;

  const participantIds = [...new Set(
    swissMatches.flatMap((m) => [m.player1_id, m.player2_id].filter((id): id is string => id !== null)),
  )];
  const dbParticipants = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournament.id, user_id: { in: participantIds }, deleted_at: null },
    select: { user_id: true, status: true },
  });
  const withdrawnIds = new Set(dbParticipants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));
  const completed = swissMatches
    .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST')
    .map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id, status: m.status }));
  const rawStandings = computeSwissStandings(participantIds, completed, withdrawnIds);
  const standings = sortSwissStandings(rawStandings, completed);
  const ranked = standings.filter((s) => !s.dropped).map((s) => s.userId);

  // Re-evaluate playoff format based on active player count at Swiss end.
  // Players may have dropped during the Swiss phase, so the start-time config
  // (stored in tournament.playoff_format) may no longer be appropriate.
  const effectiveConfig = autoSwissConfig(ranked.length);
  if (effectiveConfig && effectiveConfig.playoffFormat !== tournament.playoff_format) {
    await prisma.tournament.update({ where: { id: tournament.id }, data: { playoff_format: effectiveConfig.playoffFormat } });
  }
  const fmt = effectiveConfig?.playoffFormat ?? tournament.playoff_format;

  type PlayoffPhase = 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL' | 'PLAYOFF_THIRD_PLACE';
  const matches: {
    id: string; tournament_id: string; round: number; match_number: number;
    player1_id: string | null; player2_id: string | null; status: 'PENDING';
    phase: PlayoffPhase; next_match_id: string | null; loser_next_match_id: string | null;
  }[] = [];

  if (fmt === 'TOP2') {
    // Direct GF (1v2) + optional 3rd place (3v4)
    const gfId = randomUUID();
    matches.push({
      id: gfId, tournament_id: tournament.id, round: playoffRound, match_number: 1,
      player1_id: ranked[0] ?? null, player2_id: ranked[1] ?? null,
      status: 'PENDING', phase: 'PLAYOFF_FINAL', next_match_id: null, loser_next_match_id: null,
    });
    if (ranked[2] && ranked[3]) {
      matches.push({
        id: randomUUID(), tournament_id: tournament.id, round: playoffRound, match_number: 2,
        player1_id: ranked[2], player2_id: ranked[3],
        status: 'PENDING', phase: 'PLAYOFF_THIRD_PLACE', next_match_id: null, loser_next_match_id: null,
      });
    }
  } else if (fmt === 'TOP4') {
    // SF (round N), GF + 3rd place (round N+1)
    const gfId = randomUUID();
    const thirdId = randomUUID();
    const sf1Id = randomUUID();
    const sf2Id = randomUUID();

    matches.push(
      { id: sf1Id, tournament_id: tournament.id, round: playoffRound, match_number: 1,
        player1_id: ranked[0] ?? null, player2_id: ranked[3] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_SF', next_match_id: gfId, loser_next_match_id: thirdId },
      { id: sf2Id, tournament_id: tournament.id, round: playoffRound, match_number: 2,
        player1_id: ranked[1] ?? null, player2_id: ranked[2] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_SF', next_match_id: gfId, loser_next_match_id: thirdId },
      { id: gfId, tournament_id: tournament.id, round: playoffRound + 1, match_number: 1,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_FINAL', next_match_id: null, loser_next_match_id: null },
      { id: thirdId, tournament_id: tournament.id, round: playoffRound + 1, match_number: 2,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_THIRD_PLACE', next_match_id: null, loser_next_match_id: null },
    );
  } else if (fmt === 'TOP8') {
    // QF (round N), SF (round N+1), GF + 3rd (round N+2)
    const gfId = randomUUID();
    const thirdId = randomUUID();
    const sf1Id = randomUUID();
    const sf2Id = randomUUID();
    const qf1Id = randomUUID();
    const qf2Id = randomUUID();
    const qf3Id = randomUUID();
    const qf4Id = randomUUID();

    matches.push(
      { id: qf1Id, tournament_id: tournament.id, round: playoffRound, match_number: 1,
        player1_id: ranked[0] ?? null, player2_id: ranked[7] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_QF', next_match_id: sf1Id, loser_next_match_id: null },
      { id: qf2Id, tournament_id: tournament.id, round: playoffRound, match_number: 2,
        player1_id: ranked[3] ?? null, player2_id: ranked[4] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_QF', next_match_id: sf1Id, loser_next_match_id: null },
      { id: qf3Id, tournament_id: tournament.id, round: playoffRound, match_number: 3,
        player1_id: ranked[1] ?? null, player2_id: ranked[6] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_QF', next_match_id: sf2Id, loser_next_match_id: null },
      { id: qf4Id, tournament_id: tournament.id, round: playoffRound, match_number: 4,
        player1_id: ranked[2] ?? null, player2_id: ranked[5] ?? null,
        status: 'PENDING', phase: 'PLAYOFF_QF', next_match_id: sf2Id, loser_next_match_id: null },
      { id: sf1Id, tournament_id: tournament.id, round: playoffRound + 1, match_number: 1,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_SF', next_match_id: gfId, loser_next_match_id: thirdId },
      { id: sf2Id, tournament_id: tournament.id, round: playoffRound + 1, match_number: 2,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_SF', next_match_id: gfId, loser_next_match_id: thirdId },
      { id: gfId, tournament_id: tournament.id, round: playoffRound + 2, match_number: 1,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_FINAL', next_match_id: null, loser_next_match_id: null },
      { id: thirdId, tournament_id: tournament.id, round: playoffRound + 2, match_number: 2,
        player1_id: null, player2_id: null,
        status: 'PENDING', phase: 'PLAYOFF_THIRD_PLACE', next_match_id: null, loser_next_match_id: null },
    );
  }

  if (matches.length === 0) {
    await prisma.tournament.update({ where: { id: tournament.id }, data: { status: 'COMPLETED' } });
    return;
  }

  await prisma.match.createMany({ data: matches });
  await prisma.auditLog.create({
    data: {
      entity_type: 'Tournament',
      entity_id: tournament.id,
      action: 'auto_swiss_start_playoffs',
      new_value: { format: fmt, matches: matches.length },
    },
  });

  // B22: notify the first playoff round's participants.
  const playablePO = matches.filter((m) => m.player1_id && m.player2_id);
  if (playablePO.length > 0) {
    await notifyMatchesCreated(tournament.id, Math.min(...playablePO.map((m) => m.round)), playablePO);
  }
}

// ---------------------------------------------------------------------------
// repairBrokenAutoSwiss — called once at server startup
// Detects ONGOING tournaments where Swiss rounds completed but playoffs were
// never generated because the format was saved incorrectly (e.g. as
// SINGLE_ELIMINATION). Safe to run repeatedly: skips any tournament that
// already has playoff matches.
// ---------------------------------------------------------------------------

export async function repairBrokenAutoSwiss(prisma: PrismaClient): Promise<void> {
  // Candidates: ONGOING with rounds_count set, not already AUTO_SWISS
  const candidates = await prisma.tournament.findMany({
    where: {
      status: 'ONGOING',
      format: { not: 'AUTO_SWISS' },
      deleted_at: null,
    },
    select: { id: true, slug: true, format: true, rounds_count: true },
  });

  for (const t of candidates) {
    const matches = await prisma.match.findMany({
      where: { tournament_id: t.id, deleted_at: null },
      select: { id: true, phase: true, status: true, round: true },
    });

    if (matches.length === 0) continue;
    if (!t.rounds_count) continue;

    // Skip if playoffs already exist
    const hasPlayoffs = matches.some((m) => m.phase?.startsWith('PLAYOFF'));
    if (hasPlayoffs) continue;

    // Only repair if all matches are done (Swiss rounds complete, including forfeit wins)
    const pending = matches.filter((m) => m.status !== 'COMPLETED' && m.status !== 'BYE' && m.status !== 'FORFEIT' && m.status !== 'NO_CONTEST');
    if (pending.length > 0) continue;

    // All matches done, no playoffs — this is a stuck tournament
    const maxSwissRound = Math.max(...matches.map((m) => m.round));

    // Derive playoff format from checked-in participant count
    const checkInCount = await prisma.tournamentParticipant.count({
      where: { tournament_id: t.id, status: 'CHECKED_IN', deleted_at: null },
    });
    const config = autoSwissConfig(checkInCount);
    if (!config) continue;

    // Fix match phases: null → SWISS
    await prisma.match.updateMany({
      where: { tournament_id: t.id, deleted_at: null, phase: null },
      data: { phase: 'SWISS' },
    });

    // Fix tournament fields
    await prisma.tournament.update({
      where: { id: t.id },
      data: {
        format: 'AUTO_SWISS',
        playoff_format: config.playoffFormat,
        rounds_count: maxSwissRound,
      },
    });

    await prisma.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: t.id,
        action: 'auto_swiss_startup_repair',
        new_value: { previousFormat: t.format, playoffFormat: config.playoffFormat, swissRounds: maxSwissRound },
      },
    });

    // Now let advanceAutoSwissRound generate the playoffs
    await advanceAutoSwissRound(prisma, t.id);
  }
}
