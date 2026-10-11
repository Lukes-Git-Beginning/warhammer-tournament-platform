import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdminPlayersReport } from '@/lib/api.js';
import { buildFunnel } from '@/lib/player-report';

function Cell({ n, of }: { n: number; of: number }) {
  const pct = of ? Math.round((n / of) * 100) : 0;
  return (
    <td className="px-3 py-2">
      <span className="text-stone-200">{n}</span>
      <span className="ml-1.5 text-stone-500">{pct}%</span>
      <div className="mt-1 h-1 rounded bg-stone-800">
        <div className="h-1 rounded bg-rizzotto-gold-500/70" style={{ width: `${pct}%` }} />
      </div>
    </td>
  );
}

/** Sign-up cohorts: how far each month's new accounts got. Uses all-time data (not the window). */
export function FunnelReport({ days }: { days: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-players-report', days],
    queryFn: () => getAdminPlayersReport(days),
    staleTime: 60_000,
  });
  const cohorts = useMemo(() => buildFunnel(data?.players ?? [], Date.now()), [data]);

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Sign-up funnel</h3>
      <p className="mb-3 text-xs text-stone-500">
        Accounts by sign-up month and how far they got: Steam verified, first game, five games, and
        still playing (a game in the last 30 days). Percentages are of that month&rsquo;s sign-ups.
        Independent of the window.
      </p>
      {isLoading && <p className="py-4 text-center text-sm text-stone-400">Loading…</p>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
          Failed to load.
        </div>
      )}
      {cohorts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Signed up</th>
                <th className="px-3 py-2">Steam verified</th>
                <th className="px-3 py-2">Played 1+</th>
                <th className="px-3 py-2">Played 5+</th>
                <th className="px-3 py-2">Active (30d)</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.month} className="border-t border-rizzotto-iron-800">
                  <td className="px-3 py-2 font-medium text-stone-200">{c.month}</td>
                  <td className="px-3 py-2 text-stone-200">{c.registered}</td>
                  <Cell n={c.verified} of={c.registered} />
                  <Cell n={c.played1} of={c.registered} />
                  <Cell n={c.played5} of={c.registered} />
                  <Cell n={c.active30} of={c.registered} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
