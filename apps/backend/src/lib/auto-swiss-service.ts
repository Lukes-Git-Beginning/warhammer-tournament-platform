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
import type { Redis } from 'ioredis';
import { recordTournamentEvent } from './tournament-events.js';
import {
  generateSwissRound,
  computeSwissStandings,
  sortSwissStandings,
} from './swiss.js';
import { resolveFactionWarFairness } from './matchmaking-service.js';
import {
  notifyRoundPairings,
  notifyMatchesCreated,
  notifyBye,
  notifyPlayoffResults,
  notifyNoPlayoffComplete,
  notifyAutoSizeChanged,
} from './discord-notify.js';

// ---------------------------------------------------------------------------
// Config: derive rounds + playoff format from check-in count
// ---------------------------------------------------------------------------

export function autoSwissConfig(checkInCount: number): {
  rounds: number;
  playoffFormat: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
} | null {
  // Rounds are chosen so Swiss + playoff = 7 total, for predictable scheduling:
  //   16+ → 4 Swiss + 3-round Top 8 = 7   ·   8+ → 5 Swiss + 2-round Top 4 = 7   ·   4+ → 3 Swiss + Top 2.
  // The 8+ tier INTENTIONALLY has more Swiss rounds than 16+ (its playoff is shorter, so the
  // total lands on 7 either way) — this is deliberate, do NOT "monotonic-fix" it. Balanced
  // Liechtenstein does NOT use this table for its round count (see balancedRounds): Top 8 almost
  // never applies to it and its playoff size is the host's choice, not tied to the rounds.
  if (checkInCount >= 16) return { rounds: 4, playoffFormat: 'TOP8' };
  if (checkInCount >= 8)  return { rounds: 5, playoffFormat: 'TOP4' };
  if (checkInCount >= 4)  return { rounds: 3, playoffFormat: 'TOP2' };
  return null;
}

/**
 * Balanced Liechtenstein round count. Unlike autoSwissConfig's 7-total scheduling, BaLi sizes
 * purely on field size — Top 8 almost never applies and the playoff size is the host's choice,
 * independent of the round count. 3 rounds under 8 players, 4 from 8 up; a tiny field (<4) gets
 * at most count-1 so nobody is forced into a rematch.
 */
export function balancedRounds(count: number): number {
  if (count >= 8) return 4;
  if (count >= 4) return 3;
  return Math.max(1, count - 1);
}

// ---------------------------------------------------------------------------
// #40: dynamic re-sizing while a tournament is running
// ---------------------------------------------------------------------------

/**
 * Pure sizing given the current active count and the highest round already
 * generated. Never shrinks below the current round (a played round can't be
 * un-generated). Below 4 active players there are no more rounds and no playoffs
 * — the current round finishes the event.
 */
export function computeDynamicSize(
  active: number,
  currentRound: number,
): { rounds: number; playoffFormat: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8' } {
  const config = autoSwissConfig(active);
  return {
    rounds: Math.max(config?.rounds ?? currentRound, currentRound),
    playoffFormat: config?.playoffFormat ?? 'NONE',
  };
}

/**
 * Re-size an auto-sized tournament when its active pool changes mid-event (a drop
 * or a late join). Recomputes rounds_count + playoff_format from the current active
 * count, but never once the playoffs exist. Returns true if anything changed so the
 * caller can emit a bracket update for the live display. The round-end DM is sent
 * separately by the round-advance flow. Applies to Auto Swiss + auto-sized Swiss +
 * auto-sized Balanced Liechtenstein.
 */
