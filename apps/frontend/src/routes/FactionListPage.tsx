import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getFactions } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import type { FactionWithStatsDto } from '@tww3/types';

function FactionCard({ entry }: { entry: FactionWithStatsDto }) {
  const { faction, stats } = entry;

  return (
    <Link
      to="/factions/$id"
      params={{ id: faction.id }}
      className="group flex flex-col items-center gap-2 rounded-md border border-stone-800 bg-stone-900/60 p-4 hover:border-stone-600 hover:bg-stone-800/40 transition-colors"
    >
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="md"
      />
      <span className="text-sm font-medium text-stone-200 text-center group-hover:text-warhammer-gold transition-colors leading-tight">
        {faction.name}
      </span>
      {stats ? (
        <div className="flex gap-3 text-xs text-stone-500">
          <span>{stats.matches_played} Spiele</span>
          <span>
            {stats.win_rate !== null ? `${Math.round(stats.win_rate * 100)}% WR` : '—'}
          </span>
        </div>
      ) : (
        <div className="text-xs text-stone-600">Keine Daten</div>
      )}
    </Link>
  );
}

export function FactionListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-warhammer-gold mb-2">Fraktionen</h1>
      {data?.season && (
        <p className="text-sm text-stone-500 mb-8">Season: {data.season.name}</p>
      )}

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Fehler beim Laden der Fraktionen.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.data.map((entry) => (
            <FactionCard key={entry.faction.id} entry={entry} />
          ))}
        </div>
      )}
    </main>
  );
}
