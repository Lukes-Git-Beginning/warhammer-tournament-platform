import { Prisma } from '@rizzotto/db';

/**
 * The single source of truth for which MatchGames feed GLOBAL statistics —
 * the matchup heatmap (`getMatchupMatrix`) and the rating model that backs the
 * model matchup matrix / faction proficiency (`loadVersionObservations`). Both
 * MUST read the same set so their sample sizes agree.
 *
 * Games are the statistical unit; the parent Match's status is irrelevant (a
 * completed game of an in-progress Bo3 still counts). A game feeds statistics iff:
 *   - it is a COMPLETED game,
 *   - it is leaderboard-eligible — `counts_for_leaderboard` is authoritative at
 *     the GAME level: it is false for a modded/restricted faction and is cascaded
 *     to games when a match is voided or cancelled (see routes/matches.ts), so no
 *     match-level flag needs to be re-checked here, and
 *   - it belongs to a non-deleted match of this version with both players set
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
export function eligibleStatGameWhere(versionId: string | null): Prisma.MatchGameWhereInput {
  return {
    status: 'COMPLETED',
    counts_for_leaderboard: true,
    match: {
      // null versionId = the all-time fit (timeless GS): span every version.
      ...(versionId !== null ? { version_id: versionId } : {}),
      deleted_at: null,
      player1_id: { not: null },
      player2_id: { not: null },
    },
  };
}

/**
 * A 2v2 (team-as-actor) match: a TOURNAMENT tagged TWO_V_TWO, or an Open Play match whose own
 * competitor_format is TWO_V_TWO (Open Play has no tournament; 2v2 queue/challenges exist since
 * 2026-09-15). Faction/matchup stats are 1v1 by construction (FactionStats/MatchupStats carry no
 * competitor_format), so 1v1 consumers exclude this and duo consumers select it. Checking only
 * `tournament.competitor_format` let Open Play 2v2 games leak into 1v1 stats with the captain's
 * faction and miss the duo meta. Use inside `match: { AND: [...] }` to avoid key collisions.
 */
export const TEAM_MATCH_WHERE: Prisma.MatchWhereInput = {
  OR: [{ tournament: { competitor_format: 'TWO_V_TWO' } }, { competitor_format: 'TWO_V_TWO' }],
};

/** Raw-SQL twin of NOT TEAM_MATCH_WHERE, for queries aliasing the match as `m`: `AND ${SQL_NOT_TEAM_MATCH}`. */
export const SQL_NOT_TEAM_MATCH = Prisma.sql`(m.competitor_format::text <> 'TWO_V_TWO' AND (m.tournament_id IS NULL OR m.tournament_id NOT IN (SELECT id FROM "Tournament" WHERE competitor_format::text = 'TWO_V_TWO')))`;