export async function reapplyDynamicSizing(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<boolean> {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, auto_sizing: true, rounds_count: true, playoff_format: true },
  });
  if (!t || t.status !== 'ONGOING') return false;
  const eligible =
    t.format === 'AUTO_SWISS' ||
    ((t.format === 'SWISS' || t.format === 'BALANCED_LIECHTENSTEIN') && t.auto_sizing);
  if (!eligible) return false;

  const matches = await prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { round: true, phase: true },
  });
  // Once the playoffs exist we never re-size (a PLAYOFF_* phase, i.e. not null/SWISS).
  if (matches.some((m) => m.phase != null && m.phase !== 'SWISS')) return false;

  const roster = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN'] } },
    select: { status: true },
  });
  const currentRound = matches
    .filter((m) => m.phase == null || m.phase === 'SWISS')
    .reduce((max, m) => Math.max(max, m.round), 0);

  const isBalanced = t.format === 'BALANCED_LIECHTENSTEIN';
  let rounds: number;
  let nextPlayoffFormat = t.playoff_format;
  if (isBalanced) {
    // Balanced Liechtenstein sizes on its own (balancedRounds), NOT the 7-total autoSwissConfig
    // table. No-shows don't count — mirror applyBalancedStartConfig: once anyone has checked in,
    // a still-REGISTERED (never-checked-in) participant is a no-show that must not inflate the
    // size. The playoff size stays the host's choice (it drives division formation).
    const checkedIn = roster.filter((p) => p.status === 'CHECKED_IN').length;
    const active = checkedIn > 0 ? checkedIn : roster.length;
    rounds = Math.max(balancedRounds(active), currentRound); // never shrink below a played round
  } else {
    // Auto Swiss / auto-sized Swiss keep the 7-total autoSwissConfig sizing and derive both the
    // round count and the playoff size from the active pool (REGISTERED + CHECKED_IN, unchanged).
    const dyn = computeDynamicSize(roster.length, currentRound);
    rounds = dyn.rounds;
    nextPlayoffFormat = dyn.playoffFormat;
  }
  if (rounds === (t.rounds_count ?? 0) && nextPlayoffFormat === t.playoff_format) return false;

  await prisma.tournament.update({
    where: { id: tournamentId },
    // Flag the change so the round-advance flow DMs players once, at round-end.
    data: { rounds_count: rounds, playoff_format: nextPlayoffFormat, pending_resize_notice: true },
  });
  return true;
}

// ---------------------------------------------------------------------------
// startAutoSwiss — called by cron at start_date
// ---------------------------------------------------------------------------

export async function startAutoSwiss(
  prisma: PrismaClient,
  tournamentId: string,
  redis?: Redis,
): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { mode: true },
  });
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

  const fairnessCost = await resolveFactionWarFairness(prisma, redis, t?.mode);
  const round1Matches = generateSwissRound(tournamentId, swissPlayers, 1, fairnessCost);

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

  void recordTournamentEvent({
    tournamentId,
    type: 'matches_created',
    actor: 'system',
    payload: { phase: 'swiss', round: 1, count: round1Matches.length },
  });

  // B22: notify round-1 pairings for Auto Swiss too.
  await notifyMatchesCreated(tournamentId, 1, round1Matches);
}

// ---------------------------------------------------------------------------
// advanceAutoSwissRound — called by cron every minute
// ---------------------------------------------------------------------------

