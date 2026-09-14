import { useQuery } from '@tanstack/react-query';
import { getFeatureFlags, type FeatureFlags } from '@/lib/api.js';

export function useFeatureFlags(): FeatureFlags | undefined {
  const { data } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: getFeatureFlags,
    staleTime: 60_000,
    retry: false,
  });
  return data;
}

export function useMajorsEnabled(): boolean {
  return useFeatureFlags()?.enable_majors ?? false;
}
