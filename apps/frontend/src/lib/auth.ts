import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { getMe, logout } from './api';
import type { ApiError } from './api';

export function useAuthQuery() {
  return useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.setQueryData(['me'], null);
      await router.navigate({ to: '/login' });
    },
  });
}

export function useRequireAuth() {
  const query = useAuthQuery();
  const router = useRouter();

  const error = query.error as ApiError | null;
  if (!query.isLoading && (error?.status === 401 || (!query.data && !query.isLoading))) {
    if (error?.status === 401) {
      void router.navigate({ to: '/login' });
    }
  }

  return query;
}
