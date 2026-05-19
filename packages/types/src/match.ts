// Shared Zod schemas for match reporting (Q4/Q12).
// Backend route schemas + frontend mutation payloads share these definitions.

import { z } from 'zod';

export const MatchResultTypeSchema = z.enum([
  'PLAYER1_WIN',
  'PLAYER2_WIN',
  'DRAW',
  'DOUBLE_LOSS',
]);
export type MatchResultType = z.infer<typeof MatchResultTypeSchema>;

export const MatchStatusSchema = z.enum([
  'PENDING',
  'ONGOING',
  'COMPLETED',
  'BYE',
  'FORFEIT',
  'DISPUTED',
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const BracketSideSchema = z.enum(['WINNERS', 'LOSERS', 'GRAND_FINAL']);
export type BracketSide = z.infer<typeof BracketSideSchema>;

export const SubmitMatchReportSchema = z.object({
  result: MatchResultTypeSchema,
  player1_score: z.number().int().min(0).max(10000).nullable().optional(),
  player2_score: z.number().int().min(0).max(10000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type SubmitMatchReportPayload = z.infer<typeof SubmitMatchReportSchema>;

// Admin/organizer override — bypass dual-submit, force a final outcome.
export const OverrideMatchResultSchema = z.object({
  result: MatchResultTypeSchema,
  player1_points: z.number().min(0).max(100).nullable().optional(),
  player2_points: z.number().min(0).max(100).nullable().optional(),
  player1_score: z.number().int().min(0).max(10000).nullable().optional(),
  player2_score: z.number().int().min(0).max(10000).nullable().optional(),
  reason: z.string().min(1).max(2000),
});
export type OverrideMatchResultPayload = z.infer<typeof OverrideMatchResultSchema>;

export const MatchReportDtoSchema = z.object({
  id: z.string().uuid(),
  match_id: z.string().uuid(),
  reporter_id: z.string().uuid(),
  reporter_username: z.string(),
  result: MatchResultTypeSchema,
  player1_score: z.number().int().nullable(),
  player2_score: z.number().int().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type MatchReportDto = z.infer<typeof MatchReportDtoSchema>;

// Lifecycle response after a player submits or after an override resolves.
export const MatchReportingStateSchema = z.enum([
  'AWAITING_REPORTS',
  'AWAITING_OPPONENT',
  'AGREED',
  'DISPUTED',
  'OVERRIDDEN',
]);
export type MatchReportingState = z.infer<typeof MatchReportingStateSchema>;

export const SubmitMatchReportResponseSchema = z.object({
  state: MatchReportingStateSchema,
  match_status: MatchStatusSchema,
  reports: z.array(MatchReportDtoSchema),
});
export type SubmitMatchReportResponse = z.infer<typeof SubmitMatchReportResponseSchema>;

// Q3 — Army-list lock.
export const LockListsResponseSchema = z.object({
  tournament_id: z.string().uuid(),
  locked_at: z.string().datetime(),
  affected_participants: z.number().int(),
});
export type LockListsResponse = z.infer<typeof LockListsResponseSchema>;
