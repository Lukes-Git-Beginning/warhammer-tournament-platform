import { useQuery } from '@tanstack/react-query';
import { getMetaOverview, getMatchupHeatmap } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { MatchupHeatmap } from '@/components/meta/MatchupHeatmap';
import type { FactionWithStatsDto } from '@tww3/types';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4">
      <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-stone-100">{value}</p>
    </div>
  );
}

function FactionRow({ entry, rank }: { entry: FactionWithStatsDto; rank: number }) {
  const { faction, stats } = entry;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-5 text-right text-xs text-stone-600">#{rank}</span>
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="sm"
      />
      <span className="flex-1 text-sm text-stone-200">{faction.name}</span>
      {stats && (
        <span className="text-sm text-stone-400">
          {stats.win_rate !== null ? `${Math.round(stats.win_rate * 100)}%` : '—'}
        </span>
      )}
    </div>
  );
}

function FactionPickRow({ entry, rank }: { entry: FactionWithStatsDto; rank: number }) {
  const { faction, stats } = entry;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-5 text-right text-xs text-stone-600">#{rank}</span>
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="sm"
      />
      <span className="flex-1 text-sm text-stone-200">{faction.name}</span>
      {stats && (
        <span className="text-sm text-stone-400">{stats.matches_played} Spiele</span>
      )}
    </div>
  );
}

export function MetaDashboard() {
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
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-warhammer-gold mb-2">Meta-Dashboard</h1>
      {overview?.season && (
        <p className="text-sm text-stone-500 mb-8">Season: {overview.season.name}</p>
      )}

      {/* Stat Cards */}
      {overview && (
        <div className="grid grid-cols-2 gap-4 mb-10 sm:grid-cols-4">
          <StatCard label="Gesamt-Matches" value={overview.total_matches} />
          <StatCard
            label="Fraktions-Vielfalt"
            value={`${Math.round(overview.faction_diversity * 100)}%`}
          />
        </div>
      )}

      {overviewLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>
      )}
      {overviewError && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm mb-8">
          Fehler beim Laden der Meta-Daten.
        </div>
      )}

      {overview && (
        <div className="grid gap-6 md:grid-cols-2 mb-10">
          {/* Top Winrate */}
          <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
            <h2 className="font-display text-lg font-semibold text-stone-100 mb-4">
              Top Winrate Fraktionen
            </h2>
            <div className="divide-y divide-stone-800/60">
              {overview.top_factions_by_winrate.map((entry, i) => (
                <FactionRow key={entry.faction.id} entry={entry} rank={i + 1} />
              ))}
            </div>
          </section>

          {/* Most Picked */}
          <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
            <h2 className="font-display text-lg font-semibold text-stone-100 mb-4">
              Meistgespielte Fraktionen
            </h2>
            <div className="divide-y divide-stone-800/60">
              {overview.top_factions_by_pickrate.map((entry, i) => (
                <FactionPickRow key={entry.faction.id} entry={entry} rank={i + 1} />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Heatmap */}
      <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
        <h2 className="font-display text-lg font-semibold text-stone-100 mb-1">
          Matchup-Heatmap
        </h2>
        <p className="text-xs text-stone-500 mb-4">
          Grün = Vorteil aus Zeilenperspektive · Rot = Nachteil · Transparenz = wenige Daten (&lt;5 Matches)
        </p>
        {heatmapLoading && (
          <div className="py-8 text-center text-stone-400 text-sm">Heatmap wird geladen…</div>
        )}
        {heatmapError && (
          <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
            Fehler beim Laden der Heatmap.
          </div>
        )}
        {heatmap && (
          <MatchupHeatmap cells={heatmap.cells} factions={heatmap.factions} />
        )}
      </section>
    </main>
  );
}