export async function advanceAutoSwissRound(
  prisma: PrismaClient,
  tournamentId: string,
  redis?: Redis,
): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true, name: true, slug: true, start_date: true, mode: true,
      rounds_count: true, playoff_format: true, has_third_place_match: true,
      pending_resize_notice: true,
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
  const incompleteSwiss = currentRoundMatches.filter((m) => m.status !== 'COMPLETED' && m.status !== 'BYE' && m.status !== 'FORFEIT' && m.status !== 'CANCELLED' && m.status !== 'NO_CONTEST' && m.status !== 'CATCHUP_BYE');

  if (incompleteSwiss.length > 0) return; // current round not done

  const playoffMatches = allMatches.filter((m) => m.phase?.startsWith('PLAYOFF'));

  // Playoffs already started → nothing left to auto-generate here. Finalising a tournament is a
  // HOST decision and MUST NEVER be automatic: the old auto-finalise closed tournaments the moment
  // the last EXISTING playoff match finished — e.g. right after the semis, before the final round
  // was even created (route-generated brackets create only one playoff round at a time). The host
  // advances the bracket (POST /advance-playoffs) and closes the tournament manually.
  if (playoffMatches.length > 0) {
    return;
  }

  // More Swiss rounds to play
  if (maxSwissRound < tournament.rounds_count) {
    await generateNextSwissRound(prisma, tournament, swissMatches, maxSwissRound + 1, redis);
    // P6 (#40): if dynamic sizing changed the bracket during the round that just
    // finished, tell the active players once — now that the next pairings are up.
    if (tournament.pending_resize_notice) {
      const active = await prisma.tournamentParticipant.count({
        where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN'] } },
      });
      void notifyAutoSizeChanged(tournamentId, active, tournament.rounds_count, tournament.playoff_format ?? 'NONE');
      await prisma.tournament.update({ where: { id: tournamentId }, data: { pending_resize_notice: false } });
    }
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
  tournament: { id: string; name: string; slug: string; start_date: Date; rounds_count: number | null; playoff_format: string | null; mode: string | null },
  swissMatches: { id: string; round: number; phase: string | null; status: string; player1_id: string | null; player2_id: string | null; winner_id: string | null; match_number: number }[],
  targetRound: number,
  redis?: Redis,
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
  const standings = sortSwissStandings(rawStandings, completed, tournament.id);

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
    // A CATCHUP_BYE counts as "already byed" for pairing purposes: a late joiner who
    // sat out a round on a 0-point placeholder must not then also be handed a scoring
    // bye (that would be a double bye / free point). It still scores 0 in standings.
    if (m.status === 'BYE' || m.status === 'CATCHUP_BYE') {
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

  const fairnessCost = await resolveFactionWarFairness(prisma, redis, tournament.mode);
  const newMatches = generateSwissRound(tournament.id, swissPlayers, targetRound, fairnessCost);

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

  void recordTournamentEvent({
    tournamentId: tournament.id,
    type: 'matches_created',
    actor: 'system',
    payload: { phase: 'swiss', round: targetRound, count: newMatches.length },
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

    // Bye DM for this round's bye player — encouraging, or "your run is over" on the
    // final Swiss round when a playoff spot is out of reach. Safe check: only mark as
    // eliminated when at least `cutoff` players are guaranteed to finish strictly above
    // them (bye = +1 already applied), so we never falsely tell someone it's over.
    const byeMatch = newMatches.find((m) => m.status === 'BYE');
    if (byeMatch?.player1_id) {
      const byeUserId = byeMatch.player1_id;
      const byePost = (swissPlayers.find((p) => p.userId === byeUserId)?.score ?? 0) + 1;
      const cutoff =
        tournament.playoff_format === 'TOP8' ? 8 :
        tournament.playoff_format === 'TOP4' ? 4 :
        tournament.playoff_format === 'TOP2' ? 2 : 0;
      let eliminated = false;
      if (targetRound === tournament.rounds_count) {
        eliminated = cutoff === 0
          ? true // no playoffs → the tournament ends for everyone after this round
          : swissPlayers.filter((p) => p.userId !== byeUserId && p.score > byePost).length >= cutoff;
      }
      const byeUser = await prisma.user.findUnique({
        where: { id: byeUserId },
        select: { discord_id: true, username: true },
      });
      if (byeUser?.discord_id) {
        await notifyBye(
          { name: tournament.name, slug: tournament.slug },
          targetRound,
          { discord_id: byeUser.discord_id, username: byeUser.username },
          { eliminated },
        );
      }
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
  const standings = sortSwissStandings(rawStandings, completed, tournament.id);
  const ranked = standings.filter((s) => !s.dropped).map((s) => s.userId);

  // Re-evaluate playoff format based on active player count at Swiss end.
  // Players may have dropped during the Swiss phase, so the start-time config
  // (stored in tournament.playoff_format) may no longer be appropriate.
  const effectiveConfig = autoSwissConfig(ranked.length);
  if (effectiveConfig && effectiveConfig.playoffFormat !== tournament.playoff_format) {
    await prisma.tournament.update({ where: { id: tournament.id }, data: { playoff_format: effectiveConfig.playoffFormat } });
  }
  const fmt = effectiveConfig?.playoffFormat ?? tournament.playoff_format;

  // P1/P2/P5 (#23): congratulate the qualifiers, or thank everyone if there are no
  // playoffs. Qualifiers = the top `cutoff` of the final standings.
  const cutoff = fmt === 'TOP8' ? 8 : fmt === 'TOP4' ? 4 : fmt === 'TOP2' ? 2 : 0;
  if (cutoff > 0) {
    void notifyPlayoffResults(tournament.id, ranked.slice(0, cutoff), ranked.slice(cutoff));
  } else {
    void notifyNoPlayoffComplete(tournament.id, ranked);
  }

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
    // No playoff bracket to build (too few players / no playoff format). Do NOT auto-finalise —
    // the host closes the tournament manually. Leave it ONGOING.
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
