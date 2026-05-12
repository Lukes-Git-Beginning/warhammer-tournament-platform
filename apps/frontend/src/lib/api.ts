import type { UserMe } from '@tww3/types';

// Minimal local Tournament type (full schema arrives with M1.4 backend)
export interface Tournament {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN';
  mode: 'ONE_V_ONE' | 'TWO_V_TWO';
  status: 'DRAFT' | 'REGISTRATION' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
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
): Promise<{ items: Tournament[]; total: number }> {
  return apiFetch<{ items: Tournament[]; total: number }>(
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
