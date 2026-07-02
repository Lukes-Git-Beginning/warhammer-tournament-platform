import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getAdminGamesOverTime } from '@/lib/api.js';

/** Daily games split by source: tournament / ladder (queue) / challenge. Game-level. */
export function UsageOverTimeChart() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-games-over-time', 30],
    queryFn: () => getAdminGamesOverTime(30),
  });
  const series = data?.data ?? [];

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        Usage over time (last 30 days)
      </h3>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load usage data.
        </div>
      )}

      {!isLoading && !error && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series} margin={{ left: 4, right: 16, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="day"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} width={32} />
            <Tooltip
              contentStyle={{
                background: '#1c1917',
                border: '1px solid #44403c',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="tournament" name="Tournament" stroke="#38bdf8" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="ladder" name="Ladder" stroke="#d4a853" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="challenge" name="Challenge" stroke="#a78bfa" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
