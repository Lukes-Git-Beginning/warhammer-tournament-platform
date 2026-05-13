import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useAuthQuery, useLogout } from '@/lib/auth';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';
import { KarazWordmarkImage } from '@/components/icons/KarazWordmarkImage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINK_CLASS =
  'font-display text-[13px] uppercase tracking-wider text-karaz-stone-300 hover:text-karaz-gold-400 transition-colors';
const NAV_LINK_ACTIVE_PROPS = { className: 'text-karaz-gold-400' };

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
        Roll of Honour
      </Link>
      <Link to="/meta" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Meta
      </Link>
      <Link to="/factions" className={NAV_LINK_CLASS} activeProps={NAV_LINK_ACTIVE_PROPS}>
        Factions
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
          Call the Muster
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-karaz-iron-700 bg-karaz-iron-950/92 backdrop-blur-md">
      <div className="mx-auto flex max-w-[80rem] items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
        {/* Logo lockup */}
        <Link
          to="/"
          aria-label="Karaz Lists — home"
          className="inline-flex items-center transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-karaz-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-karaz-iron-950 rounded-sm"
        >
          <KarazWordmarkImage className="h-10 w-auto sm:h-12" width={180} />
        </Link>

        {/* Desktop Nav */}
        <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
          {navLinks}
        </nav>

        {/* Auth area + Hamburger */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-8 w-8 rounded-full ring-2 ring-karaz-gold-500/40 ring-offset-1 ring-offset-karaz-iron-950"
                />
              )}
              <span className="hidden text-sm text-karaz-stone-300 sm:inline">
                {user.username}
              </span>
              <Button
                variant="etched"
                size="sm"
                onClick={() => doLogout()}
                disabled={isPending}
              >
                Lay Down Arms
              </Button>
            </>
          ) : (
            <DiscordLoginButton />
          )}

          {/* Mobile-only Hamburger */}
          <button
            type="button"
            className={cn(
              'sm:hidden p-2 text-karaz-stone-300 hover:text-karaz-gold-400 transition-colors rounded-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-karaz-gold-500',
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
          className="sm:hidden border-t border-karaz-iron-700 bg-karaz-iron-950 px-4 py-4 flex flex-col gap-3"
          data-testid="mobile-menu"
        >
          {navLinks}
        </nav>
      )}
    </header>
  );
}
