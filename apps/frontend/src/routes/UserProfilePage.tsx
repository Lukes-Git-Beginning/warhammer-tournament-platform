import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  getUserProfile,
  getUserGames,
  getPlayerAntiFarming,
  getAdminUserQueuePenalty,
  clearAdminUserQueuePenalty,
  type AntiFarmingOpponent,
} from '@/lib/api.js';
import { patchMePreferences } from '@/lib/onboarding.js';
import type { UserMe } from '@rizzotto/types';
import { GameHistoryTable } from '../components/match/GameHistoryTable.js';
import { PlayerFactionProficiencyCard } from '../components/meta/PlayerFactionProficiencyCard.js';
import { PlayerLevelScale } from '../components/meta/PlayerLevelScale.js';
import { CalibrationWizard } from '../components/meta/CalibrationWizard.js';
import { CalibrationAuditPanel } from '../components/admin/CalibrationAuditPanel.js';
import { useAuthQuery } from '@/lib/auth.js';
import { formatInUserTimezone } from '@/lib/timezone.js';
import { Button } from '@/components/ui/button.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { PageShell } from '@/components/layout/PageShell.js';

/** Map deprecated IANA aliases to their current canonical name (e.g. Kiev → Kyiv). */
function normalizeTimezone(tz: string): string {
  return tz === 'Europe/Kiev' ? 'Europe/Kyiv' : tz;
}

const COMMON_TIMEZONES = [
  'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Warsaw', 'Europe/Kyiv',
  'Europe/Paris', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Rome',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul',
  'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland',
];

