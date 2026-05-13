// Shared Zod schemas for Draft system (M4).
// Mirrors prisma models DraftPreset, Draft, DraftEvent.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain types — Preset / Turn / CategoryLimit
// ---------------------------------------------------------------------------

export const ActorSchema = z.enum(['host', 'guest', 'admin']);
export type Actor = z.infer<typeof ActorSchema>;

export const ActorOrSystemSchema = z.enum(['host', 'guest', 'admin', 'system']);
export type ActorOrSystem = z.infer<typeof ActorOrSystemSchema>;

export const DraftActionSchema = z.enum([
  'pick',
  'ban',
  'snipe',
  'steal',
  'reveal_picks',
  'reveal_bans',
  'reveal_all',
]);
export type DraftAction = z.infer<typeof DraftActionSchema>;

export const DraftActionExtendedSchema = z.enum([
  'pick',
  'ban',
  'snipe',
  'steal',
  'reveal_picks',
  'reveal_bans',
  'reveal_all',
  'auto_select',
  'start',
  'complete',
  'cancel',
]);
export type DraftActionExtended = z.infer<typeof DraftActionExtendedSchema>;

export const DraftVariantSchema = z.enum(['global', 'exclusive', 'nonexclusive']).nullable();
export type DraftVariant = z.infer<typeof DraftVariantSchema>;

export const CategoryLimitSchema = z.object({
  category_name: z.string().min(1).max(64),
  factions: z.array(z.string().min(1)).min(0).max(24),
  max_picks: z.number().int().nonnegative().nullable(),
  max_bans: z.number().int().nonnegative().nullable(),
});
export type CategoryLimit = z.infer<typeof CategoryLimitSchema>;

export const DraftTurnSchema = z.object({
  order: z.number().int().nonnegative(),
  actor: ActorSchema,
  action: DraftActionSchema,
  variant: DraftVariantSchema,
  is_hidden: z.boolean(),
  is_parallel: z.boolean(),
  as_opponent: z.boolean(),
  category: z.string().min(1).max(64).default('default'),
});
export type DraftTurn = z.infer<typeof DraftTurnSchema>;

// ---------------------------------------------------------------------------
// Draft state — runtime shape stored in Redis + Draft.state JSON
// ---------------------------------------------------------------------------

const HostGuestArraySchema = z.object({
  host: z.array(z.string()),
  guest: z.array(z.string()),
});

const HostGuestNullableSchema = z.object({
  host: z.string().nullable(),
  guest: z.string().nullable(),
});

/**
 * Context passed to the pure state-machine functions.
 * Decouples the engine from DB/Redis — caller provides the faction list and
 * category limits that the engine needs for available-calculation.
 */
export const ApplyContextSchema = z.object({
  allFactions: z.array(z.string()),
  categoryLimits: z.array(CategoryLimitSchema),
});
export type ApplyContext = z.infer<typeof ApplyContextSchema>;

export const DraftStateSchema = z.object({
  picks: HostGuestArraySchema,
  bans: z.array(z.string()),
  exclusive_bans: HostGuestArraySchema,
  hidden_picks: HostGuestArraySchema,
  hidden_bans: HostGuestArraySchema,
  parallel_pending: HostGuestNullableSchema,
  /**
   * Parallel variant-tracking arrays for hidden picks/bans.
   * Index i in hidden_picks[actor] maps to index i in hidden_pick_variants[actor].
   * Required so that reveal_picks/reveal_bans can correctly re-apply the variant
   * effects (global→bans.push, exclusive→exclusive_bans.push) that were deferred
   * when the hidden action was first executed.
   */
  hidden_pick_variants: HostGuestArraySchema,
  hidden_ban_variants: HostGuestArraySchema,
});
export type DraftState = z.infer<typeof DraftStateSchema>;

/** Public view of DraftState — opponent's hidden arrays are masked to placeholder count. */
export const PublicDraftStateSchema = DraftStateSchema;
export type PublicDraftState = z.infer<typeof PublicDraftStateSchema>;

// ---------------------------------------------------------------------------
// Preset CRUD DTOs
// ---------------------------------------------------------------------------

export const DraftPresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  created_by: z.string().uuid(),
  is_public: z.boolean(),
  category_limits: z.array(CategoryLimitSchema),
  turns: z.array(DraftTurnSchema).min(1).max(100),
  turn_seconds: z.number().int().min(5).max(600),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DraftPreset = z.infer<typeof DraftPresetSchema>;

export const CreateDraftPresetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  is_public: z.boolean().default(false),
  category_limits: z.array(CategoryLimitSchema).default([]),
  turns: z.array(DraftTurnSchema).min(1).max(100),
  turn_seconds: z.number().int().min(5).max(600).default(30),
});
export type CreateDraftPresetRequest = z.infer<typeof CreateDraftPresetSchema>;

export const UpdateDraftPresetSchema = CreateDraftPresetSchema.partial();
export type UpdateDraftPresetRequest = z.infer<typeof UpdateDraftPresetSchema>;

export const DraftPresetListResponseSchema = z.object({
  presets: z.array(DraftPresetSchema),
});
export type DraftPresetListResponse = z.infer<typeof DraftPresetListResponseSchema>;

// ---------------------------------------------------------------------------
// Draft view / events DTOs
// ---------------------------------------------------------------------------

export const DraftStatusSchema = z.enum(['PENDING', 'ONGOING', 'COMPLETED', 'CANCELLED']);
export type DraftStatusLiteral = z.infer<typeof DraftStatusSchema>;

export const DraftViewSchema = z.object({
  id: z.string().uuid(),
  match_id: z.string().uuid(),
  preset_id: z.string().uuid(),
  preset: DraftPresetSchema,
  status: DraftStatusSchema,
  current_turn: z.number().int().nonnegative(),
  state: PublicDraftStateSchema,
  timer_expires_at: z.string().datetime().nullable(),
  host_user_id: z.string().uuid().nullable(),
  guest_user_id: z.string().uuid().nullable(),
  completed_at: z.string().datetime().nullable(),
  final_host_factions: z.array(z.string()),
  final_guest_factions: z.array(z.string()),
  viewer_role: z.enum(['host', 'guest', 'spectator', 'admin']),
});
export type DraftView = z.infer<typeof DraftViewSchema>;

export const DraftEventDtoSchema = z.object({
  id: z.string().uuid(),
  draft_id: z.string().uuid(),
  turn_index: z.number().int().nonnegative(),
  actor: ActorOrSystemSchema,
  action: DraftActionExtendedSchema,
  faction_id: z.string().nullable(),
  is_auto_selected: z.boolean(),
  payload: z.unknown().nullable(),
  created_at: z.string().datetime(),
});
export type DraftEventDto = z.infer<typeof DraftEventDtoSchema>;

export const DraftEventsResponseSchema = z.object({
  events: z.array(DraftEventDtoSchema),
});
export type DraftEventsResponse = z.infer<typeof DraftEventsResponseSchema>;

// ---------------------------------------------------------------------------
// Match start endpoint
// ---------------------------------------------------------------------------

export const StartMatchResponseSchema = z.object({
  match_id: z.string().uuid(),
  status: z.literal('ONGOING'),
  draft_id: z.string().uuid().nullable(),
});
export type StartMatchResponse = z.infer<typeof StartMatchResponseSchema>;
