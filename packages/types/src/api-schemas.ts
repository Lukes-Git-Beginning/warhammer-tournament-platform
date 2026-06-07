// Shared Zod schemas for API request/response bodies.

import { z } from 'zod';
import { MatchResultTypeSchema } from './match.js';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const RoleSchema = z.enum(['USER', 'ORGANIZER', 'MODERATOR', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const UserPublicSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  avatar_url: z.string().url().nullable(),
  role: RoleSchema,
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const SteamLinkSchema = z.object({
  steam_id: z.string(),
  steam_username: z.string().nullable(),
  steam_avatar_url: z.string().nullable(),
  linked_at: z.string().datetime(),
});
export type SteamLink = z.infer<typeof SteamLinkSchema>;

export const UserMeSchema = UserPublicSchema.extend({
  discord_id: z.string(),
  email: z.string().email().nullable(),
  timezone: z.string().nullable(),
  preferred_factions: z.array(z.string()),
  last_login: z.string().datetime().nullable(),
  onboarded_at: z.string().datetime().nullable(),
  onboarding_stage: z.number().int().min(0).max(4),
  created_at: z.string().datetime(),
  steam_link: SteamLinkSchema.nullable().optional(),
});
export type UserMe = z.infer<typeof UserMeSchema>;

export const UpdateMeSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  preferred_factions: z.array(z.string()).max(24).optional(),
  reset_onboarding: z.literal(true).optional(),
});
export type UpdateMe = z.infer<typeof UpdateMeSchema>;

export const UpdateOnboardingStageSchema = z.object({
  stage: z.number().int().min(0).max(4),
});
export type UpdateOnboardingStage = z.infer<typeof UpdateOnboardingStageSchema>;

export const UpdateUserRoleRequestSchema = z.object({ role: RoleSchema });
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;

export const DiscordCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});
export type DiscordCallbackQuery = z.infer<typeof DiscordCallbackQuerySchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  discord_id: z.string(),
  username: z.string(),
  role: RoleSchema,
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export const SeasonSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  is_active: z.boolean(),
  dlc_tag: z.string().nullable().optional(),
});
export type SeasonSummary = z.infer<typeof SeasonSummarySchema>;

