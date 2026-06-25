import type {
  UserMe,
  BracketResponse,
  LeaderboardResponse,
  LeaderboardEntryDto,
  DynamicLeaderboardResponse,
  UserProfileResponse,
  FactionListResponse,
  FactionDetailResponse,
  MetaOverviewResponse,
  MatchupHeatmapResponse,
  DraftPreset,
  CreateDraftPresetRequest,
  UpdateDraftPresetRequest,
  DraftView,
  DraftEventsResponse,
  MatchDetailDto as MatchDetailDtoFromTypes,
  MatchScoringBreakdownDto,
  PlayerOpponentBreakdownDto,
  FactionMatchupMatrixResponse,
  PlayerFactionProficiencyResponse,
} from '@rizzotto/types';

export type {
  BracketResponse,
  LeaderboardResponse,
  DynamicLeaderboardResponse,
  UserProfileResponse,
  FactionListResponse,
  FactionDetailResponse,
  MetaOverviewResponse,
  MatchupHeatmapResponse,
  MatchScoringBreakdownDto,
  PlayerOpponentBreakdownDto,
  FactionMatchupMatrixResponse,
  PlayerFactionProficiencyResponse,
};

export type AllTimeEntry = LeaderboardEntryDto & { seasons_participated: number };

export interface AllTimeLeaderboardResponse {
  entries: AllTimeEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SeasonSummary {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'AUTO_SWISS' | 'ROUND_ROBIN' | 'DOUBLE_ELIMINATION' | 'LIECHTENSTEIN';
  has_third_place_match?: boolean;
  mode: 'ONE_V_ONE' | 'TWO_V_TWO' | 'BPT' | 'SFT' | 'SLT' | 'MATRIX';
  status: 'DRAFT' | 'OPEN_REGISTRATION' | 'REGISTRATION_CLOSED' | 'ONGOING' | 'COMPLETED';
  start_date: string;
  timezone: string;
  max_participants: number | null;
  registration_deadline: string | null;
  rules: string | null;
  discord_link: string | null;
  organizer?: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  participantCount?: number;
  created_at: string;
  is_major?: boolean;
  visibility?: 'PUBLIC' | 'PRIVATE';
  counts_for_leaderboard?: boolean;
  // Welle 2 fields
  rounds_count?: number | null;
  playoff_format?: 'NONE' | 'TOP4' | 'TOP8' | null;
  swiss_match_format?: 'BO1' | 'BO3' | 'BO5' | null;
  playoff_match_format?: 'BO1' | 'BO3' | 'BO5' | null;
  finale_match_format?: 'BO1' | 'BO3' | 'BO5' | null;
  map_decision_mode?: MapDecisionMode | null;
  map_preset_config?: MapPresetConfig | null;
  map_pool?: MapDto[];
  faction_allowlist?: string[];
  restricted_factions?: string[];
}

export type MapDecisionMode = 'RANDOM' | 'PICK_BAN' | 'RANDOM_NO_REPEAT' | 'HOST_PRESET' | 'HOST_PRESET_PICK_BAN' | 'RANDOM_PICK_BAN';
export type MapPresetConfig = Record<string, string[] | string[][]>;

export interface MapDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  deleted_at?: string | null;
}

export type ParticipantStatus = 'REGISTERED' | 'CHECKED_IN' | 'WITHDREW' | 'DISQUALIFIED';

export interface TournamentArmyList {
  id: string;
  user_id: string;
  tournament_id: string;
  screenshot_url: string;
  army_setup_url: string | null;
  locked_at: string;
  revealed_to_opponent_at: string | null;
  revealed_to_all_at: string | null;
}

export interface MatchDecisionState {
  matchId: string;
  mode: MapDecisionMode;
  topPlayerId: string;
  bottomPlayerId: string;
  seed: string;
  bansTop: string[];
  bansBottom: string[];
  activePool: string[];
  pickedMapId: string | null;
  decidedAt: string | null;
  tournamentMode?: string | null;
  matchPlayer1Id?: string | null;
  restrictedFactions?: string[];
  factionAllowlist?: string[];
  blindPick?: {
    player1Locked: boolean;
    player2Locked: boolean;
    revealedAt: string | null;
    firstLockedAt?: string | null;
    player1FactionId: string | null;
    player2FactionId: string | null;
  } | null;
  factionMatrix?: {
    p1Locked: boolean;
    p2Locked: boolean;
    firstLockedAt: string | null;
    revealedAt: string | null;
    p1Factions: string[];
    p2Factions: string[];
    bans: string[];
    pickedCell: string | null;
    lastActionAt: string | null;
    decidedAt: string | null;
    p1FactionId: string | null;
    p2FactionId: string | null;
    topPlayerId: string;
    bottomPlayerId: string;
  } | null;
}

export interface TournamentCreate {
  name: string;
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'SWISS' | 'AUTO_SWISS' | 'ROUND_ROBIN' | 'LIECHTENSTEIN';
  has_third_place_match?: boolean;
  mode?: 'ONE_V_ONE' | 'TWO_V_TWO' | 'BPT' | 'SFT' | 'SLT' | 'MATRIX';
  start_date: string;
  timezone: string;
  max_participants?: number;
  registration_deadline?: string;
  rules?: string;
  discord_link?: string;
  description?: string;
  draft_enabled?: boolean;
  draft_preset_id?: string;
  // Welle 2 fields
  rounds_count?: number;
  playoff_format?: 'NONE' | 'TOP4' | 'TOP8';
  swiss_match_format?: 'BO1' | 'BO3' | 'BO5';
  playoff_match_format?: 'BO1' | 'BO3' | 'BO5';
  finale_match_format?: 'BO1' | 'BO3' | 'BO5';
  map_decision_mode?: MapDecisionMode;
  map_preset_config?: MapPresetConfig | null;
  map_pool?: string[];
  faction_pool?: string[];
}

