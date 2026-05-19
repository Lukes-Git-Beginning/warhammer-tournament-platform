import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getAdminDropOffFunnel, listTournaments, type DropOffFunnelStage } from '@/lib/api.js';

const STAGE_COLORS = ['#d4a853', '#b8923e', '#9c7b32', '#806427', '#644d1d'];

export function DropOffFunnelChart() {
  const [tournamentId, setTournamentId] = useState<string | undefined>(undefined);

  const { data: tournamentsData } = useQuery({
    queryKey: ['tournaments', 1, 100],
    queryFn: () => listTournaments(1, 100),
  });
  const tournaments = tournamentsData?.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-dropoff-funnel', tournamentId],
    queryFn: () => getAdminDropOffFunnel({ tournament_id: tournamentId }),
  });

  const stages: DropOffFunnelStage[] = data?.stages ?? [];
  const chartData = stages.map((s, i) => ({
    label: s.label,
    count: s.count,
    drop_pct: s.drop_pct,
    fill: STAGE_COLORS[i] ?? '#44403c',
  }));

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        Drop-off Funnel
      </h3>

      {/* Tournament selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs text-stone-400">Tournament</label>
        <select
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          value={tournamentId ?? ''}
          onChange={(e) => setTournamentId(e.target.value || undefined)}
        >
          <option value="">All Tournaments (Season Aggregate)</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load drop-off data.
        </div>
      )}

      {!isLoading && !error && stages.length === 0 && (
        <div className="py-8 text-center text-stone-500 text-sm">No funnel data available.</div>
      )}

      {!isLoading && !error && stages.length > 0 && (
        <div className="flex flex-col gap-6">
          {/* Horizontal bar chart acting as funnel */}
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fill: '#d1d5db', fontSize: 10 }}
                width={130}
              />
              <Tooltip
                formatter={(v, _name, props) => [
                  `${v} players (−${(props.payload as { drop_pct?: number }).drop_pct?.toFixed(1) ?? 0}% drop)`,
                  'Count',
                ]}
                contentStyle={{
                  background: '#1c1917',
                  border: '1px solid #44403c',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Stage pills */}
          <div className="flex flex-wrap gap-2">
            {stages.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded border border-stone-800 bg-stone-900/60 px-3 py-1.5 text-xs"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ background: STAGE_COLORS[i] ?? '#44403c' }}
                />
                <span className="text-stone-300">{s.label}:</span>
                <span className="font-semibold text-stone-100">{s.count}</span>
                {i > 0 && (
                  <span className="text-red-400">−{s.drop_pct.toFixed(1)}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
