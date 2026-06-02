import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getFaction } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import type { SnapshotTrendEntry } from '@rizzotto/types';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4">
      <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-stone-100">{value}</p>
    </div>
  );
}

function TrendSparkline({ trend }: { trend: SnapshotTrendEntry[] }) {
  if (trend.length === 0) {
    return <p className="text-sm text-stone-600">Keine Trend-Daten vorhanden.</p>;
  }

  const maxMatches = Math.max(...trend.map((t) => t.matches_played), 1);

  return (
    <div className="space-y-1">
      {trend.map((entry) => {
        const barWidth = maxMatches > 0 ? (entry.matches_played / maxMatches) * 100 : 0;
        const wr = entry.win_rate !== null ? Math.round(entry.win_rate * 100) : null;
        return (
          <div key={entry.date} className="flex items-center gap-3 text-xs">
            <span className="w-20 text-stone-500 shrink-0">{entry.date}</span>
            <div className="flex-1 bg-stone-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-rizzotto-gold-500/60 rounded-full"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="w-12 text-right text-stone-400">{entry.matches_played} Sp.</span>
            <span className="w-10 text-right text-stone-400">{wr !== null ? `${wr}%` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FactionDetailPage() {
  const { id } = useParams({ from: '/factions/$id' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['faction', id],
    queryFn: () => getFaction(id),
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="py-8 text-center text-stone-400 text-sm">Wird geladen…</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Fraktion konnte nicht geladen werden.
        </div>
      </main>
    );
  }

  const { faction, stats, trend } = data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <div className="flex items-center gap-5 mb-8">
        <FactionBadge
          colorHex={faction.color_hex}
          initials={faction.initials}
          name={faction.name}
          size="lg"
          iconUrl={faction.icon_url}
        />
        <div>
          <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">{faction.name}</h1>
          <div className="flex gap-3 text-sm text-stone-500 mt-1">
            <span>{faction.race}</span>
            <span>·</span>
            <span>{faction.category}</span>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 mb-10">
          <StatCard label="Spiele" value={stats.matches_played} />
          <StatCard label="Siege" value={<span className="text-emerald-400">{stats.wins}</span>} />
          <StatCard
            label="Niederlagen"
            value={<span className="text-red-400">{stats.losses}</span>}
          />
          <StatCard label="Unentschieden" value={stats.draws} />
          <StatCard
            label="Winrate"
            value={
              stats.win_rate !== null ? (
                <span className={stats.win_rate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                  {Math.round(stats.win_rate * 100)}%
                </span>
              ) : (
                '—'
              )
            }
          />
        </div>
      ) : (
        <div className="rounded-md border border-stone-800 bg-stone-900/40 p-4 text-stone-500 text-sm mb-10">
          Noch keine Statistiken für diese Fraktion vorhanden.
        </div>
      )}

      {/* Trend */}
      <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
        <h2 className="font-display text-lg font-semibold text-stone-100 mb-4">30-Tage-Trend</h2>
        <TrendSparkline trend={trend} />
      </section>
    </main>
  );
}