// Mirror of backend PatchTournamentSchema (apps/backend/src/routes/tournaments.ts).
export interface TournamentPatchInput {
  name?: string;
  description?: string | null;
  rules?: string | null;
  discord_link?: string | null;
  start_date?: string;
  timezone?: string;
  registration_deadline?: string | null;
  max_participants?: number | null;
  visibility?: 'PUBLIC' | 'PRIVATE';
  status?: Tournament['status'];
  draft_enabled?: boolean;
  draft_preset_id?: string | null;
  // draft-only (backend enforces, frontend disables after DRAFT)
  format?: Tournament['format'];
  mode?: 'BPT' | 'SFT' | 'SLT' | 'MATRIX';
  faction_pool?: string[];
  restricted_factions?: string[];
  // until-ongoing fields
  rounds_count?: number;
  playoff_format?: 'NONE' | 'TOP4' | 'TOP8';
  has_third_place_match?: boolean;
  swiss_match_format?: 'BO1' | 'BO3' | 'BO5';
  playoff_match_format?: 'BO1' | 'BO3' | 'BO5';
  finale_match_format?: 'BO1' | 'BO3' | 'BO5';
  map_decision_mode?: MapDecisionMode;
  map_preset_config?: MapPresetConfig | null;
  map_pool?: string[];
  // always-editable metadata
  is_major?: boolean;
  counts_for_leaderboard?: boolean;
}

export interface TournamentPatchResponse {
  id: string;
  slug: string;
  name: string;
  status: Tournament['status'];
  visibility: 'PUBLIC' | 'PRIVATE';
  updated_at: string;
}

export interface ApiError extends Error {
  status: number;
  /** i18n key if the error message was matched to a known backend string */
  i18nKey?: string;
}

function makeApiError(message: string, status: number): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
}

/**
 * Maps known backend error strings to i18n keys in the `errors.*` namespace.
 * Key: exact backend `message` string (case-insensitive match via lowercase).
 * Value: i18n key (without the `errors.` prefix — callers prepend it).
 *
 * Unknown strings fall through as-is (raw message from the server).
 */
const BACKEND_ERROR_MAP: Record<string, string> = {
  'tournament not found': 'errors.not_found',
  'user not found': 'errors.not_found',
  'not found': 'errors.not_found',
  unauthorized: 'errors.unauthorized',
  'not authorized': 'errors.unauthorized',
  forbidden: 'errors.forbidden',
  'access denied': 'errors.forbidden',
  'validation error': 'errors.validation',
  'invalid input': 'errors.validation',
};

/**
 * Looks up a backend error message and returns the i18n key if known.
 * Returns `undefined` for unknown messages (caller should display raw message).
 */
export function getErrorI18nKey(message: string): string | undefined {
  return BACKEND_ERROR_MAP[message.toLowerCase()];
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body. A POST with
  // application/json and no body causes Fastify to reject with FST_ERR_CTP_EMPTY_JSON_BODY.
  const headers: HeadersInit = { ...(init?.headers ?? {}) };
  if (init?.body != null && !(headers as Record<string, string>)['Content-Type']) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore parse errors
    }
    const err = makeApiError(message, res.status);
    err.i18nKey = getErrorI18nKey(message);
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getMe(): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me');
}

