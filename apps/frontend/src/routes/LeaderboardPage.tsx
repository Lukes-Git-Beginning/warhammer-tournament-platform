import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  getLeaderboard,
  getAllTimeLeaderboard,
  getLeaderboardByMode,
  listSeasons,
  type AllTimeEntry,
  type LeaderboardMode,
  type ExtendedLeaderboardEntry,
} from '@/lib/api.js';
import type { LeaderboardEntryDto } from '@rizzotto/types';
import { EloRatingDisplay } from '../components/meta/EloRatingDisplay.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { EmptyState } from '@/components/ui/empty-state.js';

type Tab = 'season' | 'all-time' | 'season_points' | 'winrate' | 'weighted_winrate';

const PAGE_SIZE = 50;

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className="h-7 w-7 rounded-full border border-stone-700 object-cover"
    />
  );
}

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) {
    return <span className="font-bold text-warhammer-gold">#1</span>;
  }
  return <span className="text-stone-400">#{rank}</span>;
}

// ---------------------------------------------------------------------------
// Season-Tab (original — season_points default)
// ---------------------------------------------------------------------------

function SeasonTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>(undefined);

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });

  const seasons = seasonsData?.data ?? [];
  const activeSeason = seasons.find((s) => s.is_active);
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard', effectiveSeasonId, page],
    queryFn: () => getLeaderboard({ seasonId: effectiveSeasonId, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="season-select" className="text-sm text-stone-400">
          {t('leaderboard.season_select')}
        </label>
        <select
          id="season-select"
          className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
          value={effectiveSeasonId ?? ''}
          onChange={(e) => {
            setPage(1);
            setSelectedSeasonId(e.target.value || undefined);
          }}
        >
          {!activeSeason && !selectedSeasonId && (
            <option value="">{t('leaderboard.season_all')}</option>
          )}
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.is_active ? ` ${t('leaderboard.season_active')}` : ''}
            </option>
          ))}
        </select>
      </div>

      <LeaderboardTable
        entries={data?.entries ?? []}
        isLoading={isLoading}
        error={error}
        extraColumn={null}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-Time Tab
// ---------------------------------------------------------------------------

function AllTimeTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-all-time', page],
    queryFn: () => getAllTimeLeaderboard({ page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <LeaderboardTable
      entries={data?.entries ?? []}
      isLoading={isLoading}
      error={error}
      extraColumn="seasons_participated"
      page={page}
      totalPages={totalPages}
      onPageChange={setPage}
    />
  );
}

// ---------------------------------------------------------------------------
// Mode-based Tab (season_points / winrate / weighted_winrate)
// ---------------------------------------------------------------------------

interface ModeTabProps {
  mode: LeaderboardMode;
}

