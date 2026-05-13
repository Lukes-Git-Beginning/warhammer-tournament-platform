import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  getLeaderboard,
  getAllTimeLeaderboard,
  listSeasons,
  type AllTimeEntry,
} from '@/lib/api';
import type { LeaderboardEntryDto } from '@tww3/types';
import { EloRatingDisplay } from '../components/meta/EloRatingDisplay';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/ui/empty-state';

type Tab = 'season' | 'all-time';

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

function SeasonTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>(undefined);

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });

  // Resolve effective seasonId: use selected or default to active season
  const seasons = seasonsData?.data ?? [];
  const activeSeason = seasons.find((s) => s.is_active);
  const effectiveSeasonId = selectedSeasonId ?? activeSeason?.id;

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['leaderboard', effectiveSeasonId, page],
    queryFn: () => getLeaderboard({ seasonId: effectiveSeasonId, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      {/* Season selector */}
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
      <div className="overflow-x-auto rounded-md border border-karaz-iron-700/70 bg-karaz-iron-900/50 bg-parchment-aged-texture bg-[length:512px_512px] bg-blend-overlay backdrop-blur-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-karaz-iron-800/80 bg-karaz-iron-900/60">
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

      {/* Pagination */}
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

export function LeaderboardPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('season');

  return (
    <PageShell variant="wide">
      <h1 className="font-display text-3xl font-bold text-karaz-gold-500 mb-6">
        {t('leaderboard.title')}
      </h1>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-md border border-karaz-iron-700 bg-karaz-iron-900/60 p-1 w-fit">
        {(['season', 'all-time'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-karaz-gold-500/20 text-karaz-gold-500'
                : 'text-karaz-stone-400 hover:text-karaz-stone-200'
            }`}
          >
            {tab === 'season' ? t('leaderboard.tabs.season') : t('leaderboard.tabs.all_time')}
          </button>
        ))}
      </div>

      {activeTab === 'season' ? <SeasonTab /> : <AllTimeTab />}
    </PageShell>
  );
}
