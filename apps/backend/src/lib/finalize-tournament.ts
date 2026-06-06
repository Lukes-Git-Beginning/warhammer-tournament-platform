import type { PrismaClient } from '@rizzotto/db';
import { calculateTournamentPoints } from './tournament-utils.js';
import { computeEloDeltas } from './elo.js';

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
  bracket_side: string | null;
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
// Double-elimination placement computation
// ---------------------------------------------------------------------------

/**
 * Computes placements for a double-elimination bracket.
 *
 * Champion determination:
 *   - The GRAND_FINAL match with the highest round that has status='COMPLETED'
 *     is the decisive final. Its winner gets placement 1, its loser placement 2.
 *
 * Remaining placements (3, 4, …):
 *   - All other COMPLETED matches are sorted descending by round.
 *   - For each match, the loser (if not yet placed) receives the next
 *     sequential placement starting at 3.
 *   - BYE and FORFEIT matches are skipped (no real loser to place).
 *
 * @param matches - All matches for the tournament, including bracket_side.
 */
export function computeDoubleElimPlacements(matches: MatchLike[]): Map<string, number> {
  const placements = new Map<string, number>();

  const completedMatches = matches.filter((m) => m.status === 'COMPLETED');
  if (completedMatches.length === 0) return placements;

  // Identify the decisive Grand Final: COMPLETED GRAND_FINAL match with highest round
  const grandFinals = completedMatches
    .filter((m) => m.bracket_side === 'GRAND_FINAL')
    .sort((a, b) => b.round - a.round);

  const championMatch = grandFinals[0];
  if (!championMatch || !championMatch.winner_id) return placements;

  const { winner_id: champion, player1_id: gfP1, player2_id: gfP2 } = championMatch;
  const runnerUp = gfP1 === champion ? gfP2 : gfP1;

  placements.set(champion, 1);
  if (runnerUp) placements.set(runnerUp, 2);

  // Sort remaining COMPLETED matches by round descending, skip the champion match
  const remainingMatches = completedMatches
    .filter((m) => m !== championMatch)
    .sort((a, b) => b.round - a.round);

  let nextPlacement = 3;
  for (const match of remainingMatches) {
    if (!match.winner_id) continue;

    const { winner_id, player1_id, player2_id } = match;
    const loser = player1_id === winner_id ? player2_id : player1_id;

    if (loser && !placements.has(loser)) {
      placements.set(loser, nextPlacement);
      nextPlacement++;
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
  const opponents = new Map<string, string[]>();

  for (const id of participantIds) {
    wins.set(id, 0);
    losses.set(id, 0);
    opponents.set(id, []);
  }

  for (const match of matches) {
    if (match.status !== 'COMPLETED') continue;
    if (!match.winner_id || !match.player1_id || !match.player2_id) continue;

    const { winner_id, player1_id, player2_id } = match;
    wins.set(winner_id, (wins.get(winner_id) ?? 0) + 1);

    const loser = player1_id === winner_id ? player2_id : player1_id;
    if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);

    opponents.get(player1_id)?.push(player2_id);
    opponents.get(player2_id)?.push(player1_id);
  }

  // Buchholz: sum of each opponent's wins
  const buchholz = new Map<string, number>();
  for (const id of participantIds) {
    const bh = (opponents.get(id) ?? []).reduce((s, opp) => s + (wins.get(opp) ?? 0), 0);
    buchholz.set(id, bh);
  }

  // Sort: wins desc → losses asc → buchholz desc
  const sorted = [...participantIds].sort((a, b) => {
    const wDiff = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
    if (wDiff !== 0) return wDiff;
    const lDiff = (losses.get(a) ?? 0) - (losses.get(b) ?? 0);
    if (lDiff !== 0) return lDiff;
    return (buchholz.get(b) ?? 0) - (buchholz.get(a) ?? 0);
  });

  const placements = new Map<string, number>();
  let currentPlacement = 1;

  for (let i = 0; i < sorted.length; ) {
    const id = sorted[i]!;
    const w = wins.get(id) ?? 0;
    const l = losses.get(id) ?? 0;
    const bh = buchholz.get(id) ?? 0;

    let j = i;
    while (
      j < sorted.length &&
      (wins.get(sorted[j]!) ?? 0) === w &&
      (losses.get(sorted[j]!) ?? 0) === l &&
      (buchholz.get(sorted[j]!) ?? 0) === bh
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
        bracket_side: true,
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
  } else if (tournament.format === 'DOUBLE_ELIMINATION') {
    placements = computeDoubleElimPlacements(matches as MatchLike[]);
  } else {
    placements = computeSingleElimPlacements(matches as MatchLike[]);
  }

  // Active season
  const activeSeason = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  const seasonId = activeSeason?.id ?? null;

  // Per-user stats at MatchGame level — consistent with the Season tab's
  // derive-on-read approach. A BO3 Final (2-1) contributes W+2, L+1, not W+1.
  const confirmedGames = await prisma.matchGame.findMany({
    where: {
      match: { tournament_id: tournamentId, deleted_at: null, status: 'COMPLETED' },
      status: 'COMPLETED',
      winner_id: { not: null },
    },
    select: {
      winner_id: true,
      match: { select: { player1_id: true, player2_id: true } },
    },
  });

  const userWins = new Map<string, number>();
  const userLosses = new Map<string, number>();
  const userMatchesPlayed = new Map<string, number>();

  for (const game of confirmedGames) {
    if (!game.winner_id) continue;
    const { player1_id, player2_id } = game.match;
    const loserId = game.winner_id === player1_id ? player2_id : player1_id;

    userWins.set(game.winner_id, (userWins.get(game.winner_id) ?? 0) + 1);
    if (loserId) userLosses.set(loserId, (userLosses.get(loserId) ?? 0) + 1);
  }

  for (const id of participantIds) {
    userMatchesPlayed.set(id, (userWins.get(id) ?? 0) + (userLosses.get(id) ?? 0));
  }

  // ---------------------------------------------------------------------------
  // ELO computation (before transaction — reads current ratings from DB)
  // ---------------------------------------------------------------------------

  // Build list of userIds from finalized placements
  const finalizedUserIds = [...placements.keys()];

  // Load existing LeaderboardEntry ratings for the active season (default 1200)
  const existingEntries =
    seasonId && finalizedUserIds.length > 0
      ? await prisma.leaderboardEntry.findMany({
          where: {
            season_id: seasonId,
            user_id: { in: finalizedUserIds },
          },
          select: { user_id: true, elo_rating: true },
        })
      : [];

  const currentRatingMap = new Map<string, number>(
    existingEntries.map((e) => [e.user_id, e.elo_rating]),
  );

  const eloInputs = finalizedUserIds.map((userId) => ({
    userId,
    currentRating: currentRatingMap.get(userId) ?? 1200,
    placement: placements.get(userId)!,
  }));

  const eloResults = computeEloDeltas(eloInputs, { isMajor: tournament.is_major });

  // Index by userId for O(1) lookup inside transaction
  const eloByUserId = new Map(eloResults.map((r) => [r.userId, r]));

  // ---------------------------------------------------------------------------

  await prisma.$transaction(async (tx) => {
    for (const [userId, placement] of placements) {
      const points = calculateTournamentPoints({
        placement,
        playerCount,
        isMajor: tournament.is_major,
      });

      const elo = eloByUserId.get(userId);
      const eloChange = elo?.delta ?? 0;

      await tx.tournamentResult.upsert({
        where: { tournament_id_user_id: { tournament_id: tournamentId, user_id: userId } },
        create: {
          tournament_id: tournamentId,
          user_id: userId,
          season_id: seasonId,
          placement,
          points_earned: points,
          elo_change: eloChange,
        },
        update: {
          season_id: seasonId,
          placement,
          points_earned: points,
          elo_change: eloChange,
        },
      });

      if (seasonId && tournament.counts_for_leaderboard) {
        const w = userWins.get(userId) ?? 0;
        const l = userLosses.get(userId) ?? 0;
        const mp = userMatchesPlayed.get(userId) ?? 0;
        const newEloRating = elo?.newRating ?? (currentRatingMap.get(userId) ?? 1200);

        await tx.leaderboardEntry.upsert({
          where: { user_id_season_id: { user_id: userId, season_id: seasonId } },
          create: {
            user_id: userId,
            season_id: seasonId,
            total_points: points,
            matches_played: mp,
            wins: w,
            losses: l,
            elo_rating: newEloRating,
          },
          update: {
            total_points: { increment: points },
            matches_played: { increment: mp },
            wins: { increment: w },
            losses: { increment: l },
            elo_rating: newEloRating,
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
