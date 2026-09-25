import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getAdminGamesOverTime, type UsageRange } from '@/lib/api.js';

const RANGES: { value: UsageRange; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All-Time' },
];

const TOOLTIP_STYLE = {
  background: '#1c1917',
  border: '1px solid #44403c',
  borderRadius: 6,
  fontSize: 12,
} as const;

/** Games per bucket split by source: tournament / ladder (queue) / challenge. Game-level. */
export function UsageOverTimeChart() {
  const [range, setRange] = useState<UsageRange>('month');
  const [mode, setMode] = useState<'line' | 'stacked'>('line');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-games-over-time', range],
    queryFn: () => getAdminGamesOverTime(range),
  });
  const series = data?.data ?? [];
  const bucket = data?.bucket ?? 'day';
  // Month buckets show YYYY-MM; day/week buckets show MM-DD.
  const fmtTick = (d: string) => (bucket === 'month' ? d.slice(0, 7) : d.slice(5));

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Usage over time</h3>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as UsageRange)}
            aria-label="Time range"
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="inline-flex overflow-hidden rounded border border-stone-700">
            {(['line', 'stacked'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-rizzotto-gold-500 text-stone-950'
                    : 'bg-stone-900 text-stone-300 hover:bg-stone-800'
                }`}
              >
                {m === 'line' ? 'Line' : 'Stacked'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load usage data.
        </div>
      )}

      {!isLoading && !error && (
        <ResponsiveContainer width="100%" height={300}>
          {mode === 'stacked' ? (
            <AreaChart data={series} margin={{ left: 4, right: 16, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtTick} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} width={32} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="tournament" name="Tournament" stackId="1" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.5} strokeWidth={2} />
              <Area type="monotone" dataKey="ladder" name="Ladder" stackId="1" stroke="#d4a853" fill="#d4a853" fillOpacity={0.5} strokeWidth={2} />
              <Area type="monotone" dataKey="challenge" name="Challenge" stackId="1" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.5} strokeWidth={2} />
            </AreaChart>
          ) : (
            <LineChart data={series} margin={{ left: 4, right: 16, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtTick} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} width={32} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="tournament" name="Tournament" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="ladder" name="Ladder" stroke="#d4a853" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="challenge" name="Challenge" stroke="#a78bfa" dot={false} strokeWidth={2} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}
