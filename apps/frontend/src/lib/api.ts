import type {
  UserMe,
  BracketResponse,
  LeaderboardResponse,
  LeaderboardEntryDto,
  UserProfileResponse,
} from '@tww3/types';

export type { BracketResponse, LeaderboardResponse, UserProfileResponse };

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
