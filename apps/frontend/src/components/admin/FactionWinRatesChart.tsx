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
} from 'recharts';
import { getAdminFactionWinRates, listSeasons, type FactionWinRateEntry } from '@/lib/api.js';

type Period = 'last_30d' | 'last_90d' | 'season';

function SortIcon({ asc }: { asc: boolean }) {
  return <span className="ml-1 text-stone-500 text-xs">{asc ? '▲' : '▼'}</span>;
}

export function FactionWinRatesChart() {
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined);
  const [period, setPeriod] = useState<Period>('season');
  const [sortKey, setSortKey] = useState<keyof FactionWinRateEntry>('win_rate');
  const [sortAsc, setSortAsc] = useState(false);

  const { data: seasonsData } = useQuery({
    queryKey: ['seasons'],
    queryFn: listSeasons,
  });
  const seasons = seasonsData?.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-faction-winrates', selectedSeason, period],
    queryFn: () => getAdminFactionWinRates({ season: selectedSeason, period }),
  });

  const entries = [...(data?.data ?? [])].sort((a, b) => {
    const va = a[sortKey] as number;
    const vb = b[sortKey] as number;
    return sortAsc ? va - vb : vb - va;
  });

  function toggleSort(key: keyof FactionWinRateEntry) {
    if (sortKey === key) {
      setSortAsc((p) => !p);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const chartData = entries.slice(0, 20).map((e) => ({
    name: e.faction_name.length > 12 ? e.faction_name.slice(0, 12) + '…' : e.faction_name,
    win_rate: Math.round(e.win_rate * 1000) / 10,
  }));

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
        Faction Win Rates
      </h3>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone-400">Period</label>
          <select
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <option value="last_30d">Last 30 days</option>
            <option value="last_90d">Last 90 days</option>
            <option value="season">Season</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load faction win rates.
        </div>
      )}

      {!isLoading && !error && (
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Bar chart */}
          <div className="min-w-0 xl:w-1/2">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#d1d5db', fontSize: 11 }}
                  width={100}
                />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Win Rate']}
                  contentStyle={{
                    background: '#1c1917',
                    border: '1px solid #44403c',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="win_rate" fill="#d4a853" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="min-w-0 xl:w-1/2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-stone-800">
                  <th className="px-3 py-2 text-left text-stone-400">Faction</th>
                  <th
                    className="px-3 py-2 text-right text-stone-400 cursor-pointer hover:text-stone-200"
                    onClick={() => toggleSort('wins')}
                  >
                    W {sortKey === 'wins' && <SortIcon asc={sortAsc} />}
                  </th>
                  <th
                    className="px-3 py-2 text-right text-stone-400 cursor-pointer hover:text-stone-200"
                    onClick={() => toggleSort('losses')}
                  >
                    L {sortKey === 'losses' && <SortIcon asc={sortAsc} />}
                  </th>
                  <th
                    className="px-3 py-2 text-right text-stone-400 cursor-pointer hover:text-stone-200"
                    onClick={() => toggleSort('win_rate')}
                  >
                    WR% {sortKey === 'win_rate' && <SortIcon asc={sortAsc} />}
                  </th>
                  <th
                    className="px-3 py-2 text-right text-stone-400 cursor-pointer hover:text-stone-200"
                    onClick={() => toggleSort('sample_size')}
                  >
                    N {sortKey === 'sample_size' && <SortIcon asc={sortAsc} />}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-stone-500">
                      No data.
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.faction_id} className="hover:bg-stone-800/30 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {e.icon_url ? (
                          <img
                            src={e.icon_url}
                            alt={e.faction_name}
                            className="h-5 w-5 object-contain"
                          />
                        ) : (
                          <span className="h-5 w-5 flex items-center justify-center rounded bg-stone-800 text-[10px] text-stone-400">
                            {e.faction_name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="text-stone-200">{e.faction_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-400">{e.wins}</td>
                    <td className="px-3 py-2 text-right text-red-400">{e.losses}</td>
                    <td className="px-3 py-2 text-right text-rizzotto-gold-400 font-semibold">
                      {(e.win_rate * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right text-stone-500">{e.sample_size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
