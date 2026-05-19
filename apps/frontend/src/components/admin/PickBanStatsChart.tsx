import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { listSeasons, getAdminPickBanStats } from '@/lib/api.js';

type EntityType = 'maps' | 'factions';

export function PickBanStatsChart() {
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined);
  const [entity, setEntity] = useState<EntityType>('factions');

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });
  const seasons = seasonsData?.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-pickban-stats', selectedSeason, entity],
    queryFn: () => getAdminPickBanStats({ season: selectedSeason, entity }),
  });

  const sorted = [...(data?.data ?? [])].sort(
    (a, b) => b.picks + b.bans - (a.picks + a.bans),
  );

  const chartData = sorted.slice(0, 20).map((e) => ({
    name: e.entity_name.length > 10 ? e.entity_name.slice(0, 10) + '…' : e.entity_name,
    picks: e.picks,
    bans: e.bans,
    win_rate: Math.round(e.win_rate * 1000) / 10,
  }));

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        Pick / Ban Stats
      </h3>

      {/* Filters + entity toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Entity tab */}
        <div className="flex rounded border border-stone-700 overflow-hidden text-xs">
          {(['factions', 'maps'] as EntityType[]).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEntity(e)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                entity === e
                  ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-400'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
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
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load pick/ban data.
        </div>
      )}

      {!isLoading && !error && chartData.length === 0 && (
        <div className="py-8 text-center text-stone-500 text-sm">No data.</div>
      )}

      {!isLoading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ left: 0, right: 32, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              label={{ value: 'WR%', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 10 }}
            />
            <Tooltip
              formatter={(v, name) => {
                if (name === 'win_rate') return [`${v}%`, 'Win Rate'];
                return [v, name === 'picks' ? 'Picks' : 'Bans'];
              }}
              contentStyle={{
                background: '#1c1917',
                border: '1px solid #44403c',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 8 }}
            />
            <Bar yAxisId="left" dataKey="picks" stackId="a" fill="#d4a853" name="picks" />
            <Bar yAxisId="left" dataKey="bans" stackId="a" fill="#7f1d1d" name="bans" radius={[2, 2, 0, 0]} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="win_rate"
              stroke="#34d399"
              strokeWidth={2}
              dot={{ r: 3, fill: '#34d399' }}
              name="win_rate"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
