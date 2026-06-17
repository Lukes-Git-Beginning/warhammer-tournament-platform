import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getUserProfile, getUserStats } from '@/lib/api.js';
import { PlayerFactionProficiencyCard } from '../components/meta/PlayerFactionProficiencyCard.js';
import { useAuthQuery } from '@/lib/auth.js';
import { useOnboarding } from '@/lib/onboarding.js';
import { formatInUserTimezone } from '@/lib/timezone.js';
import { Button } from '@/components/ui/button.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { ArmyListList } from '../components/tournament/ArmyListList.js';
import { ArmyListUpload } from '../components/tournament/ArmyListUpload.js';

const ROLE_COLORS: Record<string, string> = {
  USER: 'bg-stone-700 text-stone-300',
  HOST: 'bg-blue-900/60 text-blue-300',
  ORGANIZER: 'bg-blue-900/60 text-blue-300',
  MODERATOR: 'bg-purple-900/60 text-purple-300',
  ADMIN: 'bg-rizzotto-blood-500/60 text-red-200',
};

function Avatar({
  url,
  username,
  large,
}: {
  url: string | null;
  username: string;
  large?: boolean;
}) {
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


function StatCard({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | number;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4 text-center">
      <div className="text-2xl font-bold text-stone-100">{children ?? value}</div>
      <div className="mt-1 text-xs text-stone-500">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Section
// ---------------------------------------------------------------------------

function TrendArrow({ trend }: { trend?: number }) {
  if (trend == null || trend === 0) return null;
  if (trend > 0)
    return <span className="text-emerald-400 text-sm">▲ +{(trend * 100).toFixed(1)}%</span>;
  return <span className="text-red-400 text-sm">▼ {(trend * 100).toFixed(1)}%</span>;
}

function WinLossCard({
  wins,
  losses,
  winRate,
  trend,
}: {
  wins: number;
  losses: number;
  winRate: number;
  trend?: number;
}) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="text-xs text-stone-500 uppercase tracking-wider mb-3">Recent Win / Loss</p>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-rizzotto-gold-400">
          {(winRate * 100).toFixed(1)}%
        </span>
        <TrendArrow trend={trend} />
      </div>
      <div className="mt-2 flex gap-4 text-sm">
        <span className="text-emerald-400">{wins}W</span>
        <span className="text-stone-600">/</span>
        <span className="text-red-400">{losses}L</span>
      </div>
    </div>
  );
}



interface StatsSectionProps {
  userId: string;
}

function StatsSection({ userId }: StatsSectionProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user-stats', userId],
    queryFn: () => getUserStats(userId),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-32 rounded-md border border-stone-800 bg-stone-900/60 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-stone-800 bg-stone-900/40 px-4 py-3 text-sm text-stone-500">
        No stats available yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <WinLossCard
        wins={data.total_wins}
        losses={data.total_losses}
        winRate={data.win_rate}
        trend={data.win_rate_trend}
      />
      <PlayerFactionProficiencyCard userId={userId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function UserProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams({ from: '/users/$id' });
  const { data: me } = useAuthQuery();
  const { reset, isResetting } = useOnboarding();
  const isOwnProfile = me?.id === id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-profile', id],
    queryFn: () => getUserProfile(id),
    retry: false,
  });

  if (isLoading) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400 text-sm">
        {t('common.loading')}
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('user_profile.not_found')}
        </div>
      </PageShell>
    );
  }

  const { user, current_season, all_time, recent_results, recent_matches } = data;

  const joinedDate = formatInUserTimezone(user.created_at, undefined, { showTime: false });

  const roleLabel = t(`user_profile.roles.${user.role}`, { defaultValue: user.role });
  const roleColor = ROLE_COLORS[user.role] ?? 'bg-stone-700 text-stone-300';

  return (
    <PageShell variant="narrow" className="space-y-8">
      {/* Header Card */}
      <div className="flex items-center gap-5 rounded-md border border-stone-800 bg-stone-900/40 p-6">
        <Avatar url={user.avatar_url} username={user.username} large />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-bold text-rizzotto-gold-500">
            {user.username}
          </h1>
          <span className={`rounded px-2 py-0.5 text-xs font-medium w-fit ${roleColor}`}>
            {roleLabel}
          </span>
          <p className="text-xs text-stone-500">{t('user_profile.joined', { date: joinedDate })}</p>
        </div>
      </div>

      {/* Aktuelle Season */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          {t('user_profile.current_season')}
        </h2>
        {current_season ? (
          <div>
            <p className="text-sm text-stone-400 mb-3">{current_season.season.name}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard
                label={t('user_profile.stats.points')}
                value={current_season.total_points.toFixed(1)}
              />
              <StatCard
                label={t('user_profile.stats.games')}
                value={current_season.games_played}
              />
              <StatCard label={t('user_profile.stats.wins')} value={current_season.wins} />
              <StatCard label={t('user_profile.stats.losses')} value={current_season.losses} />
            </div>
          </div>
        ) : (
          <EmptyState
            variant="compact"
            title={t('user_profile.empties.season.title')}
            body={t('user_profile.empties.season.body')}
          />
        )}
      </section>

      {/* All-Time */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          {t('user_profile.all_time')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label={t('user_profile.stats.games')} value={all_time.games_played} />
          <StatCard label={t('user_profile.stats.wins')} value={all_time.wins} />
          <StatCard label={t('user_profile.stats.losses')} value={all_time.losses} />
          <StatCard
            label={t('user_profile.stats.tournaments')}
            value={all_time.tournaments_played}
          />
          <StatCard label={t('user_profile.stats.points')} value={all_time.total_points.toFixed(1)} />
        </div>
      </section>

      {/* Statistics Section (neue Cards) */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          Statistics
        </h2>
        <StatsSection userId={id} />
      </section>

      {/* Recent Tournaments */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          {t('user_profile.recent_tournaments')}
        </h2>
        {recent_results.length === 0 ? (
          <EmptyState
            variant="compact"
            title={t('user_profile.empties.tournaments.title')}
            body={t('user_profile.empties.tournaments.body')}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">
                    {t('user_profile.stats.tournaments')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Season</th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">
                    {t('leaderboard.columns.rank')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">
                    {t('leaderboard.columns.points')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">
                    {t('common.date')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {recent_results.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to="/tournaments/$slug"
                        params={{ slug: r.tournament.slug }}
                        className="text-stone-200 hover:text-rizzotto-gold-500 transition-colors"
                      >
                        {r.tournament.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-400">{r.season_name ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-stone-200">{r.placement != null ? `#${r.placement}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-stone-200">{r.points_earned ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-stone-500">
                      {formatInUserTimezone(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Army-Listen */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          {t('user_profile.army_lists')}
        </h2>
        <div className="space-y-4">
          <ArmyListList />
          <ArmyListUpload factionId="" />
        </div>
      </section>

      {/* The Workshop — only on own profile */}
      {isOwnProfile && (
        <section
          aria-labelledby="workshop-heading"
          className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-6"
        >
          <h2
            id="workshop-heading"
            className="font-display text-lg font-semibold text-rizzotto-gold-400 mb-2"
          >
            {t('user_profile.workshop_title')}
          </h2>
          <p className="text-sm text-rizzotto-stone-300 mb-4">{t('user_profile.workshop_body')}</p>
          <Button variant="etched" size="sm" onClick={() => void reset()} disabled={isResetting}>
            {isResetting ? t('user_profile.workshop_cta_loading') : t('user_profile.workshop_cta')}
          </Button>
        </section>
      )}

      {/* Recent Matches */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          {t('user_profile.recent_matches')}
        </h2>
        {recent_matches.length === 0 ? (
          <EmptyState
            variant="compact"
            title={t('user_profile.empties.matches.title')}
            body={t('user_profile.empties.matches.body')}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-stone-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">
                    {t('user_profile.stats.tournaments')} / {t('common.round')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">
                    {t('user_profile.match.opponent')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">
                    {t('user_profile.match.result')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">
                    {t('user_profile.match.score')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">
                    {t('common.date')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {recent_matches.map((m, i) => {
                  const won = m.winnerId === user.id;
                  const resultLabel =
                    m.winnerId === null
                      ? '—'
                      : won
                        ? t('user_profile.match.win')
                        : t('user_profile.match.loss');
                  const resultColor =
                    m.winnerId === null
                      ? 'text-stone-500'
                      : won
                        ? 'text-emerald-400'
                        : 'text-red-400';
                  return (
                    <tr key={i} className="hover:bg-stone-800/30 transition-colors">
                      <td className="px-4 py-3">
                        {m.tournament ? (
                          <Link
                            to="/tournaments/$slug"
                            params={{ slug: m.tournament.slug }}
                            className="text-stone-200 hover:text-rizzotto-gold-500 transition-colors"
                          >
                            {m.tournament.name}
                          </Link>
                        ) : (
                          <span className="text-stone-500">—</span>
                        )}
                        <span className="ml-1 text-stone-500 text-xs">R{m.round}</span>
                      </td>
                      <td className="px-4 py-3">
                        {m.opponent ? (
                          <Link
                            to="/users/$id"
                            params={{ id: m.opponent.id }}
                            className="text-stone-200 hover:text-rizzotto-gold-500 transition-colors"
                          >
                            {m.opponent.username}
                          </Link>
                        ) : (
                          <span className="text-stone-500">{t('user_profile.match.bye')}</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${resultColor}`}>
                        {resultLabel}
                      </td>
                      <td className="px-4 py-3 text-center text-stone-400">{m.score ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-stone-500">
                        {formatInUserTimezone(m.updatedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.opponent && (
                          <Link
                            to="/users/$a/vs/$b"
                            params={{ a: user.id, b: m.opponent.id }}
                            className="text-xs text-stone-500 hover:text-rizzotto-gold-400 transition-colors whitespace-nowrap"
                          >
                            Head-to-Head
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