export function listTournaments(
  page = 1,
  pageSize = 20,
  status?: Tournament['status'],
  isMajor?: boolean,
): Promise<{ data: Tournament[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set('status', status);
  if (isMajor === true) params.set('is_major', 'true');
  return apiFetch<{ data: Tournament[]; total: number; page: number; pageSize: number }>(
    `/api/tournaments?${params.toString()}`,
  );
}

export function getTournament(slug: string): Promise<Tournament> {
  return apiFetch<Tournament>(`/api/tournaments/${slug}`);
}

export function createTournament(body: TournamentCreate): Promise<Tournament> {
  return apiFetch<Tournament>('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchTournament(
  slug: string,
  body: TournamentPatchInput,
): Promise<TournamentPatchResponse> {
  return apiFetch<TournamentPatchResponse>(`/api/tournaments/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Generates the bracket and transitions to ONGOING. Organizer only; note :id, not :slug. */
export function startTournament(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${id}/start`, {
    method: 'POST',
  });
}

export function resetBracket(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${id}/bracket/reset`, {
    method: 'POST',
  });
}

export function deleteTournament(slug: string): Promise<void> {
  return apiFetch<void>(`/api/tournaments/${slug}`, { method: 'DELETE' });
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function getBracket(slug: string): Promise<BracketResponse> {
  return apiFetch<BracketResponse>(`/api/tournaments/${slug}/bracket`);
}

// Default mode is the dynamic weighted leaderboard ('rating_model', Alex-Spec) —
// derive-on-read shape (playerId/displayName/totalFinalPoints).
// 'winrate' mode is available via getLeaderboardByMode.
export function getLeaderboard(opts?: {
  seasonId?: string;
  page?: number;
  pageSize?: number;
}): Promise<DynamicLeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts?.seasonId) params.set('seasonId', opts.seasonId);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  return apiFetch<DynamicLeaderboardResponse>(`/api/leaderboard${qs ? `?${qs}` : ''}`);
}

export function getAllTimeLeaderboard(opts?: {
  page?: number;
  pageSize?: number;
}): Promise<AllTimeLeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  return apiFetch<AllTimeLeaderboardResponse>(`/api/leaderboard/all-time${qs ? `?${qs}` : ''}`);
}

export function getUserProfile(id: string): Promise<UserProfileResponse> {
  return apiFetch<UserProfileResponse>(`/api/users/${id}`);
}

export function listSeasons(): Promise<{ data: SeasonSummary[] }> {
  return apiFetch<{ data: SeasonSummary[] }>('/api/seasons');
}

export function getFactions(seasonId?: string): Promise<FactionListResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<FactionListResponse>(`/api/factions${qs ? `?${qs}` : ''}`)
    .then((res) => ({
      ...res,
      data: [...res.data].sort((a, b) => a.faction.name.localeCompare(b.faction.name)),
    }));
}

export function getFaction(id: string, seasonId?: string): Promise<FactionDetailResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<FactionDetailResponse>(`/api/factions/${id}${qs ? `?${qs}` : ''}`);
}

export function getMetaOverview(seasonId?: string): Promise<MetaOverviewResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<MetaOverviewResponse>(`/api/meta/overview${qs ? `?${qs}` : ''}`);
}

export function getMatchupHeatmap(seasonId?: string): Promise<MatchupHeatmapResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<MatchupHeatmapResponse>(`/api/meta/matchups${qs ? `?${qs}` : ''}`);
}

export function startNextSwissRound(tournamentId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${tournamentId}/next-round`, {
    method: 'POST',
  });
}

export function startPlayoffs(tournamentId: string): Promise<{ tournamentId: string; format: string; matches_created: number }> {
  return apiFetch(`/api/tournaments/${tournamentId}/start-playoffs`, { method: 'POST' });
}

export function advancePlayoffs(tournamentId: string): Promise<{ phase: string; matches_created: number }> {
  return apiFetch(`/api/tournaments/${tournamentId}/advance-playoffs`, { method: 'POST' });
}

export function addThirdPlaceMatch(tournamentId: string): Promise<{ repaired: boolean }> {
  return apiFetch(`/api/tournaments/${tournamentId}/add-third-place-match`, { method: 'POST' });
}

export function reportMatchResult(
  matchId: string,
  body: {
    winnerId: string;
    score?: string;
    player1FactionId?: string;
    player2FactionId?: string;
    map_id?: string;
  },
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/result`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function overrideMatchResult(
  matchId: string,
  body: {
    result: 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW' | 'DOUBLE_LOSS';
    player1_score?: number;
    player2_score?: number;
    reason?: string;
    map_id?: string;
    player1FactionId?: string;
    player2FactionId?: string;
  },
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/result`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Draft Presets
// ---------------------------------------------------------------------------

export function listDraftPresets(): Promise<DraftPreset[]> {
  return apiFetch<{ presets: DraftPreset[] }>('/api/draft-presets').then((r) => r.presets);
}

export function getDraftPreset(id: string): Promise<DraftPreset> {
  return apiFetch<DraftPreset>(`/api/draft-presets/${id}`);
}

export function createDraftPreset(input: CreateDraftPresetRequest): Promise<DraftPreset> {
  return apiFetch<DraftPreset>('/api/draft-presets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDraftPreset(
  id: string,
  input: UpdateDraftPresetRequest,
): Promise<DraftPreset> {
  return apiFetch<DraftPreset>(`/api/draft-presets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteDraftPreset(id: string): Promise<void> {
  return apiFetch<void>(`/api/draft-presets/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Draft Lobby
// ---------------------------------------------------------------------------

export function getDraftView(id: string): Promise<DraftView> {
  return apiFetch<DraftView>(`/api/drafts/${id}`);
}

export function getDraftEvents(id: string): Promise<DraftEventsResponse> {
  return apiFetch<DraftEventsResponse>(`/api/drafts/${id}/events`);
}

export function cancelDraft(id: string): Promise<void> {
  return apiFetch<void>(`/api/drafts/${id}/cancel`, { method: 'POST' });
}

export function promotePreset(
  id: string,
): Promise<{ id: string; name: string; is_public: boolean }> {
  return apiFetch(`/api/draft-presets/${id}/promote`, { method: 'PATCH' });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export interface AdminStats {
  activeUsers: number;
  tournaments: { total: number; active: number; completed: number };
  gamesPlayed: number;
  currentSeason: string | null;
  topFactions: { faction_id: string; faction_name: string; pick_count: number }[];
  openPlay: { queueDepth: number; activeMatches: number; scheduledAccepted: number };
}

export interface AdminUser {
  id: string;
  username: string;
  discord_id: string;
  steam_id: string | null;
  avatar_url: string | null;
  role: string;
  is_banned: boolean;
  created_at: string;
  email: string | null;
  timezone: string | null;
}

export function getAdminAuditLog(opts?: {
  page?: number;
  pageSize?: number;
  entity_type?: string;
}): Promise<{ entries: AuditLogEntry[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts?.entity_type) params.set('entity_type', opts.entity_type);
  const qs = params.toString();
  return apiFetch(`/api/admin/audit-log${qs ? `?${qs}` : ''}`);
}

export function getAdminStats(): Promise<AdminStats> {
  return apiFetch('/api/admin/stats');
}


export interface AdminMatchRow {
  id: string;
  round: number;
  matchNumber: number;
  status: string;
  result: string | null;
  countsForLeaderboard: boolean;
  playedAt: string | null;
  tournament: { name: string; slug: string; format: string } | null;
  player1: { id: string; username: string } | null;
  player2: { id: string; username: string } | null;
  winner:  { id: string; username: string } | null;
  hasReplay: boolean;
}

export function getAdminMatches(
  page: number,
  filters: { voided?: boolean; tournamentSlug?: string; search?: string } = {},
): Promise<{ matches: AdminMatchRow[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (filters.voided !== undefined) params.set('voided', String(filters.voided));
  if (filters.tournamentSlug) params.set('tournamentSlug', filters.tournamentSlug);
  if (filters.search && filters.search.length >= 2) params.set('search', filters.search);
  return apiFetch(`/api/admin/matches?${params.toString()}`);
}

export function searchUsers(
  search?: string,
  sortBy: 'username' | 'created_at' | 'role' | 'is_banned' = 'username',
  sortDir: 'asc' | 'desc' = 'asc',
): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams();
  if (search && search.length >= 2) params.set('search', search);
  params.set('sortBy', sortBy);
  params.set('sortDir', sortDir);
  params.set('limit', '500');
  return apiFetch(`/api/users?${params.toString()}`);
}

export function banUser(userId: string, reason?: string): Promise<void> {
  return apiFetch(`/api/admin/users/${userId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function unbanUser(userId: string): Promise<void> {
  return apiFetch(`/api/admin/users/${userId}/ban`, { method: 'DELETE' });
}

export function updateUserRole(userId: string, role: string): Promise<{ id: string; role: string }> {
  return apiFetch(`/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

// ---------------------------------------------------------------------------
// Admin — Stats
// ---------------------------------------------------------------------------

export interface FactionWinRateEntry {
  faction_id: string;
  faction_name: string;
  faction_slug: string;
  icon_url: string | null;
  wins: number;
  losses: number;
  win_rate: number;
  sample_size: number;
}

export interface FactionWinRatesResponse {
  data: FactionWinRateEntry[];
  season?: string;
  period?: string;
}

export function getAdminFactionWinRates(opts?: {
  season?: string;
  period?: string;
}): Promise<FactionWinRatesResponse> {
  const params = new URLSearchParams();
  if (opts?.season) params.set('season', opts.season);
  if (opts?.period) params.set('period', opts.period);
  const qs = params.toString();
  return apiFetch(`/api/admin/stats/faction-winrates${qs ? `?${qs}` : ''}`);
}


export interface DropOffFunnelStage {
  label: string;
  count: number;
  drop_pct: number;
}

export interface DropOffFunnelResponse {
  tournament_id?: string;
  tournament_name?: string;
  stages: DropOffFunnelStage[];
}

export function getAdminDropOffFunnel(opts?: {
  tournament_id?: string;
  season?: string;
}): Promise<DropOffFunnelResponse> {
  const params = new URLSearchParams();
  if (opts?.tournament_id) params.set('tournament_id', opts.tournament_id);
  if (opts?.season) params.set('season', opts.season);
  const qs = params.toString();
  return apiFetch(`/api/admin/stats/dropoff-funnel${qs ? `?${qs}` : ''}`);
}

export interface PickBanStatEntry {
  entity_id: string;
  entity_name: string;
  entity_slug: string;
  icon_url: string | null;
  picks: number;
  bans: number;
  win_rate: number;
}

export interface PickBanStatsResponse {
  data: PickBanStatEntry[];
  entity: 'maps' | 'factions';
}

export function getAdminPickBanStats(opts?: {
  season?: string;
  entity?: 'maps' | 'factions';
}): Promise<PickBanStatsResponse> {
  const params = new URLSearchParams();
  if (opts?.season) params.set('season', opts.season);
  if (opts?.entity) params.set('entity', opts.entity);
  const qs = params.toString();
  return apiFetch(`/api/admin/stats/pickban-stats${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Admin — Maps CRUD
// ---------------------------------------------------------------------------

export function getAdminMaps(): Promise<{ data: MapDto[] }> {
  return apiFetch('/api/admin/maps');
}

export function createAdminMap(body: {
  slug: string;
  name: string;
  description?: string;
}): Promise<MapDto> {
  return apiFetch('/api/admin/maps', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateAdminMap(
  id: string,
  body: { name?: string; description?: string },
): Promise<MapDto> {
  return apiFetch(`/api/admin/maps/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteAdminMap(id: string): Promise<void> {
  return apiFetch(`/api/admin/maps/${id}`, { method: 'DELETE' });
}

export async function uploadAdminMapImage(id: string, file: File): Promise<MapDto> {
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch(`/api/admin/maps/${id}/image`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw makeApiError(message, res.status);
  }
  return res.json() as Promise<MapDto>;
}

// ---------------------------------------------------------------------------
// Admin — Factions CRUD
// ---------------------------------------------------------------------------

export interface AdminFactionDto {
  id: string;
  slug: string;
  name: string;
  race: string;
  category: string;
  color_hex: string;
  display_order: number;
  icon_url: string | null;
}

export function getAdminFactions(): Promise<{ data: AdminFactionDto[] }> {
  return apiFetch('/api/admin/factions');
}

export function createAdminFaction(body: {
  slug: string;
  name: string;
  race: string;
  category: string;
  color_hex?: string;
  display_order?: number;
}): Promise<AdminFactionDto> {
  return apiFetch('/api/admin/factions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateAdminFaction(
  id: string,
  body: Partial<{
    name: string;
    race: string;
    category: string;
    color_hex: string;
    display_order: number;
  }>,
): Promise<AdminFactionDto> {
  return apiFetch(`/api/admin/factions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function uploadAdminFactionSigil(id: string, file: File): Promise<AdminFactionDto> {
  const formData = new FormData();
  formData.append('sigil', file);
  const res = await fetch(`/api/admin/factions/${id}/sigil`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw makeApiError(message, res.status);
  }
  return res.json() as Promise<AdminFactionDto>;
}

// ---------------------------------------------------------------------------
// Admin — Config
// ---------------------------------------------------------------------------

export interface AdminConfigEntry {
  key: string;
  value: unknown;
  updated_at: string;
}

export function getAdminConfigAll(): Promise<{ data: AdminConfigEntry[] }> {
  return apiFetch('/api/admin/config/all');
}

export function getAdminConfig(key: string): Promise<AdminConfigEntry> {
  return apiFetch(`/api/admin/config/${key}`);
}

export function putAdminConfig(key: string, value: unknown): Promise<AdminConfigEntry> {
  return apiFetch(`/api/admin/config/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

// ---------------------------------------------------------------------------
// Leaderboard — Extended (mode param)
// ---------------------------------------------------------------------------

export type LeaderboardMode = 'rating_model' | 'winrate';

export interface ExtendedLeaderboardEntry {
  rank: number;
  user: { id: string; username: string; avatar_url: string | null; role: string };
  total_points: number;
  games_played: number;
  wins: number;
  losses: number;
  win_rate?: number;
}

export interface ExtendedLeaderboardResponse {
  mode: LeaderboardMode;
  season?: string;
  entries: ExtendedLeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export function getLeaderboardByMode(opts: {
  mode: LeaderboardMode;
  season?: string;
  page?: number;
  pageSize?: number;
}): Promise<ExtendedLeaderboardResponse> {
  const params = new URLSearchParams({ mode: opts.mode });
  if (opts.season) params.set('season', opts.season);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  return apiFetch(`/api/leaderboard?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// User Stats (personal)
// ---------------------------------------------------------------------------

export interface UserStatsResponse {
  user_id: string;
  season?: string;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  win_rate_trend?: number;
}

export function getUserStats(userId: string, season?: string): Promise<UserStatsResponse> {
  const params = new URLSearchParams();
  if (season) params.set('season', season);
  const qs = params.toString();
  return apiFetch(`/api/users/${userId}/stats${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export function getMaps(): Promise<{ data: MapDto[] }> {
  return apiFetch<{ data: MapDto[] }>('/api/maps');
}

// ---------------------------------------------------------------------------
// Match detail — enriched DTO from GET /api/matches/:id
// ---------------------------------------------------------------------------

// Re-export the shared type so callers can import from here directly.
export type { MatchDetailDtoFromTypes as MatchDetailDto };

export function getMatchDetail(matchId: string): Promise<MatchDetailDtoFromTypes> {
  return apiFetch<MatchDetailDtoFromTypes>(`/api/matches/${matchId}`);
}

export function getMatchScoringBreakdown(matchId: string): Promise<MatchScoringBreakdownDto> {
  return apiFetch<MatchScoringBreakdownDto>(`/api/matches/${matchId}/scoring-breakdown`);
}

export function voidMatch(matchId: string, isVoid: boolean): Promise<{ matchId: string; void: boolean }> {
  return apiFetch(`/api/matches/${matchId}/void`, {
    method: 'PATCH',
    body: JSON.stringify({ void: isVoid }),
  });
}

export function restoreMatch(matchId: string): Promise<{ matchId: string; status: string }> {
  return apiFetch(`/api/matches/${matchId}/restore`, { method: 'POST' });
}

export function cancelMatch(matchId: string): Promise<{ matchId: string; status: string }> {
  return apiFetch(`/api/matches/${matchId}/cancel-match`, { method: 'POST' });
}

export function swapPlayer(
  matchId: string,
  oldPlayerId: string,
  newPlayerId: string,
): Promise<{ ok: true }> {
  return apiFetch(`/api/admin/matches/${matchId}/swap-player`, {
    method: 'PATCH',
    body: JSON.stringify({ oldPlayerId, newPlayerId }),
  });
}

export function createMatchNode(
  slug: string,
  player1Id: string,
  player2Id: string,
  round: number,
): Promise<{ match: { id: string; round: number; match_number: number } }> {
  return apiFetch(`/api/admin/tournaments/${slug}/create-match`, {
    method: 'POST',
    body: JSON.stringify({ player1Id, player2Id, round }),
  });
}

export function deleteMatch(matchId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/admin/matches/${matchId}`, { method: 'DELETE' });
}

export function forfeitMatch(matchId: string, droppedPlayerId: string): Promise<{ ok: true; winnerId: string }> {
  return apiFetch(`/api/admin/matches/${matchId}/forfeit`, {
    method: 'POST',
    body: JSON.stringify({ droppedPlayerId }),
  });
}

export function undropParticipant(
  slug: string,
  userId: string,
): Promise<{ undroped: boolean }> {
  return apiFetch(`/api/tournaments/${slug}/participants/${userId}/undrop`, { method: 'POST' });
}

export function addLateJoiner(
  slug: string,
  userId: string,
): Promise<{ participant: { id: string; status: string; user: { id: string; username: string } } }> {
  return apiFetch(`/api/admin/tournaments/${slug}/add-late`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function setParticipantFaction(
  slug: string,
  userId: string,
  factionId: string,
): Promise<{ participant: { id: string; user_id: string; faction_id: string; status: string } }> {
  return apiFetch(`/api/admin/tournaments/${slug}/participants/${userId}/faction`, {
    method: 'PATCH',
    body: JSON.stringify({ faction_id: factionId }),
  });
}

export function fillByeMatch(
  matchId: string,
  userId: string,
): Promise<{ matchId: string; status: string }> {
  return apiFetch(`/api/matches/${matchId}/fill-bye`, {
    method: 'PATCH',
    body: JSON.stringify({ userId }),
  });
}

/** @deprecated Use getMatchScoringBreakdown instead */
export const getScoringBreakdown = getMatchScoringBreakdown;

// ---------------------------------------------------------------------------
// Explainability — Faction Matchup Matrix (#4)
// ---------------------------------------------------------------------------

export function getMatchupMatrix(seasonId?: string): Promise<FactionMatchupMatrixResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<FactionMatchupMatrixResponse>(`/api/factions/matchup-matrix${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Explainability — Player Faction Proficiency (#5)
// ---------------------------------------------------------------------------

export function getPlayerFactionProficiency(
  playerId: string,
  seasonId?: string,
): Promise<PlayerFactionProficiencyResponse> {
  const params = new URLSearchParams();
  if (seasonId) params.set('seasonId', seasonId);
  const qs = params.toString();
  return apiFetch<PlayerFactionProficiencyResponse>(
    `/api/players/${playerId}/faction-proficiency${qs ? `?${qs}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Explainability — Anti-Farming Breakdown (#3)
// ---------------------------------------------------------------------------

export function getAntiFarmingBreakdown(
  playerId: string,
  opponentId: string,
  seasonId?: string,
): Promise<PlayerOpponentBreakdownDto> {
  const params = new URLSearchParams({ playerId, opponentId });
  if (seasonId) params.set('seasonId', seasonId);
  return apiFetch<PlayerOpponentBreakdownDto>(`/api/leaderboard/anti-farming?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Match Decision
// ---------------------------------------------------------------------------

export function startMatchDecision(matchId: string, gameNumber = 1): Promise<MatchDecisionState> {
  const params = gameNumber > 1 ? `?gameNumber=${gameNumber}` : '';
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/start${params}`, {
    method: 'POST',
  });
}

export function banMap(matchId: string, mapId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/ban`, {
    method: 'POST',
    body: JSON.stringify({ map_id: mapId }),
  });
}

export function randomPickMap(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/random`, {
    method: 'POST',
  });
}

export function lockBlindPick(matchId: string, factionId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/decision/blind-pick/lock`, {
    method: 'POST',
    body: JSON.stringify({ faction_id: factionId }),
  });
}

export function lockFactionMatrix(matchId: string, factions: string[]): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/matrix/lock`, {
    method: 'POST',
    body: JSON.stringify({ factions }),
  });
}

export function banMatrixCell(matchId: string, row: number, col: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/matrix/ban`, {
    method: 'POST',
    body: JSON.stringify({ row, col }),
  });
}

export function getMatchDecision(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision`);
}

export function forceResolveDecision(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/force-resolve`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Match Games
// ---------------------------------------------------------------------------

export interface GameDto {
  id: string | null;
  gameNumber: number;
  status: string;
  winnerId: string | null;
  player1FactionId: string | null;
  player2FactionId: string | null;
  lobbyCode: string | null;
  reportedWinnerId: string | null;
  reporterId: string | null;
  reportedAt: string | null;
  confirmedAt: string | null;
  replayUrl: string | null;
  playedAt: string | null;
  decision: MatchDecisionState | null;
  blindPick: {
    player1Locked: boolean;
    player2Locked: boolean;
    revealedAt: string | null;
    player1FactionId: string | null;
    player2FactionId: string | null;
  } | null;
}

export function getMatchGames(matchId: string): Promise<{ games: GameDto[] }> {
  return apiFetch<{ games: GameDto[] }>(`/api/matches/${matchId}/games`);
}

export function setLobbyCode(
  matchId: string,
  gameNumber: number,
  lobbyCode: string | null,
): Promise<{ ok: true; lobby_code: string | null }> {
  return apiFetch(`/api/matches/${matchId}/games/${gameNumber}/lobby-code`, {
    method: 'PATCH',
    body: JSON.stringify({ lobby_code: lobbyCode }),
  });
}

export async function reportGameResult(
  matchId: string,
  gameNumber: number,
  winnerId: string,
  replayFile?: File,
): Promise<{ provisional?: boolean; confirmed?: boolean; disputed?: boolean; winnerId?: string; autoConfirmsAt?: string }> {
  const form = new FormData();
  form.append('winner_id', winnerId);
  if (replayFile) form.append('replay', replayFile);

  const res = await fetch(`/api/matches/${matchId}/games/${gameNumber}/result`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? res.statusText);
  }
  return res.json() as Promise<{ provisional?: boolean; confirmed?: boolean; disputed?: boolean; winnerId?: string; autoConfirmsAt?: string }>;
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export function selfCheckIn(slug: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${slug}/checkin/self`, {
    method: 'POST',
  });
}

export function adminCheckIn(slug: string, userId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${slug}/checkin`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

// ---------------------------------------------------------------------------
// Army Lists
// ---------------------------------------------------------------------------

export async function uploadArmyList(
  slug: string,
  screenshot: File,
  armySetup?: File | null,
): Promise<TournamentArmyList> {
  const formData = new FormData();
  formData.append('screenshot', screenshot);
  if (armySetup) formData.append('army_setup', armySetup);

  const res = await fetch(`/api/tournaments/${slug}/army-list`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore
    }
    const err = makeApiError(message, res.status);
    err.i18nKey = getErrorI18nKey(message);
    throw err;
  }
  return res.json() as Promise<TournamentArmyList>;
}

export function getMyArmyList(slug: string): Promise<TournamentArmyList | null> {
  return apiFetch<TournamentArmyList | null>(`/api/tournaments/${slug}/army-list/me`);
}

export function getOpponentArmyList(
  slug: string,
  opponentUserId: string,
): Promise<TournamentArmyList> {
  return apiFetch<TournamentArmyList>(`/api/tournaments/${slug}/army-list/${opponentUserId}`);
}

export function getAllArmyLists(slug: string): Promise<{ data: TournamentArmyList[] }> {
  return apiFetch<{ data: TournamentArmyList[] }>(`/api/tournaments/${slug}/army-list/all`);
}

// ---------------------------------------------------------------------------
// Tournament-specific Map Pool
// ---------------------------------------------------------------------------

export function getTournamentMaps(slug: string): Promise<{ data: MapDto[] }> {
  return apiFetch<{ data: MapDto[] }>(`/api/tournaments/${slug}/maps`);
}

// ---------------------------------------------------------------------------
// Participant Me
// ---------------------------------------------------------------------------

export interface ParticipantMeResponse {
  status: ParticipantStatus | null;
  registered_at?: string;
  faction_id?: string | null;
  checked_in_at?: string | null;
}

export function getParticipantMe(slug: string): Promise<ParticipantMeResponse> {
  return apiFetch<ParticipantMeResponse>(`/api/tournaments/${slug}/participants/me`);
}

export interface TournamentParticipantEntry {
  id: string;
  status: ParticipantStatus;
  registered_at: string;
  lists_locked_at: string | null;
  user: { id: string; username: string; avatar_url: string | null };
  faction: { id: string; name: string; color_hex: string } | null;
}

export interface TournamentParticipantsResponse {
  data: TournamentParticipantEntry[];
  total: number;
}

export function getParticipants(slug: string): Promise<TournamentParticipantsResponse> {
  return apiFetch<TournamentParticipantsResponse>(`/api/tournaments/${slug}/participants`);
}

export function registerForTournament(
  slug: string,
  opts?: { factionId?: string },
): Promise<{ id: string; status: ParticipantStatus }> {
  return apiFetch<{ id: string; status: ParticipantStatus }>(
    `/api/tournaments/${slug}/register`,
    { method: 'POST', body: JSON.stringify({ faction_id: opts?.factionId }) },
  );
}

export function withdrawFromTournament(slug: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/api/tournaments/${slug}/withdraw`, { method: 'POST' });
}

export function dropParticipant(
  slug: string,
  userId: string,
): Promise<{ dropped: boolean; matchesForfeited: number; gamesVoided: number }> {
  return apiFetch(`/api/tournaments/${slug}/participants/${userId}/drop`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Game History
// ---------------------------------------------------------------------------

export type { GameHistoryEntry } from '@rizzotto/types';
import type { GameHistoryEntry } from '@rizzotto/types';

export function getTournamentGames(slug: string): Promise<{ games: GameHistoryEntry[] }> {
  return apiFetch<{ games: GameHistoryEntry[]; total: number; page: number; limit: number }>(
    `/api/meta/games?tournamentSlug=${encodeURIComponent(slug)}&limit=100`,
  );
}

export function getMetaGames(page = 1, limit = 50): Promise<{ games: GameHistoryEntry[]; total: number; page: number; limit: number }> {
  return apiFetch<{ games: GameHistoryEntry[]; total: number; page: number; limit: number }>(`/api/meta/games?page=${page}&limit=${limit}`);
}

export function getFactionGames(factionId: string, page = 1, limit = 30): Promise<{ games: GameHistoryEntry[]; total: number }> {
  return apiFetch<{ games: GameHistoryEntry[]; total: number }>(`/api/meta/games?factionId=${encodeURIComponent(factionId)}&page=${page}&limit=${limit}`);
}

export function getUserGames(userId: string, page = 1, limit = 20): Promise<{ games: GameHistoryEntry[]; total: number }> {
  return apiFetch<{ games: GameHistoryEntry[]; total: number }>(`/api/meta/games?playerId=${encodeURIComponent(userId)}&page=${page}&limit=${limit}`);
}

export type FactionTopPlayer = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  games: number;
  wins: number;
  winRate: number | null;
};

export function getFactionTopPlayers(factionId: string): Promise<{ players: FactionTopPlayer[] }> {
  return apiFetch<{ players: FactionTopPlayer[] }>(`/api/factions/${encodeURIComponent(factionId)}/top-players`);
}

// ---------------------------------------------------------------------------
// M8 Open Play
// ---------------------------------------------------------------------------

export type AvailabilityContext = 'TOURNAMENT' | 'MATCHMAKING';
export type MatchFormat = 'BO1' | 'BO3' | 'BO5';

export interface AvailabilitySlot {
  id?: string;
  day_of_week: number;
  hour_utc: number;
  context: AvailabilityContext;
}

export interface HeatmapSlot {
  day_of_week: number;
  hour_utc: number;
  count: number;
}

export interface ScheduledMatchup {
  id: string;
  format: MatchFormat;
  proposed_at: string;
  notes: string | null;
  proposer: { id: string; username: string; avatar_url: string | null } | null;
  anonymous: boolean;
  created_at: string;
  expires_at: string;
}

export function getAvailabilityHeatmap(): Promise<{ slots: HeatmapSlot[] }> {
  return apiFetch<{ slots: HeatmapSlot[] }>('/api/availability/heatmap');
}

export function getMyAvailability(): Promise<{ slots: AvailabilitySlot[] }> {
  return apiFetch<{ slots: AvailabilitySlot[] }>('/api/availability/me');
}

export function setMyAvailability(slots: Omit<AvailabilitySlot, 'id'>[]): Promise<{ slots: AvailabilitySlot[] }> {
  return apiFetch<{ slots: AvailabilitySlot[] }>('/api/availability/slots', {
    method: 'PUT',
    body: JSON.stringify({ slots }),
  });
}

export function getScheduledMatchups(params?: { format?: MatchFormat; page?: number }): Promise<{ matchups: ScheduledMatchup[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params?.format) q.set('format', params.format);
  if (params?.page) q.set('page', String(params.page));
  return apiFetch<{ matchups: ScheduledMatchup[]; total: number; page: number }>(`/api/scheduled-matchups?${q.toString()}`);
}

export function createScheduledMatchup(data: {
  format: MatchFormat;
  proposed_at: string;
  notes?: string;
  anonymous?: boolean;
  expires_in_hours?: number;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/api/scheduled-matchups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function acceptScheduledMatchup(id: string): Promise<{ accepted: boolean; proposed_at: string }> {
  return apiFetch<{ accepted: boolean; proposed_at: string }>(`/api/scheduled-matchups/${id}/accept`, { method: 'POST' });
}

export function cancelScheduledMatchup(id: string): Promise<void> {
  return apiFetch<void>(`/api/scheduled-matchups/${id}`, { method: 'DELETE' });
}

export type AdminScheduledMatchup = {
  id: string;
  format: string;
  proposed_at: string;
  expires_at: string;
  created_at: string;
  status: 'OPEN' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
  notes: string | null;
  match_id: string | null;
  proposer: { id: string; username: string; avatar_url: string | null };
  accepted_by: { id: string; username: string; avatar_url: string | null } | null;
};

export function getAdminScheduledMatchups(params?: {
  status?: 'OPEN' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
  page?: number;
}): Promise<{ matchups: AdminScheduledMatchup[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  const qs = q.toString();
  return apiFetch(`/api/admin/scheduled-matchups${qs ? `?${qs}` : ''}`);
}

export function adminCancelScheduledMatchup(id: string): Promise<void> {
  return apiFetch<void>(`/api/admin/scheduled-matchups/${id}`, { method: 'DELETE' });
}

export type AntiFarmingOpponent = {
  id: string;
  username: string;
  avatar_url: string | null;
  wins: number;
  share: number;
  modifier: number;
};

export function getPlayerAntiFarming(playerId: string, seasonId?: string): Promise<{
  opponents: AntiFarmingOpponent[];
  playerTotalWins: number;
  penaltyActive: boolean;
}> {
  const q = seasonId ? `?seasonId=${seasonId}` : '';
  return apiFetch(`/api/admin/users/${playerId}/anti-farming${q}`);
}

export function joinQueue(): Promise<{ matched: boolean; match_id?: string; position?: number }> {
  return apiFetch<{ matched: boolean; match_id?: string; position?: number }>('/api/open-play/queue', {
    method: 'POST',
  });
}

export function leaveQueue(): Promise<void> {
  return apiFetch<void>('/api/open-play/queue', { method: 'DELETE' });
}

export function getQueueStatus(): Promise<{ inQueue: boolean; position: number | null; total: number }> {
  return apiFetch<{ inQueue: boolean; position: number | null; total: number }>('/api/open-play/queue/status');
}

export function getAvailabilityNow(): Promise<{ count: number; day_of_week: number; hour_utc: number }> {
  return apiFetch<{ count: number; day_of_week: number; hour_utc: number }>('/api/availability/now');
}

export function cancelOpenPlayMatch(matchId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/open-play/matches/${matchId}/cancel`, { method: 'POST' });
}

export interface AdminOpenPlayMember {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface AdminOpenPlayMatch {
  id: string;
  status: string;
  player1: { id: string; name: string } | null;
  player2: { id: string; name: string } | null;
  createdAt: string;
}

export function getAdminOpenPlayQueue(): Promise<{ members: AdminOpenPlayMember[] }> {
  return apiFetch<{ members: AdminOpenPlayMember[] }>('/api/admin/open-play/queue');
}

export function getAdminOpenPlayActiveMatches(): Promise<{ matches: AdminOpenPlayMatch[] }> {
  return apiFetch<{ matches: AdminOpenPlayMatch[] }>('/api/admin/open-play/active-matches');
}

export function getMyOpenPlayMatch(): Promise<{ match_id: string | null }> {
  return apiFetch<{ match_id: string | null }>('/api/open-play/my-match');
}

export function getEligibleOwners(): Promise<{ id: string; username: string; avatar_url: string | null; role: string }[]> {
  return apiFetch('/api/users/eligible-owners');
}

export function transferTournamentOwner(slug: string, organizer_id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tournaments/${slug}/transfer-owner`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizer_id }),
  });
}

// --- Co-hosts -------------------------------------------------------------
export type CoHostUser = { id: string; username: string; avatar_url: string | null };

export function getTournamentCoHosts(slug: string): Promise<CoHostUser[]> {
  return apiFetch(`/api/tournaments/${slug}/co-hosts`);
}

export function searchCoHostCandidates(slug: string, q: string): Promise<CoHostUser[]> {
  return apiFetch(`/api/tournaments/${slug}/co-host-candidates?q=${encodeURIComponent(q)}`);
}

export function addTournamentCoHost(slug: string, user_id: string): Promise<CoHostUser> {
  return apiFetch(`/api/tournaments/${slug}/co-hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id }),
  });
}

export function removeTournamentCoHost(slug: string, userId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tournaments/${slug}/co-hosts/${userId}`, { method: 'DELETE' });
}
