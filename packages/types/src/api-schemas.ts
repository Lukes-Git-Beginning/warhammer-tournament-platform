// Shared Zod schemas for API request/response bodies.

import { z } from 'zod';

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

export const UserMeSchema = UserPublicSchema.extend({
  discord_id: z.string(),
  email: z.string().email().nullable(),
  timezone: z.string().nullable(),
  preferred_factions: z.array(z.string()),
  last_login: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type UserMe = z.infer<typeof UserMeSchema>;

export const UpdateMeSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  preferred_factions: z.array(z.string()).max(24).optional(),
});
export type UpdateMe = z.infer<typeof UpdateMeSchema>;

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
});
export type SeasonSummary = z.infer<typeof SeasonSummarySchema>;

export const LeaderboardEntryDtoSchema = z.object({
  rank: z.number().int(),
  user: z.object({ id: z.string().uuid(), username: z.string(), avatar_url: z.string().url().nullable() }),
  total_points: z.number(),
  elo_rating: z.number().int(),
  matches_played: z.number().int(),
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
      elo_rating: z.number().int(),
      matches_played: z.number().int(),
      wins: z.number().int(),
      losses: z.number().int(),
    })
    .nullable(),
  all_time: z.object({
    matches_played: z.number().int(),
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
