import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { getUserProfile } from '@/lib/api';
import { EloRatingDisplay } from '../components/meta/EloRatingDisplay';

const ROLE_LABELS: Record<string, string> = {
  USER: 'Spieler',
  ORGANIZER: 'Organisator',
  MODERATOR: 'Moderator',
  ADMIN: 'Admin',
};

const ROLE_COLORS: Record<string, string> = {
  USER: 'bg-stone-700 text-stone-300',
  ORGANIZER: 'bg-blue-900/60 text-blue-300',
  MODERATOR: 'bg-purple-900/60 text-purple-300',
  ADMIN: 'bg-warhammer-blood/60 text-red-200',
};

function Avatar({ url, username, large }: { url: string | null; username: string; large?: boolean }) {
  const size = large ? 'h-20 w-20 text-2xl' : 'h-8 w-8 text-sm';
  if (!url) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-stone-700 font-medium text-stone-200 ${size}`}
      >
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className={`rounded-full border border-stone-700 object-cover ${size}`}
    />
  );
}

function EloDeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-stone-500 text-sm">—</span>;
  if (delta > 0) return <span className="text-sm font-semibold text-emerald-400">▲ +{delta}</span>;
  if (delta < 0) return <span className="text-sm font-semibold text-red-400">▼ {delta}</span>;
  return <span className="text-sm text-stone-500">— 0</span>;
}

function StatCard({ label, value, children }: { label: string; value?: string | number; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4 text-center">
      <div className="text-2xl font-bold text-stone-100">{children ?? value}</div>
      <div className="mt-1 text-xs text-stone-500">{label}</div>
    </div>
  );
}

export function UserProfilePage() {
  const { id } = useParams({ from: '/users/$id' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-profile', id],
    queryFn: () => getUserProfile(id),
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-stone-400 text-sm">
        Wird geladen…
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          Spielerprofil nicht gefunden oder nicht erreichbar.
        </div>
      </main>
    );
  }

  const { user, current_season, all_time, recent_results, recent_matches } = data;

  const joinedDate = new Date(user.created_at).toLocaleString('de-DE', {
    dateStyle: 'medium',
  });

  const roleLabel = ROLE_LABELS[user.role] ?? user.role;
  const roleColor = ROLE_COLORS[user.role] ?? 'bg-stone-700 text-stone-300';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      {/* Header Card */}
      <div className="flex items-center gap-5 rounded-md border border-stone-800 bg-stone-900/40 p-6">
        <Avatar url={user.avatar_url} username={user.username} large />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-bold text-warhammer-gold">{user.username}</h1>
          <span className={`rounded px-2 py-0.5 text-xs font-medium w-fit ${roleColor}`}>
            {roleLabel}
          </span>
          <p className="text-xs text-stone-500">Dabei seit {joinedDate}</p>
        </div>
      </div>

      {/* Aktuelle Season */}
      <section>
        <h2 className="font-display text-lg font-semibold text-warhammer-gold mb-3">
          Aktuelle Season
        </h2>
        {current_season ? (
          <div>
            <p className="text-sm text-stone-400 mb-3">{current_season.season.name}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Punkte" value={current_season.total_points} />
              <StatCard label="Elo"><EloRatingDisplay rating={current_season.elo_rating} /></StatCard>
              <StatCard label="Spiele" value={current_season.matches_played} />
              <StatCard label="Siege" value={current_season.wins} />
              <StatCard label="Niederlagen" value={current_season.losses} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Keine aktive Season.</p>
        )}
      </section>

      {/* All-Time */}
      <section>
        <h2 className="font-display text-lg font-semibold text-warhammer-gold mb-3">All-Time</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Spiele" value={all_time.matches_played} />
          <StatCard label="Siege" value={all_time.wins} />
          <StatCard label="Niederlagen" value={all_time.losses} />
          <StatCard label="Turniere" value={all_time.tournaments_played} />
          <StatCard label="Punkte" value={all_time.total_points} />
        </div>
      </section>

      {/* Recent Tournaments */}
      <section>
        <h2 className="font-display text-lg font-semibold text-warhammer-gold mb-3">
          Letzte Turniere
        </h2>
        {recent_results.length === 0 ? (
          <p className="text-sm text-stone-500">Noch keine Turnierteilnahmen.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Turnier</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Season</th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">Platz</th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">Punkte</th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">Elo</th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">Datum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {recent_results.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to="/tournaments/$slug"
                        params={{ slug: r.tournament.slug }}
                        className="text-stone-200 hover:text-warhammer-gold transition-colors"
                      >
                        {r.tournament.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-400">{r.season_name ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-stone-200">#{r.placement}</td>
                    <td className="px-4 py-3 text-right text-stone-200">{r.points_earned}</td>
                    <td className="px-4 py-3 text-right">
                      <EloDeltaCell delta={r.elo_change} />
                    </td>
                    <td className="px-4 py-3 text-right text-stone-500">
                      {new Date(r.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Matches */}
      <section>
        <h2 className="font-display text-lg font-semibold text-warhammer-gold mb-3">
          Letzte Matches
        </h2>
        {recent_matches.length === 0 ? (
          <p className="text-sm text-stone-500">Noch keine Matches.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Turnier / Runde</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Gegner</th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">Ergebnis</th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">Score</th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">Datum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {recent_matches.map((m, i) => {
                  const won = m.winnerId === user.id;
                  const lost = m.winnerId !== null && m.winnerId !== user.id;
                  const resultLabel = m.winnerId === null ? '—' : won ? 'Sieg' : 'Niederlage';
                  const resultColor =
                    m.winnerId === null
                      ? 'text-stone-500'
                      : won
                        ? 'text-emerald-400'
                        : 'text-red-400';
                  return (
                    <tr key={i} className="hover:bg-stone-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to="/tournaments/$slug"
                          params={{ slug: m.tournament.slug }}
                          className="text-stone-200 hover:text-warhammer-gold transition-colors"
                        >
                          {m.tournament.name}
                        </Link>
                        <span className="ml-1 text-stone-500 text-xs">R{m.round}</span>
                      </td>
                      <td className="px-4 py-3">
                        {m.opponent ? (
                          <Link
                            to="/users/$id"
                            params={{ id: m.opponent.id }}
                            className="text-stone-200 hover:text-warhammer-gold transition-colors"
                          >
                            {m.opponent.username}
                          </Link>
                        ) : (
                          <span className="text-stone-500">BYE</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${resultColor}`}>
                        {resultLabel}
                      </td>
                      <td className="px-4 py-3 text-center text-stone-400">{m.score ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-stone-500">
                        {new Date(m.updatedAt).toLocaleString('de-DE', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
