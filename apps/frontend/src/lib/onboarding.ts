import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserMe } from '@rizzotto/types';
import { apiFetch } from './api';
import { useAuthQuery } from './auth';

/**
 * Onboarding is one welcome page (Alex, 2026-10-27): the Discord server and RizzOtto's Arena Mod, then
 * done. It shows to a logged-in player until `onboarded_at` is set; players from before 2026-10-27 were
 * backfilled as onboarded. (The old multi-stage flow with settings and a spotlight tour is gone; the
 * `onboarding_stage` column is no longer used.)
 */
export function useOnboarding() {
  const { data: user } = useAuthQuery();
  const queryClient = useQueryClient();

  const completeMutation = useMutation({
    mutationFn: () =>
      apiFetch<UserMe>('/api/users/me/onboarding-complete', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData<UserMe>(['me'], next);
    },
  });

  return {
    isOpen: !!user && user.onboarded_at === null,
    user: user ?? null,
    complete: () => completeMutation.mutateAsync(),
    isCompleting: completeMutation.isPending,
  };
}

export async function patchMePreferences(input: {
  timezone?: string;
  preferred_factions?: string[];
}): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
