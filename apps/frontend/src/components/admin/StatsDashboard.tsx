import { useQuery } from '@tanstack/react-query';
import { getAdminStats, type AdminStats } from '@/lib/api';

interface KpiCardProps {
  label: string;
  value: string | number;
}

function KpiCard({ label, value }: KpiCardProps) {
  return (
    <div data-testid="kpi-card" className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-rizzotto-gold-500">{value}</p>
    </div>
  );
}

function TournamentCard({ data }: { data: AdminStats['tournaments'] }) {
  return (
    <div data-testid="kpi-card" className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Tournaments</p>
      <p className="mt-2 text-3xl font-bold text-rizzotto-gold-500">{data.total}</p>
      <div className="mt-2 flex gap-4 text-xs text-stone-400">
        <span className="text-emerald-400">{data.active} active</span>
        <span>{data.completed} completed</span>
      </div>
    </div>
  );
}

export function StatsDashboard() {
  const { data, isLoading, error } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: getAdminStats,
  });

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        Failed to load statistics.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        <KpiCard label="Active Users" value={data.activeUsers} />
        <TournamentCard data={data.tournaments} />
        <KpiCard label="Games Played" value={data.gamesPlayed} />
        <KpiCard label="Current Season" value={data.currentSeason ?? '—'} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-400">
        Open Play
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        <KpiCard label="In Queue" value={data.openPlay.queueDepth} />
        <KpiCard label="Active Ladder Matches" value={data.openPlay.activeMatches} />
        <KpiCard label="Scheduled (Accepted)" value={data.openPlay.scheduledAccepted} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-400">
          Top 5 Factions (this season)
        </h2>
        <div className="overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60">
                <th className="px-4 py-3 text-left font-medium text-stone-400">Rank</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Faction</th>
                <th className="px-4 py-3 text-right font-medium text-stone-400">Picks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {data.topFactions.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-stone-500">
                    No data.
                  </td>
                </tr>
              )}
              {data.topFactions.map((f, i) => (
                <tr key={f.faction_id} className="hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3 text-stone-400">#{i + 1}</td>
                  <td className="px-4 py-3 text-stone-200">{f.faction_name}</td>
                  <td className="px-4 py-3 text-right text-rizzotto-gold-500">{f.pick_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
