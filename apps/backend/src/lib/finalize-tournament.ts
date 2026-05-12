import type { PrismaClient } from '@tww3/db';
import { calculateTournamentPoints } from './tournament-utils.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * For a single-elimination bracket with `totalRounds` rounds,
 * returns the placement a player receives for losing in `round`.
 * Winners of the final (round === totalRounds) get placement 1 — handled
 * separately via computeSingleElimPlacements.
 * Losers of the final get placement 2.
 * Losers of round r get placement 2^(totalRounds - r) + 1.
 */
export function placementForRound(round: number, totalRounds: number): number {
  if (round === totalRounds) return 2; // final loser
  return Math.pow(2, totalRounds - round) + 1;
}

// ---------------------------------------------------------------------------
// Single-elim placement computation
// ---------------------------------------------------------------------------

type MatchLike = {
  round: number;
  winner_id: string | null;
  player1_id: string | null;
  player2_id: string | null;
  status: string;
};

export function computeSingleElimPlacements(matches: MatchLike[]): Map<string, number> {
  const placements = new Map<string, number>();

  const completedMatches = matches.filter(
    (m) => m.status === 'COMPLETED' || m.status === 'BYE',
  );

  if (completedMatches.length === 0) return placements;

  const totalRounds = Math.max(...completedMatches.map((m) => m.round));

  for (const match of completedMatches) {
    if (match.status === 'BYE') {
      // BYE receiver is the non-null player — they advance without a loser
      const receiver = match.player1_id ?? match.player2_id;
      if (receiver && !placements.has(receiver)) {
        // BYE receivers get no permanent placement here; they continue in bracket
      }
      continue;
    }

    const { round, winner_id, player1_id, player2_id } = match;
    if (!winner_id) continue;

    // Determine loser
    const loser =
      player1_id === winner_id ? player2_id : player1_id;

    if (round === totalRounds) {
      // Final: winner gets 1, loser gets 2
      placements.set(winner_id, 1);
      if (loser) placements.set(loser, 2);
    } else {
      if (loser && !placements.has(loser)) {
        placements.set(loser, placementForRound(round, totalRounds));
      }
    }
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Ranked (Swiss / RR / DRR) placement computation
// ---------------------------------------------------------------------------

export function computeRankedPlacements(
  participantIds: string[],
  matches: MatchLike[],
): Map<string, number> {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();

  for (const id of participantIds) {
    wins.set(id, 0);
    losses.set(id, 0);
  }

  for (const match of matches) {
    if (match.status !== 'COMPLETED') continue;
    if (!match.winner_id) continue;

    const { winner_id, player1_id, player2_id } = match;
    wins.set(winner_id, (wins.get(winner_id) ?? 0) + 1);

    const loser = player1_id === winner_id ? player2_id : player1_id;
    if (loser) {
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
  }

  // Sort: wins desc, losses asc
  const sorted = [...participantIds].sort((a, b) => {
    const wDiff = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
    if (wDiff !== 0) return wDiff;
    return (losses.get(a) ?? 0) - (losses.get(b) ?? 0);
  });

  const placements = new Map<string, number>();
  let currentPlacement = 1;

  for (let i = 0; i < sorted.length; ) {
    const id = sorted[i]!;
    const w = wins.get(id) ?? 0;
    const l = losses.get(id) ?? 0;

    // Find all tied players
    let j = i;
    while (
      j < sorted.length &&
      (wins.get(sorted[j]!) ?? 0) === w &&
      (losses.get(sorted[j]!) ?? 0) === l
    ) {
      placements.set(sorted[j]!, currentPlacement);
      j++;
    }

    currentPlacement += j - i;
    i = j;
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Main finalize function
// ---------------------------------------------------------------------------

const RANKED_FORMATS = new Set([
  'SWISS',
  'ROUND_ROBIN',
  'DOUBLE_ROUND_ROBIN',
]);

export async function finalizeTournament(
  prisma: PrismaClient,
  tournamentId: string,
  actorId: string,
): Promise<{ resultCount: number; seasonId: string | null }> {
  // Load tournament
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: {
      id: true,
      format: true,
      counts_for_leaderboard: true,
      is_major: true,
    },
  });

  // Load matches and participants
  const [matches, participants] = await Promise.all([
    prisma.match.findMany({
      where: { tournament_id: tournamentId, deleted_at: null },
      select: {
        round: true,
        winner_id: true,
        player1_id: true,
        player2_id: true,
        status: true,
      },
    }),
    prisma.tournamentParticipant.findMany({
      where: {
        tournament_id: tournamentId,
        deleted_at: null,
        status: { in: ['REGISTERED', 'CHECKED_IN'] },
      },
      select: { user_id: true },
    }),
  ]);

  const participantIds = participants.map((p) => p.user_id);
  const playerCount = participantIds.length;

  // Compute placements
  let placements: Map<string, number>;
  if (RANKED_FORMATS.has(tournament.format)) {
    placements = computeRankedPlacements(participantIds, matches as MatchLike[]);
  } else {
    placements = computeSingleElimPlacements(matches as MatchLike[]);
  }

  // Active season
  const activeSeason = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  const seasonId = activeSeason?.id ?? null;

  // Per-user stats for leaderboard
  const userWins = new Map<string, number>();
  const userLosses = new Map<string, number>();
  const userMatchesPlayed = new Map<string, number>();

  for (const match of matches) {
    if (match.status !== 'COMPLETED') continue;
    if (!match.winner_id) continue;

    const { winner_id, player1_id, player2_id } = match;
    userWins.set(winner_id, (userWins.get(winner_id) ?? 0) + 1);
    userMatchesPlayed.set(winner_id, (userMatchesPlayed.get(winner_id) ?? 0) + 1);

    const loser = player1_id === winner_id ? player2_id : player1_id;
    if (loser) {
      userLosses.set(loser, (userLosses.get(loser) ?? 0) + 1);
      userMatchesPlayed.set(loser, (userMatchesPlayed.get(loser) ?? 0) + 1);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const [userId, placement] of placements) {
      const points = calculateTournamentPoints({
        placement,
        playerCount,
        isMajor: tournament.is_major,
      });

      await tx.tournamentResult.upsert({
        where: { tournament_id_user_id: { tournament_id: tournamentId, user_id: userId } },
        create: {
          tournament_id: tournamentId,
          user_id: userId,
          season_id: seasonId,
          placement,
          points_earned: points,
          elo_change: 0,
        },
        update: {
          season_id: seasonId,
          placement,
          points_earned: points,
          elo_change: 0,
        },
      });

      if (seasonId && tournament.counts_for_leaderboard) {
        const w = userWins.get(userId) ?? 0;
        const l = userLosses.get(userId) ?? 0;
        const mp = userMatchesPlayed.get(userId) ?? 0;

        await tx.leaderboardEntry.upsert({
          where: { user_id_season_id: { user_id: userId, season_id: seasonId } },
          create: {
            user_id: userId,
            season_id: seasonId,
            total_points: points,
            matches_played: mp,
            wins: w,
            losses: l,
          },
          update: {
            total_points: { increment: points },
            matches_played: { increment: mp },
            wins: { increment: w },
            losses: { increment: l },
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: tournamentId,
        action: 'finalize',
        actor_id: actorId,
        new_value: { resultCount: placements.size, seasonId } as Record<string, string | number | boolean | null>,
      },
    });
  });

  return { resultCount: placements.size, seasonId };
}