function TimezoneSection({ user }: { user: UserMe }) {
  const queryClient = useQueryClient();
  const current = normalizeTimezone(user.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [selected, setSelected] = useState(current);
  const [saved, setSaved] = useState(false);

  const options = useMemo(() => {
    const set = new Set([current, ...COMMON_TIMEZONES]);
    return Array.from(set);
  }, [current]);

  const mutation = useMutation({
    mutationFn: () => patchMePreferences({ timezone: selected }),
    onSuccess: (updated) => {
      queryClient.setQueryData<UserMe>(['me'], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">Timezone</h2>
      <div className="flex items-center gap-3">
        <select
          value={selected}
          onChange={(e) => { setSelected(e.target.value); setSaved(false); }}
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        >
          {options.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={selected === current || mutation.isPending}
          className="rounded border border-rizzotto-gold-600 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-900/20 disabled:opacity-40 transition-colors"
        >
          {mutation.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Controls when your availability calendar sends match invitations.
      </p>
    </section>
  );
}

const ROLE_COLORS: Record<string, string> = {
  USER: 'bg-stone-700 text-stone-300',
  HOST: 'bg-blue-900/60 text-blue-300',
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
      <p className="text-xs text-stone-500 uppercase tracking-wider mb-3">Win / Loss</p>
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
  wins: number;
  losses: number;
  gamesPlayed: number;
}

function StatsSection({ userId, wins, losses, gamesPlayed }: StatsSectionProps) {
  const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
      <WinLossCard wins={wins} losses={losses} winRate={winRate} />
      <PlayerFactionProficiencyCard userId={userId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anti-Farming Section (admin-only)
// ---------------------------------------------------------------------------

function AntiFarmingSection({ playerId }: { playerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['anti-farming', playerId],
    queryFn: () => getPlayerAntiFarming(playerId),
  });

  return (
    <section className="rounded-md border border-amber-900/40 bg-amber-950/10 p-5">
      <h2 className="font-display text-base font-semibold text-amber-500/80 mb-1">
        Anti-Farming
      </h2>
      <p className="text-[11px] text-stone-500 mb-4">
        Opponents against whom this player's wins are reduced in value, plus those
        approaching the cap (≥4% win-share, still full value). Reductions activate
        once the player has ≥20 season wins.
      </p>

      {isLoading && <p className="text-xs text-stone-600">Loading…</p>}

      {!isLoading && data && !data.penaltyActive && (
        <p className="text-xs text-stone-600 italic">
          No penalty active yet — player has {data.playerTotalWins} season win{data.playerTotalWins !== 1 ? 's' : ''} (threshold: 20).
        </p>
      )}

      {!isLoading && data?.penaltyActive && data.opponents.length === 0 && (
        <p className="text-xs text-stone-600 italic">
          No opponents at or near the 5% win-share threshold ({data.playerTotalWins} total wins).
        </p>
      )}

      {!isLoading && data && data.opponents.length > 0 && (
        <>
          <div className="flex items-center gap-3 pb-1.5 text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800 mb-1">
            <span className="flex-1">Opponent</span>
            <span className="w-14 text-right">Wins vs.</span>
            <span className="w-14 text-right">Share</span>
            <span className="w-24 text-right">Win Value</span>
          </div>
          <div className="space-y-1">
            {(data.opponents as AntiFarmingOpponent[]).map((o) => {
              const pct = Math.round(o.modifier * 100);
              const share = Math.round(o.share * 100);
              return (
                <div key={o.id} className="flex items-center gap-3 py-1">
                  <Link to="/users/$id" params={{ id: o.id }} className="flex flex-1 items-center gap-2 hover:text-rizzotto-gold-400 transition-colors min-w-0">
                    {o.avatar_url
                      ? <img src={o.avatar_url} alt="" className="h-5 w-5 rounded-full border border-stone-700 object-cover shrink-0" />
                      : <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[9px]">{o.username[0]?.toUpperCase()}</span>
                    }
                    <span className="truncate text-sm text-stone-300">{o.username}</span>
                  </Link>
                  <span className="w-14 text-right text-xs text-stone-400">{o.wins}W</span>
                  <span className={`w-14 text-right text-xs ${o.status === 'approaching' ? 'text-yellow-600/80' : 'text-stone-500'}`}>{share}%</span>
                  <div className="w-24 flex items-center justify-end gap-1.5">
                    {o.status === 'approaching' ? (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-yellow-500/80">approaching</span>
                    ) : (
                      <>
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-800">
                          <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-medium ${pct === 0 ? 'text-red-500' : 'text-amber-400'}`}>{pct}%</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-stone-600">
            {data.playerTotalWins} total season wins. Share &gt;5% → penalty starts; &gt;10% → wins count at 0%.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function formatCooldown(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** Admin-only: show + lift this player's Open Play queue-abuse penalty (#14). */
function QueueCooldownAdminPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-queue-penalty', userId],
    queryFn: () => getAdminUserQueuePenalty(userId),
  });
  const clear = useMutation({
    mutationFn: () => clearAdminUserQueuePenalty(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-queue-penalty', userId] }),
  });

  const cooldownSec = data?.cooldownSec ?? 0;
  const level = data?.level ?? 0;
  const hasPenalty = cooldownSec > 0 || level > 0;

  return (
    <div>
      <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-stone-500">
        Admin · Open Play queue
      </p>
      <div className="flex items-center justify-between gap-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 px-4 py-3">
        {hasPenalty ? (
          <span className="text-sm text-stone-300">
            Queue-abuse level <span className="font-semibold text-stone-100">{level}</span>
            {cooldownSec > 0 ? (
              <>
                {' '}· cooldown{' '}
                <span className="font-semibold text-stone-100">{formatCooldown(cooldownSec)}</span> left
              </>
            ) : (
              ' · no active cooldown'
            )}
          </span>
        ) : (
          <span className="text-sm text-stone-500">No active queue penalty.</span>
        )}
        <Button
          size="sm"
          variant="etched"
          onClick={() => clear.mutate()}
          disabled={!hasPenalty || clear.isPending}
        >
          {clear.isPending ? 'Clearing…' : 'Clear'}
        </Button>
      </div>
    </div>
  );
}

export function UserProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams({ from: '/users/$id' });
  const { data: me } = useAuthQuery();
  const isOwnProfile = me?.id === id;
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-profile', id],
    queryFn: () => getUserProfile(id),
    retry: false,
  });

  const { data: gamesData } = useQuery({
    queryKey: ['user-games', id],
    queryFn: () => getUserGames(id, 1, 20),
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

  const { user, current_season, all_time, recent_results } = data;

  const joinedDate = formatInUserTimezone(user.created_at, undefined, { showTime: false });

  const roleLabel = t(`user_profile.roles.${user.role}`, { defaultValue: user.role });
  const roleColor = ROLE_COLORS[user.role] ?? 'bg-stone-700 text-stone-300';

  return (
    <PageShell variant="wide" className="space-y-8">
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

      {/* Skill standing */}
      <PlayerLevelScale
        userId={id}
        isOwnProfile={isOwnProfile}
        onCalibrate={() => setWizardOpen(true)}
      />
      {isOwnProfile && (
        <CalibrationWizard userId={id} open={wizardOpen} onOpenChange={setWizardOpen} />
      )}

      {/* Admin: collapsible controls tucked under the skill-standing tile. */}
      {me?.role === 'ADMIN' && (
        <div className="-mt-4 space-y-3">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-stone-500 hover:text-stone-300">
              <span className="transition-transform group-open:rotate-90">▸</span>
              Admin · skill calibration
            </summary>
            <div className="mt-2 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 p-4">
              <CalibrationAuditPanel userId={id} />
            </div>
          </details>

          <QueueCooldownAdminPanel userId={id} />
        </div>
      )}

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
        <StatsSection userId={id} wins={all_time.wins} losses={all_time.losses} gamesPlayed={all_time.games_played} />
      </section>

      {/* Anti-Farming (admin only) */}
      {me?.role === 'ADMIN' && (
        <AntiFarmingSection playerId={id} />
      )}

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

      {/* Timezone (own profile only) */}
      {isOwnProfile && me && <TimezoneSection user={me} />}


      {/* Recent Games */}
      <section>
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">
          Recent Games
        </h2>
        {gamesData && gamesData.games.length === 0 ? (
          <EmptyState
            variant="compact"
            title={t('user_profile.empties.matches.title')}
            body={t('user_profile.empties.matches.body')}
          />
        ) : (
          <GameHistoryTable games={gamesData?.games ?? []} showTournament />
        )}
      </section>
    </PageShell>
  );
}
