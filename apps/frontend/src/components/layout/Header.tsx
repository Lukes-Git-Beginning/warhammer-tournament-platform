import { Link } from '@tanstack/react-router';
import { useAuthQuery, useLogout } from '@/lib/auth';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';

export function Header() {
  const { data: user } = useAuthQuery();
  const { mutate: doLogout, isPending } = useLogout();

  const canCreate =
    user?.role === 'ORGANIZER' || user?.role === 'MODERATOR' || user?.role === 'ADMIN';

  return (
    <header className="sticky top-0 z-50 border-b border-stone-800 bg-stone-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link to="/" className="font-display text-xl font-bold text-warhammer-gold hover:opacity-90">
          TWW3 Cup
        </Link>

        {/* Nav */}
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            to="/"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
            activeProps={{ className: 'text-warhammer-gold' }}
          >
            Home
          </Link>
          <Link
            to="/"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
          >
            Turniere
          </Link>
          <Link
            to="/leaderboard"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
            activeProps={{ className: 'text-warhammer-gold' }}
          >
            Leaderboard
          </Link>
          <Link
            to="/meta"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
            activeProps={{ className: 'text-warhammer-gold' }}
          >
            Meta
          </Link>
          <Link
            to="/factions"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
            activeProps={{ className: 'text-warhammer-gold' }}
          >
            Fraktionen
          </Link>
          <Link
            to="/presets"
            className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
            activeProps={{ className: 'text-warhammer-gold' }}
          >
            Drafts
          </Link>
          {canCreate && (
            <Link
              to="/tournaments/create"
              className="text-sm text-stone-300 hover:text-warhammer-gold transition-colors"
              activeProps={{ className: 'text-warhammer-gold' }}
            >
              Erstellen
            </Link>
          )}
        </nav>

        {/* Auth area */}
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
        </div>
      </div>
    </header>
  );
}
