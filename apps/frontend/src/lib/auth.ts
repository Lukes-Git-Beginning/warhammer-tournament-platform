import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocation } from '@tanstack/react-router';
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

/**
 * Hard-Gate Steam-Link-Guard.
 *
 * In every authenticated page (except `/`, `/login`, `/connect-steam`, `/auth/*`):
 * - If user is loaded and `steam_link == null` → redirect to `/connect-steam?return_to=<current>`
 *
 * Usage: call at the top of any route that requires Steam. Does NOT require Auth itself —
 * compose with `useRequireAuth()` for pages that need both.
 */
export function useRequireSteamLink(): ReturnType<typeof useAuthQuery> {
  const query = useAuthQuery();
  const router = useRouter();
  const location = useLocation();

  const STEAM_EXEMPT_PATHS = ['/', '/login', '/connect-steam'];
  const isExempt =
    STEAM_EXEMPT_PATHS.some((p) => location.pathname === p) ||
    location.pathname.startsWith('/auth/');

  if (!query.isLoading && query.data && !isExempt) {
    if (query.data.steam_link == null) {
      void router.navigate({
        to: '/connect-steam',
        search: { return_to: location.pathname + location.search },
      });
    }
  }

  return query;
}
