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
  ReferenceLine,
} from 'recharts';
import { listSeasons, getAdminEloDistribution } from '@/lib/api.js';

export function EloDistributionChart() {
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined);

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });
  const seasons = seasonsData?.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-elo-distribution', selectedSeason],
    queryFn: () => getAdminEloDistribution({ season: selectedSeason }),
  });

  const chartData = (data?.buckets ?? []).map((b) => ({
    bucket: `${b.bucket}`,
    count: b.count,
  }));

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        ELO Distribution
      </h3>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs text-stone-400">Season</label>
        <select
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          value={selectedSeason ?? ''}
          onChange={(e) => setSelectedSeason(e.target.value || undefined)}
        >
          <option value="">All</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* KPI row */}
      {data && (
        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Median', value: data.median },
            { label: 'p1', value: data.p1 },
            { label: 'p99', value: data.p99 },
            { label: 'Total Players', value: data.total },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="rounded border border-stone-800 bg-stone-900/60 px-3 py-2"
            >
              <div className="text-lg font-bold text-rizzotto-gold-400">{kpi.value}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load ELO distribution.
        </div>
      )}

      {!isLoading && !error && (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="bucket"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <Tooltip
              formatter={(v) => [v, 'Players']}
              labelFormatter={(label) => `ELO ${label}–${Number(label) + 49}`}
              contentStyle={{
                background: '#1c1917',
                border: '1px solid #44403c',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            {data?.median != null && (
              <ReferenceLine
                x={String(Math.floor(data.median / 50) * 50)}
                stroke="#d4a853"
                strokeDasharray="4 2"
                label={{ value: 'Median', fill: '#d4a853', fontSize: 10 }}
              />
            )}
            <Bar dataKey="count" fill="#57534e" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
