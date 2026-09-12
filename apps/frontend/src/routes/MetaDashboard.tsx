import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMetaOverview,
  getMatchupHeatmap,
  getMatchupMatrix,
  getFactions,
  getMetaGames,
  getDuoMeta,
  listVersions,
  type BattleType,
} from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { MatchupHeatmap } from '@/components/meta/MatchupHeatmap';
import { ModelMatchupHeatmap } from '@/components/meta/ModelMatchupHeatmap';
import { GameHistoryTable } from '@/components/match/GameHistoryTable';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/ui/empty-state';
import type { FactionWithStatsDto, DuoStatDto } from '@rizzotto/types';

const BATTLE_TYPES: { value: BattleType; label: string }[] = [
  { value: 'DOMINATION', label: 'Domination' },
  { value: 'CONQUEST', label: 'Conquest' },
  { value: 'SIEGE', label: 'Siege' },
];

type Format = 'ONE_V_ONE' | 'TWO_V_TWO';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/50 p-4 backdrop-blur-sm">
      <p className="text-xs text-rizzotto-stone-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="font-display text-2xl font-bold text-rizzotto-stone-100">{value}</p>
    </div>
  );
}

/** Segmented filter pill — mirrors the Tournaments tab filter style. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
          : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
      }`}
    >
      {children}
    </button>
  );
}

/** Small uppercase group label to the left of a filter cluster. */
function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-rizzotto-stone-500">{children}</span>
  );
}

