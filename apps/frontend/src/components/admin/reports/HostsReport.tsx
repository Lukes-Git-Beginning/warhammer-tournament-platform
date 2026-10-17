import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { SITE_TZ } from '@/lib/site-time';
import { getAdminHostsReport } from '@/lib/api.js';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: SITE_TZ,
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

/** Who hosts (main host + co-hosts): volume in the window, all time, field size, battle types. */
export function HostsReport({ days }: { days: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-hosts-report', days],
    queryFn: () => getAdminHostsReport(days),
    staleTime: 60_000,
  });

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Hosts</h3>
      <p className="mb-3 text-xs text-stone-500">
        Everyone who hosted or co-hosted. Window counts and average field size (sign-ups incl. later
        drops) cover the selected window; &ldquo;Upcoming&rdquo; are scheduled events that have not
        started yet.
      </p>
      {isLoading && <p className="py-4 text-center text-sm text-stone-400">Loading…</p>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
          Failed to load.
        </div>
      )}
      {data && data.hosts.length === 0 && (
        <p className="py-4 text-center text-sm text-stone-500">No hosts yet.</p>
      )}
      {data && data.hosts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Host</th>
                <th className="px-3 py-2">In window</th>
                <th className="px-3 py-2">All time</th>
                <th className="px-3 py-2">Upcoming</th>
                <th className="px-3 py-2">Avg field</th>
                <th className="px-3 py-2" title="Domination / Conquest / Land Battle / Siege in the window">
                  Dom / Conq / Land / Siege
                </th>
                <th className="px-3 py-2">Last hosted</th>
              </tr>
            </thead>
            <tbody>
              {data.hosts.map((h) => (
                <tr key={h.id} className="border-t border-rizzotto-iron-800 text-stone-300">
                  <td className="px-3 py-2">
                    <Link
                      to="/users/$id"
                      params={{ id: h.id }}
                      className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
                    >
                      {h.username}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-semibold text-stone-100">{h.hosted}</td>
                  <td className="px-3 py-2">{h.hostedTotal}</td>
                  <td className="px-3 py-2">{h.upcoming || '·'}</td>
                  <td className="px-3 py-2">{h.avgField ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-400">
                    {h.battleTypes.DOMINATION} / {h.battleTypes.CONQUEST} / {h.battleTypes.LAND_BATTLE} / {h.battleTypes.SIEGE}
                  </td>
                  <td className="px-3 py-2 text-stone-400">{fmtDate(h.lastHostedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
