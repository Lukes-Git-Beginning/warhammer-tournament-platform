import { useEffect } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useAuthQuery } from '@/lib/auth';
import { PageShell } from '@/components/layout/PageShell';

/**
 * Hard-Gate Onboarding-Page nach Discord-Login.
 * Zeigt den Steam-Connect-CTA wenn `user.steam_link == null`.
 * Redirected zu `/` wenn Steam bereits verlinkt.
 */
export function SteamConnectPage() {
  const router = useRouter();
  const { data: user, isLoading } = useAuthQuery();

  // Search-Params aus der URL lesen (return_to)
  const search = useSearch({ strict: false }) as { return_to?: string };
  const returnTo = search.return_to ?? '/';

  useEffect(() => {
    if (!isLoading && user?.steam_link) {
      void router.navigate({ to: returnTo as '/' });
    }
  }, [isLoading, user, router, returnTo]);

  if (isLoading) {
    return (
      <PageShell variant="tight" spacing="loose" className="flex items-center justify-center min-h-[60vh]">
        <div className="text-rizzotto-stone-400 text-sm">Loading…</div>
      </PageShell>
    );
  }

  // Already linked — redirect is handled via useEffect, render nothing meanwhile
  if (user?.steam_link) {
    return null;
  }

  const steamLoginUrl = `/auth/steam/login?return_to=${encodeURIComponent(returnTo)}`;

  return (
    <PageShell variant="tight" spacing="loose">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-8 text-center"
      >
        {/* Discord user card */}
        {user && (
          <div className="flex items-center gap-3 rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-5 py-3">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-10 w-10 rounded-full ring-1 ring-rizzotto-iron-500"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-rizzotto-iron-700 flex items-center justify-center text-rizzotto-stone-300 font-semibold text-sm">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="text-left">
              <p className="text-sm font-semibold text-rizzotto-stone-100">{user.username}</p>
              <p className="text-xs text-rizzotto-stone-400">Discord connected</p>
            </div>
            <span className="ml-2 rounded bg-[#5865F2]/20 px-2 py-0.5 text-[11px] font-semibold text-[#7289da]">
              Discord
            </span>
          </div>
        )}

        {/* Forge icon */}
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-rizzotto-iron-600 bg-rizzotto-iron-900 shadow-rizzotto-emboss">
          <svg
            viewBox="0 0 24 24"
            className="h-12 w-12 text-rizzotto-gold-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-rizzotto-iron-800 border border-rizzotto-iron-600">
            <span className="block h-2.5 w-2.5 rounded-full bg-rizzotto-blood-500" />
          </span>
        </div>

        {/* Copy */}
        <div className="space-y-3 max-w-sm">
          <h1 className="font-display text-2xl font-bold text-rizzotto-stone-100 leading-snug">
            Connect your Steam account to continue
          </h1>
          <p className="text-sm text-rizzotto-stone-400 leading-relaxed">
            Required for tournament participation and to prevent ban evasion. Your Steam
            profile will be verified before each tournament registration.
          </p>
        </div>

        {/* CTA */}
        <motion.a
          href={steamLoginUrl}
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="inline-flex items-center gap-3 rounded-md bg-rizzotto-gold-400 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wider text-rizzotto-iron-950 shadow-rizzotto-emboss hover:bg-rizzotto-gold-500 transition-colors"
        >
          {/* Steam SVG icon */}
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
            <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.497 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
          </svg>
          Connect Steam
        </motion.a>

        <p className="text-xs text-rizzotto-stone-500 max-w-xs">
          You will be redirected to Steam's login page. We only access your public profile.
        </p>
      </motion.div>
    </PageShell>
  );
}
