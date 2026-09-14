import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from '@/lib/authEvents';
import { DiscordLoginButton } from './DiscordLoginButton';

/**
 * Listens for the global 401 signal (see lib/authEvents). On expiry it drops the cached `['me']`
 * session so the entire UI flips to logged-out at once — no hard reload needed — and, if the user
 * was actually logged in, shows a clear prompt with one-click Discord re-login. A plain anonymous
 * 401 (e.g. the initial /api/users/me for a visitor) flips state silently without the banner.
 */
export function SessionExpiredBanner() {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const wasLoggedIn = queryClient.getQueryData(['me']) != null;
      // Flip the app to logged-out immediately so stale UI stops firing doomed requests and the
      // Discord sign-in button reappears without a Ctrl+F5.
      queryClient.setQueryData(['me'], null);
      // Only nag when there was a session to lose.
      if (wasLoggedIn) setExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  if (!expired) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-rizzotto-gold-500/40 bg-rizzotto-iron-900/95 px-4 py-3 text-sm text-rizzotto-stone-100 shadow-lg backdrop-blur"
    >
      <span>Your session has expired — please sign in again to continue.</span>
      <DiscordLoginButton />
      <button
        type="button"
        onClick={() => setExpired(false)}
        className="rounded border border-rizzotto-iron-600 px-3 py-1.5 text-xs text-rizzotto-stone-300 transition-colors hover:border-rizzotto-iron-400 hover:text-rizzotto-stone-100"
      >
        Dismiss
      </button>
    </div>
  );
}
