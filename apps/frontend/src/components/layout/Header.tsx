import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { useAuthQuery, useLogout } from '@/lib/auth';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';
import { RizzottoWordmarkImage } from '@/components/icons/RizzottoWordmarkImage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ActiveMatchIndicator } from './ActiveMatchIndicator';

const NAV_LINK_CLASS =
  'font-display text-[13px] uppercase tracking-wider whitespace-nowrap text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors';
const NAV_LINK_ACTIVE_PROPS = { className: 'text-rizzotto-gold-400' };
// What the tabs get back once the hamburger is gone (p-2 + size-5 + the auth area's gap-2.5).
const HAMBURGER_ROOM = 46;

// Whether every tab fits next to the logo and the auth area. Measured instead of tied to a breakpoint:
// the width they need depends on the role, the username and the active match indicator. Below xl the nav
// isn't laid out (both widths 0) and the hamburger shows either way.
function useNavFits() {
  const navRef = useRef<HTMLElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const links = linksRef.current;
    if (!nav || !links || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      setFits((fit) => links.offsetWidth <= nav.clientWidth + (fit ? 0 : HAMBURGER_ROOM)),
    );
    observer.observe(nav);
    observer.observe(links);
    return () => observer.disconnect();
  }, []);

  return { navRef, linksRef, fits };
}

export function Header() {
  const { t } = useTranslation();
  const { data: user } = useAuthQuery();
  const { mutate: doLogout, isPending } = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { navRef, linksRef, fits } = useNavFits();

  const canCreate =
    user?.role === 'HOST' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  const navLinks = (
    <>
      <Link
        to="/how-to-play"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        How to Play
      </Link>
      <Link
        to="/open-play"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        Open Play
      </Link>
      <Link
        to="/tournaments"
        search={{ tab: 'upcoming', page: 1 }}
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('header.tournaments')}
      </Link>
      <Link
        to="/series"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        Series
      </Link>
      <Link
        to="/fruit-rules"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        Fruit Rules
      </Link>
      {user && (
        <Link
          to="/teams"
          className={NAV_LINK_CLASS}
          activeProps={NAV_LINK_ACTIVE_PROPS}
        >
          Teams
        </Link>
      )}
      <Link
        to="/leaderboard"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('header.leaderboard')}
      </Link>
      <Link
        to="/meta"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('header.meta')}
      </Link>
      <Link
        to="/factions"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('header.factions')}
      </Link>
      <Link
        to="/support"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('support.nav')}
      </Link>

      {canCreate && (
        <Link
          to="/tournaments/create"
          search={{ duplicate: undefined }}
          className={NAV_LINK_CLASS}
          activeProps={NAV_LINK_ACTIVE_PROPS}
        >
          {t('header.create_tournament')}
        </Link>
      )}
      {user?.role === 'ADMIN' && (
        <Link
          to="/admin"
          search={{ tab: 'dashboard' }}
          className={NAV_LINK_CLASS}
          activeProps={NAV_LINK_ACTIVE_PROPS}
        >
          Admin
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-rizzotto-iron-700 bg-rizzotto-iron-950/92 backdrop-blur-md">
      {/* 96rem wide, or as wide as the tabs need if the window has the room */}
      <div className="mx-auto flex w-max max-w-full min-w-[min(100%,96rem)] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
        {/* Logo lockup */}
        <Link
          to="/"
          aria-label="RizzOtto's Arena — home"
          className="inline-flex shrink-0 items-center transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950 rounded-sm"
        >
          <RizzottoWordmarkImage className="h-12 w-auto sm:h-14" />
        </Link>

        {/* Desktop Nav */}
        <nav
          ref={navRef}
          aria-label="Primary"
          className={cn('hidden min-w-0 flex-auto justify-center xl:flex', !fits && 'invisible')}
        >
          <div ref={linksRef} className="flex w-max shrink-0 items-center gap-4">
            {navLinks}
          </div>
        </nav>

        {/* Auth area + Hamburger */}
        <div className="flex shrink-0 items-center gap-2.5">
          {user ? (
            <>
              <ActiveMatchIndicator />
              <Link
                to="/users/$id"
                params={{ id: user.id }}
                aria-label={t('header.view_profile', { defaultValue: 'View profile' })}
                className="group inline-flex items-center gap-2 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950"
              >
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="h-8 w-8 rounded-full ring-2 ring-rizzotto-gold-500/40 ring-offset-1 ring-offset-rizzotto-iron-950 transition-opacity group-hover:opacity-90"
                  />
                )}
                <span
                  className="hidden text-sm text-rizzotto-stone-300 transition-colors group-hover:text-rizzotto-gold-400 xl:inline"
                >
                  {user.username}
                </span>
              </Link>
              <Button
                variant="etched"
                size="sm"
                onClick={() => doLogout()}
                disabled={isPending}
              >
                {t('header.logout')}
              </Button>
            </>
          ) : (
            <DiscordLoginButton />
          )}

          {/* Mobile-only Hamburger */}
          <button
            type="button"
            className={cn(
              'p-2 text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors rounded-sm',
              fits && 'xl:hidden',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500',
            )}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? (
              <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Menu className="size-5" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Nav Dropdown */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile"
          className={cn(
            'border-t border-rizzotto-iron-700 bg-rizzotto-iron-950 px-4 py-4 flex flex-col gap-3 sm:px-6 lg:px-8 xl:px-12',
            fits && 'xl:hidden',
          )}
          onClick={() => setMobileMenuOpen(false)}
          data-testid="mobile-menu"
        >
          {navLinks}
        </nav>
      )}
    </header>
  );
}
