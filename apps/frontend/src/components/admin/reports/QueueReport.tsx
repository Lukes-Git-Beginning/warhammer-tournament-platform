import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdminQueueReport, type AdminQueueReport } from '@/lib/api.js';
import { formatReportDay, formatWait, queueTotals } from '@/lib/queue-report';
import { Kpi } from './PlayersReport.js';
import { Heat } from './ScheduleReport.js';

type Layer = 'unmatchedGrid' | 'joinsGrid';
const LAYERS: { key: Layer; label: string; hint: string }[] = [
  {
    key: 'unmatchedGrid',
    label: 'Without a match',
    hint: 'Joins that ended without a match (left or timed out), by the hour they joined',
  },
  { key: 'joinsGrid', label: 'All joins', hint: 'Every queue join, by the hour it happened' },
];

const num = 'px-2 py-1.5 text-right tabular-nums';

/**
 * What became of every Open Play queue join (backend lib/admin-queue-report.ts): matched, left or
 * timed out, per day and by weekday × hour, in site time.
 */
export function QueueReport({ days }: { days: number }) {
  const [layer, setLayer] = useState<Layer>('unmatchedGrid');
  const { data, isLoading, error } = useQuery<AdminQueueReport>({
    queryKey: ['admin-queue-report', days],
    queryFn: () => getAdminQueueReport(days),
    staleTime: 60_000,
  });
  const t = useMemo(() => queueTotals(data?.daily ?? []), [data]);

  if (isLoading) return <p className="py-4 text-center text-sm text-stone-400">Loading…</p>;
  if (error || !data) {
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
        Failed to load the Open Play queue report.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Open Play queue</h3>
          <p className="text-xs text-stone-500">
            Every queue join (on the site or with a Discord button) and how it ended: matched, either with
            another player in the queue or with an available player who took the DM&rsquo;s offer; left by
            the player; or timed out, removed after 30 minutes without a match. Days and hours in site time (
            {data.timezone}).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Joins" value={t.joins} sub={`${t.days} ${t.days === 1 ? 'day' : 'days'}`} />
          <Kpi label="Matched" value={`${t.matchedPct}%`} sub={`${t.matched} · ${t.matchedViaDm} via DM`} />
          <Kpi
            label="Without a match"
            value={`${t.unmatchedPct}%`}
            sub={`${t.left} left · ${t.expired} timed out`}
          />
          <Kpi label="Missed per day" value={t.unmatchedPerDay} sub="joins without a match" />
          <Kpi label="No game per day" value={t.playersWithoutGamePerDay} sub="players who joined, but got no game" />
          <Kpi
            label="Median wait"
            value={formatWait(data.medianWaitToMatchSec)}
            sub={`to a match · ${formatWait(data.medianWaitBeforeLeavingSec)} before leaving`}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <div>
          <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">When it happens</h3>
          <p className="text-xs text-stone-500">
            Weekday × hour of the join. Compare with Matchmaking availability on the Schedule tab.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              type="button"
              title={l.hint}
              onClick={() => setLayer(l.key)}
              className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                layer === l.key
                  ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/15 text-rizzotto-gold-300'
                  : 'border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Heat grid={data[layer]} />
      </section>

      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">By day</h3>
        <p className="mb-2 text-xs text-stone-500">
          &ldquo;No game&rdquo; counts the players who joined that day and got no match from any of their joins.
        </p>
        {data.daily.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-500">No queue joins yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-2 py-1.5">Day</th>
                  <th className={num}>Joins</th>
                  <th className={num}>Matched</th>
                  <th className={num}>via DM</th>
                  <th className={num}>Left</th>
                  <th className={num}>Timed out</th>
                  <th className={num}>Players</th>
                  <th className={num}>No game</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr
                    key={d.day}
                    className={`border-t border-rizzotto-iron-800 ${d.joins ? 'text-stone-300' : 'text-stone-600'}`}
                  >
                    <td className="px-2 py-1.5">{formatReportDay(d.day)}</td>
                    <td className={`${num} font-semibold ${d.joins ? 'text-stone-100' : ''}`}>{d.joins}</td>
                    <td className={num}>{d.matched}</td>
                    <td className={num}>{d.matchedViaDm}</td>
                    <td className={num}>{d.left}</td>
                    <td className={num}>{d.expired}</td>
                    <td className={num}>{d.players}</td>
                    <td className={`${num} ${d.playersWithoutGame ? 'text-red-300' : ''}`}>
                      {d.playersWithoutGame}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {t.waiting > 0 && (
          <p className="mt-2 text-xs text-stone-500">
            {t.waiting} {t.waiting === 1 ? 'join is' : 'joins are'} still in the queue and not counted as
            matched or missed yet.
          </p>
        )}
      </section>
    </div>
  );
}
