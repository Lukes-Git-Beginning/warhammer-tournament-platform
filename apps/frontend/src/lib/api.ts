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
} from '@tww3/types';

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

// Minimal local Tournament type (full schema arrives with M1.4 backend)
export interface Tournament {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN' | 'DOUBLE_ELIMINATION';
  mode: 'ONE_V_ONE' | 'TWO_V_TWO';
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
}

export interface TournamentCreate {
  name: string;
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN';
  mode?: 'ONE_V_ONE' | 'TWO_V_TWO';
  start_date: string;
  timezone: string;
  max_participants?: number;
  registration_deadline?: string;
  rules?: string;
  discord_link?: string;
  description?: string;
  draft_enabled?: boolean;
  draft_preset_id?: string;
}

export interface ApiError extends Error {
  status: number;
}

function makeApiError(message: string, status: number): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
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
    throw makeApiError(message, res.status);
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
): Promise<{ data: Tournament[]; total: number; page: number; pageSize: number }> {
  return apiFetch<{ data: Tournament[]; total: number; page: number; pageSize: number }>(
    `/api/tournaments?page=${page}&pageSize=${pageSize}`,
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
