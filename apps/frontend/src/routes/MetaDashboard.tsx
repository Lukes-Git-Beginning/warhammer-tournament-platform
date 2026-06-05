import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMetaOverview, getMatchupHeatmap, getMatchupMatrix, getFactions, getMetaGames } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { MatchupHeatmap } from '@/components/meta/MatchupHeatmap';
import { ModelMatchupHeatmap } from '@/components/meta/ModelMatchupHeatmap';
import { GameHistoryTable } from '@/components/match/GameHistoryTable';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/ui/empty-state';
import type { FactionWithStatsDto } from '@rizzotto/types';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/50 p-4 backdrop-blur-sm">
      <p className="text-xs text-rizzotto-stone-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="font-display text-2xl font-bold text-rizzotto-stone-100">{value}</p>
    </div>
  );
}

function FactionRow({
  entry,
  rank,
  trailing,
}: {
  entry: FactionWithStatsDto;
  rank: number;
  trailing: string;
}) {
  const { faction } = entry;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-5 text-right text-xs text-rizzotto-stone-600">#{rank}</span>
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="sm"
        iconUrl={faction.icon_url}
      />
      <span className="flex-1 text-sm text-rizzotto-stone-200">{faction.name}</span>
      <span className="text-sm text-rizzotto-stone-400">{trailing}</span>
    </div>
  );
}

export function MetaDashboard() {
  const { t } = useTranslation();

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
  } = useQuery({
    queryKey: ['meta-overview'],
    queryFn: () => getMetaOverview(),
  });

  const {
    data: heatmap,
    isLoading: heatmapLoading,
    error: heatmapError,
  } = useQuery({
    queryKey: ['meta-matchups'],
    queryFn: () => getMatchupHeatmap(),
    enabled: !!overview?.season,
  });

  const seasonId = overview?.season?.id;

  const { data: gamesData } = useQuery({
    queryKey: ['meta-games'],
    queryFn: () => getMetaGames(1, 50),
  });

  const {
    data: matrixData,
    isLoading: matrixLoading,
    error: matrixError,
  } = useQuery({
    queryKey: ['matchup-matrix', seasonId],
    queryFn: () => getMatchupMatrix(seasonId),
    enabled: !!seasonId,
  });

  const {
    data: factionsData,
    isLoading: factionsLoading,
  } = useQuery({
    queryKey: ['factions', seasonId],
    queryFn: () => getFactions(seasonId),
    enabled: !!seasonId,
  });

  const hasNoSeason = !!overview && !overview.season;
  const hasSeason = !!overview?.season;

  return (
    <PageShell variant="wide">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('meta_page.title')}
        </h1>
        {overview?.season && (
          <p className="mt-1 text-sm text-rizzotto-stone-500">
            {t('meta_page.season_label', { name: overview.season.name })}
          </p>
        )}
      </header>

      {overviewLoading && (
        <div className="py-8 text-center text-rizzotto-stone-400 text-sm">
          {t('common.loading')}
        </div>
      )}

      {overviewError && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          {t('meta_page.error')}
        </div>
      )}

      {hasNoSeason && (
        <EmptyState
          variant="sigil"
          title={t('meta_page.no_season_title')}
          body={t('meta_page.no_season_body')}
          motto={t('meta_page.no_season_motto')}
          mottoTitle={t('meta_page.no_season_motto_title')}
        />
      )}

      {hasSeason && overview && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-10 sm:grid-cols-4">
            <StatCard
              label={t('meta_page.stat_total_matches')}
              value={overview.total_matches}
            />
            <StatCard
              label={t('meta_page.stat_faction_diversity')}
              value={`${Math.round(overview.faction_diversity * 100)}%`}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2 mb-10">
            <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
              <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-4">
                {t('meta_page.top_winrate')}
              </h2>
              <div className="divide-y divide-rizzotto-iron-800/60">
                {overview.top_factions_by_winrate.map((entry, i) => (
                  <FactionRow
                    key={entry.faction.id}
                    entry={entry}
                    rank={i + 1}
                    trailing={
                      entry.stats && entry.stats.win_rate !== null
                        ? `${Math.round(entry.stats.win_rate * 100)}%`
                        : '—'
                    }
                  />
                ))}
              </div>
            </section>

            <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
              <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-4">
                {t('meta_page.most_picked')}
              </h2>
              <div className="divide-y divide-rizzotto-iron-800/60">
                {overview.top_factions_by_pickrate.map((entry, i) => (
                  <FactionRow
                    key={entry.faction.id}
                    entry={entry}
                    rank={i + 1}
                    trailing={t('meta_page.matches_count', {
                      count: entry.stats?.matches_played ?? 0,
                    })}
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
            <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-1">
              {t('meta_page.heatmap.title')}
            </h2>
            <p className="text-xs text-rizzotto-stone-500 mb-4">{t('meta_page.heatmap.legend')}</p>

            {heatmapLoading && (
              <div className="py-8 text-center text-rizzotto-stone-400 text-sm">
                {t('meta_page.heatmap.loading')}
              </div>
            )}

            {heatmapError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
                {t('meta_page.heatmap.error')}
              </div>
            )}

            {heatmap && heatmap.cells.length === 0 && (
              <p className="py-6 text-center text-sm text-rizzotto-stone-500 italic">
                {t('meta_page.heatmap.empty')}
              </p>
            )}

            {heatmap && heatmap.cells.length > 0 && (
              <MatchupHeatmap cells={heatmap.cells} factions={heatmap.factions} />
            )}
          </section>

          <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
            <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-1">
              Model Matchup Matrix
            </h2>
            <p className="text-xs text-rizzotto-stone-500 mb-4">
              Win chance predicted by the L2-Logistic-Regression model at neutral, equal-proficiency
              conditions. Low-sample cells are faded.
            </p>

            {(matrixLoading || factionsLoading) && (
              <div className="py-8 text-center text-rizzotto-stone-400 text-sm">
                {t('common.loading')}
              </div>
            )}

            {matrixError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
                Failed to load model matchup data.
              </div>
            )}

            {matrixData && factionsData && matrixData.entries.length === 0 && (
              <p className="py-6 text-center text-sm text-rizzotto-stone-500 italic">
                No model matchup data available for this season yet.
              </p>
            )}

            {matrixData && factionsData && matrixData.entries.length > 0 && (
              <ModelMatchupHeatmap
                entries={matrixData.entries}
                factions={factionsData.data.map((f) => f.faction)}
              />
            )}
          </section>
        </>
      )}

      {/* ─── Global Game History ─── */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500 mb-4">
          Letzte Spiele
        </h2>
        {gamesData && <GameHistoryTable games={gamesData.games} showTournament />}
        {!gamesData && (
          <div className="flex justify-center py-6">
            <span className="h-5 w-5 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          </div>
        )}
      </section>
    </PageShell>
  );
}
