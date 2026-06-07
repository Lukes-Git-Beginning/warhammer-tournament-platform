import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { useAuthQuery, useLogout } from '@/lib/auth';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';
import { RizzottoWordmarkImage } from '@/components/icons/RizzottoWordmarkImage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINK_CLASS =
  'font-display text-[13px] uppercase tracking-wider text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors';
const NAV_LINK_ACTIVE_PROPS = { className: 'text-rizzotto-gold-400' };

export function Header() {
  const { t } = useTranslation();
  const { data: user } = useAuthQuery();
  const { mutate: doLogout, isPending } = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canCreate =
    user?.role === 'ORGANIZER' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  const navLinks = (
    <>
      <Link
        to="/tournaments"
        search={{ tab: 'upcoming', page: 1 }}
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
      >
        {t('header.tournaments')}
      </Link>
      <Link
        to="/leaderboard"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
        data-onboarding-target="leaderboard-nav"
      >
        {t('header.leaderboard')}
      </Link>
      <Link
        to="/meta"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
        data-onboarding-target="meta-nav"
      >
        {t('header.meta')}
      </Link>
      <Link
        to="/factions"
        className={NAV_LINK_CLASS}
        activeProps={NAV_LINK_ACTIVE_PROPS}
        data-onboarding-target="factions-nav"
      >
        {t('header.factions')}
      </Link>

      {canCreate && (
        <Link
          to="/tournaments/create"
          className={NAV_LINK_CLASS}
          activeProps={NAV_LINK_ACTIVE_PROPS}
        >
          {t('header.create_tournament')}
        </Link>
      )}
      {user?.role === 'ADMIN' && (
        <Link
          to="/admin"
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
      <div className="mx-auto flex max-w-[80rem] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
        {/* Logo lockup */}
        <Link
          to="/"
          aria-label="RizzOtto's Arena — home"
          className="inline-flex items-center transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950 rounded-sm"
        >
          <RizzottoWordmarkImage className="h-12 w-auto sm:h-14" />
        </Link>

        {/* Desktop Nav */}
        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
          {navLinks}
        </nav>

        {/* Auth area + Hamburger */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                to="/users/$id"
                params={{ id: user.id }}
                aria-label={t('header.view_profile', { defaultValue: 'View profile' })}
                className="inline-flex items-center gap-2 rounded-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950"
              >
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt=""
                    data-onboarding-target="avatar"
                    className="h-8 w-8 rounded-full ring-2 ring-rizzotto-gold-500/40 ring-offset-1 ring-offset-rizzotto-iron-950"
                  />
                )}
                <span
                  className="hidden text-sm text-rizzotto-stone-300 xl:inline"
                  data-onboarding-target={user.avatar_url ? undefined : 'avatar'}
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
              'lg:hidden p-2 text-rizzotto-stone-300 hover:text-rizzotto-gold-400 transition-colors rounded-sm',
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
          className="lg:hidden border-t border-rizzotto-iron-700 bg-rizzotto-iron-950 px-4 py-4 flex flex-col gap-3"
          data-testid="mobile-menu"
        >
          {navLinks}
        </nav>
      )}
    </header>
  );
}