export const LeaderboardEntryDtoSchema = z.object({
  rank: z.number().int(),
  user: z.object({ id: z.string().uuid(), username: z.string(), avatar_url: z.string().url().nullable() }),
  total_points: z.number(),
  games_played: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

export const LeaderboardResponseSchema = z.object({
  season: SeasonSummarySchema.optional(),
  entries: z.array(LeaderboardEntryDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const AllTimeLeaderboardEntryDtoSchema = LeaderboardEntryDtoSchema.extend({
  seasons_participated: z.number().int(),
});
export type AllTimeLeaderboardEntryDto = z.infer<typeof AllTimeLeaderboardEntryDtoSchema>;

// ---------------------------------------------------------------------------
// Dynamic Weighted Leaderboard (Alex-Spec) — derive-on-read scoring
//
// Nothing is stored: every value is reconstructable from current model values,
// the current opponent-share modifier, and confirmed match facts.
// ---------------------------------------------------------------------------

// #1 — Main leaderboard
export const DynamicLeaderboardEntryDtoSchema = z.object({
  rank: z.number().int(),
  playerId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  totalFinalPoints: z.number(),
  totalRawPoints: z.number(),
  totalGames: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type DynamicLeaderboardEntryDto = z.infer<typeof DynamicLeaderboardEntryDtoSchema>;

export const DynamicLeaderboardResponseSchema = z.object({
  season: SeasonSummarySchema.optional(),
  entries: z.array(DynamicLeaderboardEntryDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type DynamicLeaderboardResponse = z.infer<typeof DynamicLeaderboardResponseSchema>;

// #2 — Match scoring breakdown
export const MatchScoringBreakdownDtoSchema = z.object({
  matchId: z.string().uuid(),
  winner: z.object({ id: z.string().uuid(), username: z.string() }),
  loser: z.object({ id: z.string().uuid(), username: z.string() }),
  winnerFaction: z.string(),
  loserFaction: z.string(),
  winnerPlayerFactionSkill: z.number(),
  loserPlayerFactionSkill: z.number(),
  matchupEffect: z.number(),
  expectedChanceToWin: z.number(),
  rawPoints: z.number(),
  opponentShare: z.number(),
  opponentModifier: z.number(),
  finalPoints: z.number(),
});
export type MatchScoringBreakdownDto = z.infer<typeof MatchScoringBreakdownDtoSchema>;

// #3 — Player/opponent anti-farming breakdown
export const PlayerOpponentBreakdownDtoSchema = z.object({
  playerId: z.string().uuid(),
  opponentId: z.string().uuid(),
  matchesVsOpponent: z.number().int(),
  playerTotalMatches: z.number().int(),
  opponentShare: z.number(),
  opponentModifier: z.number(),
  rawPointsFromWinsVsOpponent: z.number(),
  finalPointsFromWinsVsOpponent: z.number(),
});
export type PlayerOpponentBreakdownDto = z.infer<typeof PlayerOpponentBreakdownDtoSchema>;

// #4 — Faction matchup matrix
export const FactionMatchupMatrixEntryDtoSchema = z.object({
  factionA: z.string(),
  factionB: z.string(),
  matchupEffect: z.number(),
  neutralEqualProficiencyWinChance: z.number(),
  sampleSize: z.number().int(),
  lowSampleWarning: z.boolean(),
});
export type FactionMatchupMatrixEntryDto = z.infer<typeof FactionMatchupMatrixEntryDtoSchema>;

export const FactionMatchupMatrixResponseSchema = z.object({
  seasonId: z.string().uuid(),
  entries: z.array(FactionMatchupMatrixEntryDtoSchema),
});
export type FactionMatchupMatrixResponse = z.infer<typeof FactionMatchupMatrixResponseSchema>;

// #5 — Player faction proficiency table
export const PlayerFactionProficiencyDtoSchema = z.object({
  playerId: z.string().uuid(),
  factionId: z.string(),
  playerFactionSkill: z.number(),
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  lowSampleWarning: z.boolean(),
});
export type PlayerFactionProficiencyDto = z.infer<typeof PlayerFactionProficiencyDtoSchema>;

export const PlayerFactionProficiencyResponseSchema = z.object({
  playerId: z.string().uuid(),
  seasonId: z.string().uuid(),
  entries: z.array(PlayerFactionProficiencyDtoSchema),
});
export type PlayerFactionProficiencyResponse = z.infer<typeof PlayerFactionProficiencyResponseSchema>;

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export const UserProfileResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    avatar_url: z.string().url().nullable(),
    role: RoleSchema,
    created_at: z.string().datetime(),
  }),
  current_season: z
    .object({
      season: SeasonSummarySchema,
      total_points: z.number(),
      games_played: z.number().int(),
      wins: z.number().int(),
      losses: z.number().int(),
    })
    .nullable(),
  all_time: z.object({
    games_played: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    tournaments_played: z.number().int(),
    total_points: z.number(),
  }),
  recent_results: z.array(
    z.object({
      tournament: z.object({ slug: z.string(), name: z.string(), start_date: z.string().datetime() }),
      season_name: z.string().nullable(),
      placement: z.number().int(),
      points_earned: z.number(),
      created_at: z.string().datetime(),
    }),
  ),
  recent_matches: z.array(
    z.object({
      tournament: z.object({ slug: z.string(), name: z.string() }),
      round: z.number().int(),
      opponent: z
        .object({ id: z.string().uuid(), username: z.string(), avatar_url: z.string().url().nullable() })
        .nullable(),
      winnerId: z.string().uuid().nullable(),
      score: z.string().nullable(),
      status: z.string(),
      updatedAt: z.string().datetime(),
    }),
  ),
});
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;

// ---------------------------------------------------------------------------
// Factions + Meta
// ---------------------------------------------------------------------------

export const FactionDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  race: z.string(),
  category: z.string(),
  color_hex: z.string(),
  display_order: z.number().int(),
  icon_url: z.string().url().nullable(),
  initials: z.string().length(2),
});
export type FactionDto = z.infer<typeof FactionDtoSchema>;

export const FactionStatsDtoSchema = z.object({
  matches_played: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  win_rate: z.number().nullable(),
  pick_count: z.number().int(),
  ban_count: z.number().int(),
});
export type FactionStatsDto = z.infer<typeof FactionStatsDtoSchema>;

export const FactionWithStatsDtoSchema = z.object({
  faction: FactionDtoSchema,
  stats: FactionStatsDtoSchema.nullable(),
});
export type FactionWithStatsDto = z.infer<typeof FactionWithStatsDtoSchema>;

export const FactionListResponseSchema = z.object({
  data: z.array(FactionWithStatsDtoSchema),
  season: SeasonSummarySchema.nullable(),
});
export type FactionListResponse = z.infer<typeof FactionListResponseSchema>;

export const SnapshotTrendEntrySchema = z.object({
  date: z.string(), // ISO date YYYY-MM-DD
  matches_played: z.number().int(),
  win_rate: z.number().nullable(),
});
export type SnapshotTrendEntry = z.infer<typeof SnapshotTrendEntrySchema>;

export const FactionDetailResponseSchema = z.object({
  faction: FactionDtoSchema,
  stats: FactionStatsDtoSchema.nullable(),
  trend: z.array(SnapshotTrendEntrySchema),
});
export type FactionDetailResponse = z.infer<typeof FactionDetailResponseSchema>;

export const MetaOverviewResponseSchema = z.object({
  season: SeasonSummarySchema.nullable(),
  top_factions_by_winrate: z.array(FactionWithStatsDtoSchema),
  top_factions_by_pickrate: z.array(FactionWithStatsDtoSchema),
  total_games: z.number().int(),
  faction_diversity: z.number(),
});
export type MetaOverviewResponse = z.infer<typeof MetaOverviewResponseSchema>;

export const MatchupCellSchema = z.object({
  faction_a_id: z.string(),
  faction_b_id: z.string(),
  faction_a_wins: z.number().int(),
  faction_b_wins: z.number().int(),
  draws: z.number().int(),
  total: z.number().int(),
  winrate_a: z.number().nullable(),
});
export type MatchupCell = z.infer<typeof MatchupCellSchema>;

export const MatchupHeatmapResponseSchema = z.object({
  season_id: z.string().uuid().nullable(),
  cells: z.array(MatchupCellSchema),
  factions: z.array(FactionDtoSchema),
});
export type MatchupHeatmapResponse = z.infer<typeof MatchupHeatmapResponseSchema>;

// ---------------------------------------------------------------------------
// Tournament Enums (shared between Calendar + other Hub-Foundation routes)
// ---------------------------------------------------------------------------

export const TournamentStatusSchema = z.enum([
  'DRAFT',
  'OPEN_REGISTRATION',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

export const TournamentFormatSchema = z.enum([
  'SWISS',
  'SINGLE_ELIMINATION',
  'DOUBLE_ELIMINATION',
  'ROUND_ROBIN',
  'DOUBLE_ROUND_ROBIN',
  'LIECHTENSTEIN',
]);
export type TournamentFormat = z.infer<typeof TournamentFormatSchema>;

// ---------------------------------------------------------------------------
// Hub-Foundation — Milestone 6
// ---------------------------------------------------------------------------

// Inline player-ref reused from UserPublicSchema (id, username, avatar_url)
const _H2HPlayerRefSchema = UserPublicSchema.pick({ id: true, username: true, avatar_url: true });

// H2H Response
export const H2HResponseSchema = z.object({
  player_a: _H2HPlayerRefSchema,
  player_b: _H2HPlayerRefSchema,
  summary: z.object({
    a_wins: z.number().int().min(0),
    b_wins: z.number().int().min(0),
    draws: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  winrate_a: z.number().min(0).max(1),
  faction_breakdown: z.array(
    z.object({
      faction_id: z.string(),
      faction_name: z.string(),
      a_wins: z.number().int().min(0),
      b_wins: z.number().int().min(0),
      draws: z.number().int().min(0),
    }),
  ),
  recent_matches: z
    .array(
      z.object({
        id: z.string().uuid(),
        played_at: z.string().datetime().nullable(),
        result: MatchResultTypeSchema.nullable(),
        tournament_slug: z.string().nullable(),
        player_a_faction: z
          .object({ id: z.string(), name: z.string() })
          .nullable(),
        player_b_faction: z
          .object({ id: z.string(), name: z.string() })
          .nullable(),
      }),
    )
    .max(5),
});
export type H2HResponse = z.infer<typeof H2HResponseSchema>;

// Calendar Query — query-string params
export const CalendarQuerySchema = z.object({
  status: TournamentStatusSchema.optional(),
  // NB: z.coerce.boolean() is wrong for query strings — Boolean("false") === true.
  // Accept the literal strings and map explicitly.
  is_major: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

// Calendar Tournament entry
export const CalendarTournamentSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  format: TournamentFormatSchema,
  is_major: z.boolean(),
  status: TournamentStatusSchema,
  timezone: z.string(),
});
export type CalendarTournament = z.infer<typeof CalendarTournamentSchema>;

// Import Log Entry
export const ImportLogEntrySchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  status: z.string(),
  records_imported: z.number().int().min(0),
  error_message: z.string().nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
});
export type ImportLogEntry = z.infer<typeof ImportLogEntrySchema>;

// Import Log List Response — mirrors LeaderboardResponseSchema pagination shape
export const ImportLogListResponseSchema = z.object({
  entries: z.array(ImportLogEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ImportLogListResponse = z.infer<typeof ImportLogListResponseSchema>;