function FactionRow({ entry, rank, trailing }: { entry: FactionWithStatsDto; rank: number; trailing: string }) {
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

/** One 2v2 duo (two faction badges + names) with a trailing metric. */
function DuoRow({ duo, rank, trailing }: { duo: DuoStatDto; rank: number; trailing: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-5 text-right text-xs text-rizzotto-stone-600">#{rank}</span>
      <div className="flex items-center gap-1">
        {duo.factions.map((f, i) =>
          f ? (
            <FactionBadge key={i} colorHex={f.color_hex} initials={f.initials} name={f.name} size="sm" iconUrl={f.icon_url} />
          ) : (
            <span key={i} className="text-xs text-rizzotto-stone-600">?</span>
          ),
        )}
      </div>
      <span className="flex-1 text-sm text-rizzotto-stone-200">
        {duo.factions.map((f) => f?.name ?? 'Unknown').join(' + ')}
      </span>
      <span className="text-sm text-rizzotto-stone-400">{trailing}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
      <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-4">{title}</h2>
      <div className="divide-y divide-rizzotto-iron-800/60">{children}</div>
    </section>
  );
}

export function MetaDashboard() {
  const { t } = useTranslation();

  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [battleType, setBattleType] = useState<BattleType>('DOMINATION');
  const [format, setFormat] = useState<Format>('ONE_V_ONE');
  const is2v2 = format === 'TWO_V_TWO';

  // Versions for the selector; default the dropdown to the active version once loaded.
  const { data: versionsData } = useQuery({ queryKey: ['versions'], queryFn: () => listVersions() });
  const versions = versionsData?.data ?? [];
  const activeVersion = versions.find((v) => v.is_active) ?? versions[0];
  const versionId = selectedVersionId || activeVersion?.id;

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
  } = useQuery({
    queryKey: ['meta-overview', versionId, battleType],
    queryFn: () => getMetaOverview(versionId, battleType),
    enabled: !!versionId,
  });

  // 1v1 — live matchup heatmap.
  const {
    data: heatmap,
    isLoading: heatmapLoading,
    error: heatmapError,
  } = useQuery({
    queryKey: ['meta-matchups', versionId, battleType],
    queryFn: () => getMatchupHeatmap(versionId, battleType),
    enabled: !!versionId && !is2v2,
  });

  // 2v2 — faction-duo meta (replaces the heatmap).
  const {
    data: duos,
    isLoading: duosLoading,
    error: duosError,
  } = useQuery({
    queryKey: ['meta-duos', versionId, battleType],
    queryFn: () => getDuoMeta(versionId, battleType),
    enabled: !!versionId && is2v2,
  });

  // 1v1 — model-predicted matchup matrix.
  const {
    data: matrixData,
    isLoading: matrixLoading,
    error: matrixError,
  } = useQuery({
    queryKey: ['matchup-matrix', versionId],
    queryFn: () => getMatchupMatrix(versionId),
    enabled: !!versionId && !is2v2,
  });

  const { data: factionsData, isLoading: factionsLoading } = useQuery({
    queryKey: ['factions', versionId],
    queryFn: () => getFactions(versionId),
    enabled: !!versionId && !is2v2,
  });

  const [gamesPage, setGamesPage] = useState(1);
  const GAMES_PAGE_SIZE = 50;
  const { data: gamesData } = useQuery({
    queryKey: ['meta-games', gamesPage, format],
    queryFn: () => getMetaGames(gamesPage, GAMES_PAGE_SIZE, { competitorFormat: format }),
  });

  const hasNoVersion = !!versionsData && versions.length === 0;
  const hasVersion = !!versionId;

  return (
    <PageShell variant="wide">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">{t('meta_page.title')}</h1>

        {/* Filters — Version · Battle type · Format (Tournaments-tab style) */}
        {versions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <FilterLabel>Version</FilterLabel>
              <select
                value={versionId ?? ''}
                onChange={(e) => setSelectedVersionId(e.target.value)}
                className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-3 py-1.5 text-sm font-medium text-rizzotto-stone-200 transition-colors hover:border-rizzotto-iron-500 focus:border-rizzotto-gold-500 focus:outline-none"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.is_active ? ' (active)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <FilterLabel>Battle type</FilterLabel>
              {BATTLE_TYPES.map((b) => (
                <FilterChip key={b.value} active={battleType === b.value} onClick={() => setBattleType(b.value)}>
                  {b.label}
                </FilterChip>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <FilterLabel>Format</FilterLabel>
              <FilterChip
                active={format === 'ONE_V_ONE'}
                onClick={() => {
                  setFormat('ONE_V_ONE');
                  setGamesPage(1);
                }}
              >
                1v1
              </FilterChip>
              <FilterChip
                active={format === 'TWO_V_TWO'}
                onClick={() => {
                  setFormat('TWO_V_TWO');
                  setGamesPage(1);
                }}
              >
                2v2
              </FilterChip>
            </div>
          </div>
        )}
      </header>

      {overviewLoading && (
        <div className="py-8 text-center text-rizzotto-stone-400 text-sm">{t('common.loading')}</div>
      )}

      {overviewError && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          {t('meta_page.error')}
        </div>
      )}

      {hasNoVersion && (
        <EmptyState
          variant="sigil"
          title={t('meta_page.no_version_title')}
          body={t('meta_page.no_version_body')}
          motto={t('meta_page.no_version_motto')}
          mottoTitle={t('meta_page.no_version_motto_title')}
        />
      )}

      {/* ─────────────── 1v1 view ─────────────── */}
      {hasVersion && !is2v2 && overview && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-10 sm:grid-cols-4">
            <StatCard label={t('meta_page.stat_total_games')} value={overview.total_games} />
            <StatCard
              label={t('meta_page.stat_faction_diversity')}
              value={`${Math.round(overview.faction_diversity * 100)}%`}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2 mb-10">
            <Panel title={t('meta_page.top_winrate')}>
              {overview.top_factions_by_winrate.map((entry, i) => (
                <FactionRow
                  key={entry.faction.id}
                  entry={entry}
                  rank={i + 1}
                  trailing={
                    entry.stats && entry.stats.win_rate !== null ? `${Math.round(entry.stats.win_rate * 100)}%` : '—'
                  }
                />
              ))}
            </Panel>

            <Panel title={t('meta_page.most_picked')}>
              {overview.top_factions_by_pickrate.map((entry, i) => (
                <FactionRow
                  key={entry.faction.id}
                  entry={entry}
                  rank={i + 1}
                  trailing={t('meta_page.matches_count', { count: entry.stats?.matches_played ?? 0 })}
                />
              ))}
            </Panel>
          </div>

          <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
            <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-1">
              {t('meta_page.heatmap.title')}
            </h2>
            <p className="text-xs text-rizzotto-stone-500 mb-4">{t('meta_page.heatmap.legend')}</p>

            {heatmapLoading && (
              <div className="py-8 text-center text-rizzotto-stone-400 text-sm">{t('meta_page.heatmap.loading')}</div>
            )}
            {heatmapError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
                {t('meta_page.heatmap.error')}
              </div>
            )}
            {heatmap && heatmap.cells.length === 0 && (
              <p className="py-6 text-center text-sm text-rizzotto-stone-500 italic">{t('meta_page.heatmap.empty')}</p>
            )}
            {heatmap && heatmap.cells.length > 0 && (
              <MatchupHeatmap cells={heatmap.cells} factions={heatmap.factions} />
            )}
          </section>

          <section className="rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/40 p-5 backdrop-blur-sm">
            <h2 className="font-display text-lg font-semibold text-rizzotto-stone-100 mb-1">Model Matchup Matrix</h2>
            <p className="text-xs text-rizzotto-stone-500 mb-4">
              Win chance predicted by the L2-Logistic-Regression model at neutral, equal-proficiency conditions.
              Low-sample cells are faded.
            </p>

            {(matrixLoading || factionsLoading) && (
              <div className="py-8 text-center text-rizzotto-stone-400 text-sm">{t('common.loading')}</div>
            )}
            {matrixError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
                Failed to load model matchup data.
              </div>
            )}
            {matrixData && factionsData && matrixData.entries.length === 0 && (
              <p className="py-6 text-center text-sm text-rizzotto-stone-500 italic">
                No model matchup data available for this version yet.
              </p>
            )}
            {matrixData && factionsData && matrixData.entries.length > 0 && (
              <ModelMatchupHeatmap entries={matrixData.entries} factions={factionsData.data.map((f) => f.faction)} />
            )}
          </section>
        </>
      )}

      {/* ─────────────── 2v2 view — faction-duo meta (no heatmap: 576 duos is infeasible) ─────────────── */}
      {hasVersion && is2v2 && (
        <>
          {duosLoading && (
            <div className="py-8 text-center text-rizzotto-stone-400 text-sm">{t('common.loading')}</div>
          )}
          {duosError && (
            <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
              Failed to load 2v2 duo meta.
            </div>
          )}
          {duos && duos.top_duos_by_pickrate.length === 0 && (
            <p className="py-6 text-center text-sm text-rizzotto-stone-500 italic">
              No 2v2 games recorded for this version and battle type yet.
            </p>
          )}
          {duos && duos.top_duos_by_pickrate.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2 mb-10">
              <Panel title="Top Winrate Duos">
                {duos.top_duos_by_winrate.map((d, i) => (
                  <DuoRow
                    key={i}
                    duo={d}
                    rank={i + 1}
                    trailing={`${Math.round(d.win_rate * 100)}% · ${d.games}g`}
                  />
                ))}
              </Panel>
              <Panel title="Most-picked Duos">
                {duos.top_duos_by_pickrate.map((d, i) => (
                  <DuoRow
                    key={i}
                    duo={d}
                    rank={i + 1}
                    trailing={t('meta_page.matches_count', { count: d.games })}
                  />
                ))}
              </Panel>
            </div>
          )}
        </>
      )}

      {/* ─── Global Game History (filtered to the selected format) ─── */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500">
            All Games
            {gamesData && <span className="ml-2 text-sm font-normal text-stone-500">({gamesData.total} total)</span>}
          </h2>
          {gamesData && gamesData.total > GAMES_PAGE_SIZE && (
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={() => setGamesPage((p) => Math.max(1, p - 1))}
                disabled={gamesPage === 1}
                className="px-3 py-1 rounded border border-stone-700 text-stone-400 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <span className="text-stone-500">
                {gamesPage} / {Math.ceil(gamesData.total / GAMES_PAGE_SIZE)}
              </span>
              <button
                onClick={() => setGamesPage((p) => p + 1)}
                disabled={gamesPage >= Math.ceil(gamesData.total / GAMES_PAGE_SIZE)}
                className="px-3 py-1 rounded border border-stone-700 text-stone-400 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
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
