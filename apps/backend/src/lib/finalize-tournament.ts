import type { PrismaClient } from '@rizzotto/db';
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
  bracket_side: string | null;
  phase?: string | null;
};

export function computeSingleElimPlacements(matches: MatchLike[]): Map<string, number> {
  const placements = new Map<string, number>();

  const completedMatches = matches.filter(
    (m) => m.status === 'COMPLETED' || m.status === 'BYE',
  );

  if (completedMatches.length === 0) return placements;

  // Handle the third-place match first and exclude it from round-based logic.
  // It shares the same round number as the Grand Final, so it must be separated
  // explicitly to avoid overwriting the 1st/2nd place assignments.
  for (const match of completedMatches) {
    if (match.phase !== 'PLAYOFF_THIRD_PLACE') continue;
    if (!match.winner_id) continue;
    const loser = match.player1_id === match.winner_id ? match.player2_id : match.player1_id;
    placements.set(match.winner_id, 3);
    if (loser) placements.set(loser, 4);
  }

  const bracketMatches = completedMatches.filter(
    (m) => m.phase !== 'PLAYOFF_THIRD_PLACE',
  );
  if (bracketMatches.length === 0) return placements;

  const totalRounds = Math.max(...bracketMatches.map((m) => m.round));

  for (const match of bracketMatches) {
    if (match.status === 'BYE') continue;

    const { round, winner_id, player1_id, player2_id } = match;
    if (!winner_id) continue;

    const loser = player1_id === winner_id ? player2_id : player1_id;

    if (round === totalRounds) {
      // Grand Final: winner gets 1, loser gets 2
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
// Swiss + Playoff placement computation
// ---------------------------------------------------------------------------

/**
 * Handles the combined Swiss+Playoff case (TOP4 / TOP8):
 * - Playoff participants get placements 1–N from the playoff bracket
 *   (using computeSingleElimPlacements on the playoff matches only).
 * - Non-playoff participants are ranked after that by Swiss performance
 *   (wins/losses/Buchholz from Swiss matches only).
 * Falls back to computeRankedPlacements when no playoff matches exist.
 */
function computeSwissPlayoffPlacements(
  participantIds: string[],
  matches: MatchLike[],
): Map<string, number> {
  const swissMatches = matches.filter(
    (m) => m.phase === null || m.phase === undefined || m.phase === 'SWISS',
  );
  const playoffMatches = matches.filter(
    (m) => m.phase && m.phase.startsWith('PLAYOFF'),
  );

  if (playoffMatches.length === 0) {
    return computeRankedPlacements(participantIds, swissMatches);
  }

  // Playoff placements (1-4 for TOP4, 1-8 for TOP8) via single-elim logic.
  const playoffPlacements = computeSingleElimPlacements(playoffMatches);

  // All player IDs that appeared in any playoff match.
  const playoffPlayerIds = new Set<string>();
  for (const m of playoffMatches) {
    if (m.player1_id) playoffPlayerIds.add(m.player1_id);
    if (m.player2_id) playoffPlayerIds.add(m.player2_id);
  }

  // Non-playoff players ranked by Swiss performance only.
  const nonPlayoffIds = participantIds.filter((id) => !playoffPlayerIds.has(id));
  const swissRankings = computeRankedPlacements(nonPlayoffIds, swissMatches);

  // Offset non-playoff placements so they start after all playoff slots.
  const playoffSlots = playoffPlayerIds.size;
  const result = new Map<string, number>(playoffPlacements);
  for (const [id, rank] of swissRankings) {
    result.set(id, playoffSlots + rank);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main finalize function
// ---------------------------------------------------------------------------

const RANKED_FORMATS = new Set([
  'SWISS',
  'ROUND_ROBIN',
  'DOUBLE_ROUND_ROBIN',
  'LIECHTENSTEIN',
  'BALANCED_LIECHTENSTEIN',
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
        phase: true,
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
  if (tournament.format === 'BALANCED_LIECHTENSTEIN') {
    // Division playoffs are several parallel finals (one champion per skill level),
    // not a single bracket — so the OVERALL placement is by Swiss standing. The
    // per-division champions are the PLAYOFF_FINAL winners (surfaced separately).
    const swissMatches = matches.filter(
      (m) => m.phase === null || m.phase === undefined || m.phase === 'SWISS',
    );
    placements = computeRankedPlacements(participantIds, swissMatches as MatchLike[]);
  } else if (RANKED_FORMATS.has(tournament.format)) {
    placements = computeSwissPlayoffPlacements(participantIds, matches as MatchLike[]);
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

  // Build list of userIds from finalized placements
  const finalizedUserIds = [...placements.keys()];

  // -------------------------------------------------------------------------
  // Season-level pre-computation (outside transaction for performance).
  // All values are SET on LeaderboardEntry — never incremented — so
  // finalizeTournament is fully idempotent regardless of how many times it runs.
  // -------------------------------------------------------------------------

  // 1. Season-total points: sum of ALL TournamentResults in the season for each
  //    player, replacing this tournament's old value with the newly computed one.
  const priorSeasonResults =
    seasonId && finalizedUserIds.length > 0
      ? await prisma.tournamentResult.findMany({
          where: {
            season_id: seasonId,
            user_id: { in: finalizedUserIds },
            tournament_id: { not: tournamentId }, // exclude current — will be added fresh
          },
          select: { user_id: true, points_earned: true },
        })
      : [];
  const priorPointsMap = new Map<string, number>();
  for (const r of priorSeasonResults) {
    priorPointsMap.set(r.user_id, (priorPointsMap.get(r.user_id) ?? 0) + r.points_earned);
  }

  // 3. Season-total W/L at game level across ALL season tournaments.
  //    BYEs have no MatchGame records → automatically excluded.
  const allSeasonGames =
    seasonId && finalizedUserIds.length > 0
      ? await prisma.matchGame.findMany({
          where: {
            status: 'COMPLETED',
            winner_id: { not: null },
            match: {
              season_id: seasonId,
              deleted_at: null,
              tournament: { counts_for_leaderboard: true },
              OR: [
                { player1_id: { in: finalizedUserIds } },
                { player2_id: { in: finalizedUserIds } },
              ],
            },
          },
          select: {
            winner_id: true,
            match: { select: { player1_id: true, player2_id: true } },
          },
        })
      : [];

  const seasonWins = new Map<string, number>();
  const seasonLosses = new Map<string, number>();
  for (const g of allSeasonGames) {
    if (!g.winner_id) continue;
    const loser = g.winner_id === g.match.player1_id ? g.match.player2_id : g.match.player1_id;
    seasonWins.set(g.winner_id, (seasonWins.get(g.winner_id) ?? 0) + 1);
    if (loser) seasonLosses.set(loser, (seasonLosses.get(loser) ?? 0) + 1);
  }

  // ---------------------------------------------------------------------------

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
        },
        update: {
          season_id: seasonId,
          placement,
          points_earned: points,
        },
      });

      if (seasonId && tournament.counts_for_leaderboard) {
        const totalPoints = (priorPointsMap.get(userId) ?? 0) + points;
        const totalWins = seasonWins.get(userId) ?? 0;
        const totalLosses = seasonLosses.get(userId) ?? 0;

        await tx.leaderboardEntry.upsert({
          where: { user_id_season_id: { user_id: userId, season_id: seasonId } },
          create: {
            user_id: userId,
            season_id: seasonId,
            total_points: totalPoints,
            games_played: totalWins + totalLosses,
            wins: totalWins,
            losses: totalLosses,
          },
          update: {
            total_points: totalPoints,
            games_played: totalWins + totalLosses,
            wins: totalWins,
            losses: totalLosses,
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
