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
