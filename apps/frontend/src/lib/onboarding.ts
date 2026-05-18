import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserMe } from '@rizzotto/types';
import { apiFetch } from './api';
import { useAuthQuery } from './auth';

export type OnboardingStage = 0 | 1 | 2 | 3 | 4;
export const ONBOARDING_STAGE_COUNT = 5;

export interface OnboardingStageMeta {
  index: OnboardingStage;
  id: 'welcome' | 'workshop' | 'survey' | 'first-strike' | 'roll-awaits';
  title: string;
}

export const ONBOARDING_STAGES: OnboardingStageMeta[] = [
  { index: 0, id: 'welcome', title: 'Heed the Call' },
  { index: 1, id: 'workshop', title: 'The Workshop' },
  { index: 2, id: 'survey', title: 'Survey the Field' },
  { index: 3, id: 'first-strike', title: 'First Strike' },
  { index: 4, id: 'roll-awaits', title: 'The Roll Awaits' },
];

function clampStage(stage: number | null | undefined): OnboardingStage {
  if (stage == null) return 0;
  if (stage < 0) return 0;
  if (stage > 4) return 4;
  return stage as OnboardingStage;
}

export function useOnboarding() {
  const { data: user, isLoading } = useAuthQuery();
  const queryClient = useQueryClient();

  const isOpen = !!user && user.onboarded_at === null;
  const stage = clampStage(user?.onboarding_stage);

  const advanceMutation = useMutation({
    mutationFn: async (next: OnboardingStage) => {
      await apiFetch<{ ok: true }>('/api/users/me/onboarding-stage', {
        method: 'PATCH',
        body: JSON.stringify({ stage: next }),
      });
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData<UserMe | null | undefined>(['me'], (prev) =>
        prev ? { ...prev, onboarding_stage: next } : prev,
      );
    },
  });

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

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch<UserMe>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ reset_onboarding: true }),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData<UserMe>(['me'], next);
    },
  });

  return {
    isLoading,
    isOpen,
    stage,
    user: user ?? null,
    advance: (next: OnboardingStage) => advanceMutation.mutate(next),
    advanceAsync: (next: OnboardingStage) => advanceMutation.mutateAsync(next),
    complete: () => completeMutation.mutateAsync(),
    reset: () => resetMutation.mutateAsync(),
    isAdvancing: advanceMutation.isPending,
    isCompleting: completeMutation.isPending,
    isResetting: resetMutation.isPending,
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