function ModeTab({ mode }: ModeTabProps) {
  const [page, setPage] = useState(1);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>(undefined);

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });

  const seasons = seasonsData?.data ?? [];
  const activeSeason = seasons.find((s) => s.is_active);
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-mode', mode, effectiveSeasonId, page],
    queryFn: () =>
      getLeaderboardByMode({ mode, season: effectiveSeasonId, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const entries = data?.entries ?? [];

  const isRateBased = mode === 'winrate' || mode === 'weighted_winrate';
  const rateKey: keyof ExtendedLeaderboardEntry =
    mode === 'winrate' ? 'win_rate' : 'weighted_win_rate';

  return (
    <div>
      {/* Season selector */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-stone-400">Season</label>
          <select
            className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-warhammer-gold focus:outline-none"
            value={effectiveSeasonId ?? ''}
            onChange={(e) => {
              setPage(1);
              setSelectedSeasonId(e.target.value || undefined);
            }}
          >
            {!activeSeason && !selectedSeasonId && <option value="">All</option>}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </div>

        {isRateBased && (
          <span className="rounded border border-stone-700 bg-stone-900/60 px-2 py-1 text-xs text-stone-500">
            Min 5 matches required
          </span>
        )}
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load leaderboard.
        </div>
      )}

      {!isLoading && !error && entries.length === 0 && (
        <EmptyState
          variant="sigil"
          title="No entries"
          body="No players qualify for this ranking yet."
          motto="In lapide sigillata."
          mottoTitle="Karaz Ankor"
        />
      )}

      {!isLoading && !error && entries.length > 0 && (
        <div>
          <div className="overflow-x-auto rounded-md border border-rizzotto-iron-700/70 bg-rizzotto-iron-900/50 backdrop-blur-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rizzotto-iron-800/80 bg-rizzotto-iron-900/60">
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Rank</th>
                  <th className="px-4 py-3 text-left font-medium text-stone-400">Player</th>
                  {isRateBased && (
                    <th className="px-4 py-3 text-right font-medium text-stone-400">
                      {mode === 'winrate' ? 'Win Rate' : 'Weighted WR'}
                    </th>
                  )}
                  {mode === 'season_points' && (
                    <th className="px-4 py-3 text-right font-medium text-stone-400">Points</th>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-stone-400">ELO</th>
                  <th className="px-4 py-3 text-center font-medium text-stone-400">W / L</th>
                  <th className="px-4 py-3 text-right font-medium text-stone-400">Games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {entries.map((entry) => {
                  const isFirst = entry.rank === 1;
                  const rowClass = isFirst
                    ? 'bg-warhammer-gold/5 hover:bg-warhammer-gold/10'
                    : 'hover:bg-stone-800/30';
                  const rateVal = entry[rateKey] as number | undefined;
                  return (
                    <tr key={entry.user.id} className={`transition-colors ${rowClass}`}>
                      <td className="px-4 py-3">
                        <RankCell rank={entry.rank} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/users/$id"
                          params={{ id: entry.user.id }}
                          className="flex items-center gap-2 hover:text-warhammer-gold transition-colors"
                        >
                          <Avatar url={entry.user.avatar_url} username={entry.user.username} />
                          <span
                            className={
                              isFirst ? 'font-semibold text-warhammer-gold' : 'text-stone-200'
                            }
                          >
                            {entry.user.username}
                          </span>
                        </Link>
                      </td>
                      {isRateBased && (
                        <td className="px-4 py-3 text-right font-semibold text-rizzotto-gold-400">
                          {rateVal != null ? `${(rateVal * 100).toFixed(1)}%` : '—'}
                        </td>
                      )}
                      {mode === 'season_points' && (
                        <td className="px-4 py-3 text-right text-stone-200">
                          {entry.total_points}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <EloRatingDisplay rating={entry.elo_rating} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-center text-stone-300">
                        <span className="text-emerald-400">{entry.wins}</span>
                        <span className="text-stone-600"> / </span>
                        <span className="text-red-400">{entry.losses}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-stone-400">
                        {entry.matches_played}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Back
              </button>
              <span className="text-stone-500">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy LeaderboardTable (kept for season + all-time tabs)
// ---------------------------------------------------------------------------

interface LeaderboardTableProps {
  entries: (LeaderboardEntryDto | AllTimeEntry)[];
  isLoading: boolean;
  error: Error | null;
  extraColumn: 'seasons_participated' | null;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

function LeaderboardTable({
  entries,
  isLoading,
  error,
  extraColumn,
  page,
  totalPages,
  onPageChange,
}: LeaderboardTableProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">{t('common.loading')}</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        {t('leaderboard.load_error')}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        variant="sigil"
        title={t('leaderboard.empty_title')}
        body={t('leaderboard.empty_body')}
        motto={t('leaderboard.empty_motto')}
        mottoTitle={t('leaderboard.empty_motto_title')}
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-rizzotto-iron-700/70 bg-rizzotto-iron-900/50 bg-parchment-aged-texture bg-[length:512px_512px] bg-blend-overlay backdrop-blur-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-rizzotto-iron-800/80 bg-rizzotto-iron-900/60">
              <th className="px-4 py-3 text-left font-medium text-stone-400">{t('leaderboard.columns.rank')}</th>
              <th className="px-4 py-3 text-left font-medium text-stone-400">{t('leaderboard.columns.player')}</th>
              <th className="px-4 py-3 text-right font-medium text-stone-400">{t('leaderboard.columns.points')}</th>
              <th className="px-4 py-3 text-right font-medium text-stone-400">{t('leaderboard.columns.elo')}</th>
              <th className="px-4 py-3 text-center font-medium text-stone-400">{t('leaderboard.columns.wl')}</th>
              <th className="px-4 py-3 text-right font-medium text-stone-400">{t('leaderboard.columns.games')}</th>
              {extraColumn === 'seasons_participated' && (
                <th className="px-4 py-3 text-right font-medium text-stone-400">{t('leaderboard.columns.seasons')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {entries.map((entry) => {
              const isFirst = entry.rank === 1;
              const rowClass = isFirst
                ? 'bg-warhammer-gold/5 hover:bg-warhammer-gold/10'
                : 'hover:bg-stone-800/30';
              return (
                <tr key={entry.user.id} className={`transition-colors ${rowClass}`}>
                  <td className="px-4 py-3">
                    <RankCell rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/users/$id"
                      params={{ id: entry.user.id }}
                      className="flex items-center gap-2 hover:text-warhammer-gold transition-colors"
                    >
                      <Avatar url={entry.user.avatar_url} username={entry.user.username} />
                      <span className={isFirst ? 'font-semibold text-warhammer-gold' : 'text-stone-200'}>
                        {entry.user.username}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-stone-200">{entry.total_points}</td>
                  <td className="px-4 py-3 text-right">
                    <EloRatingDisplay rating={entry.elo_rating} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-center text-stone-300">
                    <span className="text-emerald-400">{entry.wins}</span>
                    <span className="text-stone-600"> / </span>
                    <span className="text-red-400">{entry.losses}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-stone-400">{entry.matches_played}</td>
                  {extraColumn === 'seasons_participated' && (
                    <td className="px-4 py-3 text-right text-stone-400">
                      {(entry as AllTimeEntry).seasons_participated}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← {t('common.back')}
          </button>
          <span className="text-stone-500">
            {t('common.page_of', { page, total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('common.next')} →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Shell
// ---------------------------------------------------------------------------

const TABS_CONFIG: { id: Tab; label: string }[] = [
  { id: 'season', label: 'Season Points' },
  { id: 'winrate', label: 'Win Rate' },
  { id: 'weighted_winrate', label: 'Weighted Win Rate' },
  { id: 'all-time', label: 'All Time' },
];

export function LeaderboardPage() {
  const { t } = useTranslation();

  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'season';
  const validIds = TABS_CONFIG.map((tc) => tc.id);
  const [activeTab, setActiveTab] = useState<Tab>(
    validIds.includes(initialTab as Tab) ? initialTab : 'season',
  );

  function changeTab(t: Tab) {
    setActiveTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState({}, '', url.toString());
  }

  return (
    <PageShell variant="wide">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-6">
        {t('leaderboard.title')}
      </h1>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-1 w-fit">
        {TABS_CONFIG.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => changeTab(id)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === id
                ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'season' && <SeasonTab />}
      {activeTab === 'all-time' && <AllTimeTab />}
      {(activeTab === 'season_points' ||
        activeTab === 'winrate' ||
        activeTab === 'weighted_winrate') && (
        <ModeTab mode={activeTab} />
      )}
    </PageShell>
  );
}
