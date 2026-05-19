import type {
  UserMe,
  BracketResponse,
  LeaderboardResponse,
  LeaderboardEntryDto,
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
} from '@rizzotto/types';

export type {
  BracketResponse,
  LeaderboardResponse,
  UserProfileResponse,
  FactionListResponse,
  FactionDetailResponse,
  MetaOverviewResponse,
  MatchupHeatmapResponse,
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
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN' | 'DOUBLE_ELIMINATION';
  mode: 'ONE_V_ONE' | 'TWO_V_TWO' | 'OPEN' | 'BPT' | 'SFT' | 'SLT';
  status:
    | 'DRAFT'
    | 'OPEN_REGISTRATION'
    | 'REGISTRATION_CLOSED'
    | 'ONGOING'
    | 'COMPLETED';
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
  // Welle 2 fields
  rounds_count?: number | null;
  playoff_format?: 'NONE' | 'TOP4' | 'TOP8' | null;
  swiss_match_format?: 'BO1' | 'BO3' | null;
  playoff_match_format?: 'BO3' | 'BO5' | null;
  finale_match_format?: 'BO3' | 'BO5' | null;
  map_decision_mode?: 'RANDOM' | 'PICK_BAN' | null;
  map_pool?: MapDto[];
}

export interface MapDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  deleted_at?: string | null;
}

export type ParticipantStatus = 'REGISTERED' | 'CHECKED_IN' | 'WITHDRAWN' | 'DISQUALIFIED';

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
  mode: 'RANDOM' | 'PICK_BAN';
  topPlayerId: string;
  bottomPlayerId: string;
  seed: string;
  bansTop: string[];
  bansBottom: string[];
  pickedMapId: string | null;
  decidedAt: string | null;
  blindPick?: {
    player1Locked: boolean;
    player2Locked: boolean;
    revealedAt: string | null;
    player1FactionId: string | null;
    player2FactionId: string | null;
  } | null;
}

export interface TournamentCreate {
  name: string;
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN';
  mode?: 'ONE_V_ONE' | 'TWO_V_TWO' | 'OPEN' | 'BPT' | 'SFT' | 'SLT';
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
  swiss_match_format?: 'BO1' | 'BO3';
  playoff_match_format?: 'BO3' | 'BO5';
  finale_match_format?: 'BO3' | 'BO5';
  map_decision_mode?: 'RANDOM' | 'PICK_BAN';
  map_pool?: string[];
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
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
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
): Promise<{ data: Tournament[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set('status', status);
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

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function getBracket(slug: string): Promise<BracketResponse> {
  return apiFetch<BracketResponse>(`/api/tournaments/${slug}/bracket`);
}

export function getLeaderboard(opts?: {
  seasonId?: string;
  page?: number;
  pageSize?: number;
}): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts?.seasonId) params.set('seasonId', opts.seasonId);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  return apiFetch<LeaderboardResponse>(`/api/leaderboard${qs ? `?${qs}` : ''}`);
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
  return apiFetch<FactionListResponse>(`/api/factions${qs ? `?${qs}` : ''}`);
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

export function reportMatchResult(
  matchId: string,
  body: {
    winnerId: string;
    score?: string;
    player1FactionId?: string;
    player2FactionId?: string;
  },
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/result`, {
    method: 'POST',
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

export function promotePreset(id: string): Promise<{ id: string; name: string; is_public: boolean }> {
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
  actor_id: string;
  actor_username: string | null;
  actor_avatar_url: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export interface AdminStats {
  activeUsers: number;
  tournaments: { total: number; active: number; completed: number };
  matchesPlayed: number;
  currentSeason: string | null;
  topFactions: { faction_id: string; faction_name: string; pick_count: number }[];
}

export interface AdminUser {
  id: string;
  username: string;
  discord_id: string;
  avatar_url: string | null;
  role: string;
  is_banned: boolean;
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

export function searchUsers(search: string): Promise<{ users: AdminUser[] }> {
  const params = new URLSearchParams({ search });
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

export interface EloDistributionBucket {
  bucket: number;
  count: number;
}

export interface EloDistributionResponse {
  buckets: EloDistributionBucket[];
  median: number;
  p1: number;
  p99: number;
  total: number;
}

export function getAdminEloDistribution(opts?: {
  season?: string;
}): Promise<EloDistributionResponse> {
  const params = new URLSearchParams();
  if (opts?.season) params.set('season', opts.season);
  const qs = params.toString();
  return apiFetch(`/api/admin/stats/elo-distribution${qs ? `?${qs}` : ''}`);
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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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

export type LeaderboardMode = 'season_points' | 'winrate' | 'weighted_winrate';

export interface ExtendedLeaderboardEntry {
  rank: number;
  user: { id: string; username: string; avatar_url: string | null; role: string };
  total_points: number;
  elo_rating: number;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate?: number;
  weighted_win_rate?: number;
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

export interface UserFactionWinRate {
  faction_id: string;
  faction_name: string;
  icon_url: string | null;
  games_played: number;
  wins: number;
  win_rate: number;
  is_tt_data: boolean;
}

export interface UserFactionMastery {
  faction_id: string;
  faction_name: string;
  icon_url: string | null;
  mastery_rating: number;
}

export interface EloHistoryEntry {
  date: string;
  elo: number;
}

export interface UserStatsResponse {
  user_id: string;
  season?: string;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  win_rate_trend?: number;
  elo_history: EloHistoryEntry[];
  per_faction_winrate: UserFactionWinRate[];
  faction_mastery_top5?: UserFactionMastery[];
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
// Match detail (lightweight — for retrieving tournament_slug from a match)
// ---------------------------------------------------------------------------

export interface MatchDetailDto {
  id: string;
  tournament_id: string;
  tournament_slug: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  status: string;
}

export function getMatchDetail(matchId: string): Promise<MatchDetailDto> {
  return apiFetch<MatchDetailDto>(`/api/matches/${matchId}`);
}

// ---------------------------------------------------------------------------
// Match Decision
// ---------------------------------------------------------------------------

export function startMatchDecision(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/start`, {
    method: 'POST',
  });
}

export function banMap(matchId: string, mapId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/ban`, {
    method: 'POST',
    body: JSON.stringify({ mapId }),
  });
}

export function randomPickMap(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision/random`, {
    method: 'POST',
  });
}

export function lockBlindPick(matchId: string, factionId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/matches/${matchId}/blind-pick/lock`, {
    method: 'POST',
    body: JSON.stringify({ factionId }),
  });
}

export function getMatchDecision(matchId: string): Promise<MatchDecisionState> {
  return apiFetch<MatchDecisionState>(`/api/matches/${matchId}/decision`);
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export function selfCheckIn(slug: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/tournaments/${slug}/checkin/self`, {
    method: 'POST',
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
  return apiFetch<TournamentArmyList>(
    `/api/tournaments/${slug}/army-list/${opponentUserId}`,
  );
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
