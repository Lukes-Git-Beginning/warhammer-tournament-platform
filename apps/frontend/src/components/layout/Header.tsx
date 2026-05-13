import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuthQuery, useLogout } from '@/lib/auth';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';

const NAV_LINK_CLASS =
  'text-sm text-stone-300 hover:text-warhammer-gold transition-colors';
const NAV_LINK_ACTIVE_PROPS = { className: 'text-warhammer-gold' };

export function Header() {
  const { data: user } = useAuthQuery();
  const { mutate: doLogout, isPending } = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canCreate =
    user?.role === 'ORGANIZER' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  const navLinks = (
    <>
      <Link to="/" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Home
      </Link>
      <Link to="/leaderboard" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Leaderboard
      </Link>
      <Link to="/meta" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Meta
      </Link>
      <Link to="/factions" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Fraktionen
      </Link>
      <Link to="/presets" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Drafts
      </Link>
      {canCreate && (
        <Link
          to="/tournaments/create"
          className={NAV_LINK_CLASS}
          activeProps={NAV_LINK_ACTIVE_PROPS}
        >
          Erstellen
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-stone-800 bg-stone-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link to="/" className="font-display text-xl font-bold text-warhammer-gold hover:opacity-90">
          TWW3 Cup
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-6 sm:flex">{navLinks}</nav>

        {/* Auth area + Hamburger */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="h-8 w-8 rounded-full border border-stone-700"
                />
              )}
              <span className="hidden text-sm text-stone-300 sm:inline">{user.username}</span>
              <button
                type="button"
                onClick={() => doLogout()}
                disabled={isPending}
                className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-50 transition-colors"
              >
                Abmelden
              </button>
            </>
          ) : (
            <DiscordLoginButton />
          )}

          {/* Mobile-only Hamburger */}
          <button
            type="button"
            className="sm:hidden p-2 text-stone-300"
            aria-label="Menü öffnen"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Nav Dropdown */}
      {mobileMenuOpen && (
        <nav
          className="sm:hidden border-t border-stone-800 bg-stone-950 px-4 py-3 flex flex-col gap-3"
          data-testid="mobile-menu"
        >
          {navLinks}
        </nav>
      )}
    </header>
  );
}
