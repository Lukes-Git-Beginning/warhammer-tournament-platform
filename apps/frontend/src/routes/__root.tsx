import { useEffect, useRef } from 'react';
import { Outlet, createRootRoute, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/layout/Header';
import { useRequireSteamLink, useAuthQuery } from '@/lib/auth';
import { recordActivity } from '@/lib/api';
import { DevLoginPanel } from '@/components/dev/DevLoginPanel';
import { ActiveMatchVisibilityProvider } from '@/contexts/ActiveMatchVisibility';
import { FactionPickTimerBanner } from '@/components/match/FactionPickTimerBanner';

// Map a pathname to a compact page label for the access log (e.g. "tournament:<slug>").
function pageLabel(path: string): string {
  const seg = path.split('/').filter(Boolean);
  const a = seg[0] ?? 'home';
  const b = seg[1];
  if (a === 'tournaments' && b) return `tournament:${b}`;
  if (a === 'users' && b) return `profile:${b}`;
  if (a === 'matches' && b) return `match:${b}`;
  return a;
}

// Fire a page-view beacon on each navigation, for authenticated users only.
function useAccessBeacon() {
  const { data: user } = useAuthQuery();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    if (last.current === pathname) return;
    last.current = pathname;
    recordActivity(pathname, pageLabel(pathname));
  }, [user, pathname]);
}

function RootLayout() {
  const { t } = useTranslation();
  // Global Steam-Link hard-gate — redirects to /connect-steam for unauthenticated routes
  // unless the current path is whitelisted in useRequireSteamLink.
  useRequireSteamLink();
  useAccessBeacon();
  return (
    <ActiveMatchVisibilityProvider>
    <div className="relative min-h-screen bg-rizzotto-iron-950 text-rizzotto-stone-200 antialiased">
      {/* Atmospheric Layer 1: stone-wall texture, page-wide */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-stone-wall-texture bg-[length:768px_768px] opacity-[0.10] mix-blend-soft-light"
      />
      {/* Atmospheric Layer 2: forge glow rising from bottom */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-rizzotto-forge-glow"
      />
      {/* Atmospheric Layer 3: cinematic vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-rizzotto-vignette"
      />
      {/* Anchor for skip-link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-rizzotto-gold-400 focus:text-rizzotto-iron-950 focus:font-semibold focus:rounded-sm"
      >
        {t('a11y.skip_to_content')}
      </a>
      <div className="relative z-10">
        <Header />
        <Outlet />
      </div>
      {/* #2 — always-visible faction-pick countdown (renders only when a timer runs) */}
      <FactionPickTimerBanner />
{import.meta.env.DEV && <DevLoginPanel />}
    </div>
    </ActiveMatchVisibilityProvider>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
