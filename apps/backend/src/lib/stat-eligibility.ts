import type { Prisma } from '@rizzotto/db';

/**
 * The single source of truth for which MatchGames feed GLOBAL statistics —
 * the matchup heatmap (`getMatchupMatrix`) and the rating model that backs the
 * model matchup matrix / faction proficiency (`loadSeasonObservations`). Both
 * MUST read the same set so their sample sizes agree.
 *
 * Games are the statistical unit; the parent Match's status is irrelevant (a
 * completed game of an in-progress Bo3 still counts). A game feeds statistics iff:
 *   - it is a COMPLETED game,
 *   - it is leaderboard-eligible — `counts_for_leaderboard` is authoritative at
 *     the GAME level: it is false for a modded/restricted faction and is cascaded
 *     to games when a match is voided or cancelled (see routes/matches.ts), so no
 *     match-level flag needs to be re-checked here, and
 *   - it belongs to a non-deleted match of this season with both players set
 *     (needed to attribute the winning faction).
 *
 * Draws (null winner) are left IN the set — they are counted by the raw heatmap
 * and excluded by the model (which adds `winner_id: { not: null }`). In practice
 * no game-level draw exists, so the two `n` values coincide; a draw appearing in
 * the data is a reporting error, not a real result.
 *
 * Mirror games (same faction on both sides) have no matchup winrate and are
 * dropped by each consumer in application code — a field-to-field comparison
 * Prisma cannot express in a where-clause.
 */
export function eligibleStatGameWhere(seasonId: string): Prisma.MatchGameWhereInput {
  return {
    status: 'COMPLETED',
    counts_for_leaderboard: true,
    match: {
      season_id: seasonId,
      deleted_at: null,
      player1_id: { not: null },
      player2_id: { not: null },
    },
  };
}
