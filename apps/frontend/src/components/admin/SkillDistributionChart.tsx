import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getAdminSkillDistribution, listSeasons } from '@/lib/api.js';

// Distinct metals matching the band palette (New white … Top gold).
const BAND_COLORS: Record<number, string> = {
  1: '#e7e5e4', // New — white
  2: '#9a3412', // Beginner — rust
  3: '#c17f38', // Intermediate — bronze
  4: '#cbd5e1', // Advanced — silver
  5: '#d4a853', // Top — gold
};

export function SkillDistributionChart() {
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined);

  const { data: seasonsData } = useQuery({ queryKey: ['seasons'], queryFn: listSeasons });
  const seasons = seasonsData?.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-skill-distribution', selectedSeason],
    queryFn: () => getAdminSkillDistribution(selectedSeason),
  });

  const chartData = (data?.distribution ?? []).map((d) => ({
    name: `${d.band} ${d.name}`,
    band: d.band,
    count: d.count,
  }));
  const classified = (data?.distribution ?? []).reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        Skill Level Distribution
      </h3>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone-400">Season</label>
          <select
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            value={selectedSeason ?? ''}
            onChange={(e) => setSelectedSeason(e.target.value || undefined)}
          >
            <option value="">Active season</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load skill distribution.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                formatter={(v) => [v, 'Players']}
                contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {chartData.map((d) => (
                  <Cell key={d.band} fill={BAND_COLORS[d.band] ?? '#d4a853'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-3 text-xs text-stone-500">
            {classified} classified player{classified === 1 ? '' : 's'}
            {data?.unclassified ? (
              <>
                {' · '}
                <span className="text-stone-400">{data.unclassified}</span> without a level yet (no
                questionnaire or games)
              </>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}
