// Shared Zod schemas for match reporting (Q4/Q12).
// Backend route schemas + frontend mutation payloads share these definitions.

import { z } from 'zod';

export const MatchResultTypeSchema = z.enum(['PLAYER1_WIN', 'PLAYER2_WIN', 'DRAW', 'DOUBLE_LOSS']);
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
  map_id: z.string().min(1).optional(),
  player1FactionId: z.string().min(1).optional(),
  player2FactionId: z.string().min(1).optional(),
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

// ---------------------------------------------------------------------------
// Match Detail DTO — enriched response for GET /api/matches/:id
// Includes player refs, faction refs, scoring fields, and timing.
// ---------------------------------------------------------------------------

export const MatchPlayerRefSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  avatar_url: z.string().url().nullable(),
});
export type MatchPlayerRef = z.infer<typeof MatchPlayerRefSchema>;

export const MatchFactionRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon_url: z.string().url().nullable(),
});
export type MatchFactionRef = z.infer<typeof MatchFactionRefSchema>;

export const MatchPhaseSchema = z.enum([
  'GROUP_STAGE',
  'SWISS',
  'PLAYOFF_QF',
  'PLAYOFF_SF',
  'PLAYOFF_FINAL',
]);
export type MatchPhase = z.infer<typeof MatchPhaseSchema>;

export const MatchDetailDtoSchema = z.object({
  id: z.string().uuid(),
  tournament_id: z.string().uuid(),
  tournament_slug: z.string(),
  round: z.number().int(),
  match_number: z.number().int(),
  status: MatchStatusSchema,
  result: MatchResultTypeSchema.nullable(),
  phase: MatchPhaseSchema.nullable(),
  bracket_side: BracketSideSchema.nullable(),
  scheduled_time: z.string().datetime().nullable(),
  played_at: z.string().datetime().nullable(),
  score: z.string().nullable(),
  player1_points: z.number().nullable(),
  player2_points: z.number().nullable(),
  // Raw ID fields — preserved for backwards compatibility
  player1_id: z.string().uuid().nullable(),
  player2_id: z.string().uuid().nullable(),
  winner_id: z.string().uuid().nullable(),
  player1_faction_id: z.string().nullable(),
  player2_faction_id: z.string().nullable(),
  // Enriched relations
  player1: MatchPlayerRefSchema.nullable(),
  player2: MatchPlayerRefSchema.nullable(),
  winner: MatchPlayerRefSchema.nullable(),
  player1_faction: MatchFactionRefSchema.nullable(),
  player2_faction: MatchFactionRefSchema.nullable(),
});
export type MatchDetailDto = z.infer<typeof MatchDetailDtoSchema>;

// ---------------------------------------------------------------------------
// Game History — one row per MatchGame (or synthetic row for legacy matches)
// ---------------------------------------------------------------------------

export interface GameHistoryPlayer {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface GameHistoryTournament {
  id: string;
  name: string;
  slug: string;
}

export interface GameHistoryEntry {
  /** MatchGame.id for real records; Match.id for synthetic legacy rows */
  id: string;
  gameNumber: number;
  matchId: string;
  round: number;
  matchNumber: number;
  playedAt: string | null;
  player1: GameHistoryPlayer | null;
  player2: GameHistoryPlayer | null;
  winnerId: string | null;
  player1FactionId: string | null;
  player2FactionId: string | null;
  mapName: string | null;
  replayUrl: string | null;
  countsForLeaderboard?: boolean;
  tournament?: GameHistoryTournament;
}
