import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { FactionWithStatsDto } from '@rizzotto/types';

/**
 * Single-line y-axis label. A plain SVG <text> never wraps (unlike recharts'
 * default tick, which wraps when the name is wider than the axis), so every
 * faction name stays on exactly one line.
 */
function FactionTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#d1d5db" fontSize={11}>
      {payload?.value ?? ''}
    </text>
  );
}

/**
 * Horizontal faction bar chart, descending — the readable layout for ~24 factions. Each bar
 * carries its own single-line label (interval={0} + wide axis). Bars at 0 sink to the bottom;
 * if every value is 0 the chart doesn't render (nothing meaningful to show yet).
 */
export function FactionBarChart({
  data,
  title,
  valueLabel,
  color = '#d4a853',
}: {
  data: { name: string; value: number }[];
  title: string;
  valueLabel: string;
  color?: string;
}) {
  const chartData = data
    .map((d) => ({
      // Safety cap only — the axis is wide enough for the real faction names
      // (longest is "Warriors of Chaos"), so this rarely truncates.
      name: d.name.length > 20 ? `${d.name.slice(0, 20)}…` : d.name,
      value: d.value,
    }))
    .sort((a, b) => b.value - a.value);

  // Nothing to show yet → don't render an empty chart.
  if (chartData.every((d) => d.value === 0)) return null;

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="mb-4 text-xs uppercase tracking-wider text-stone-500">{title}</p>
      <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 24)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis type="number" allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" interval={0} tick={<FactionTick />} width={140} />
          <Tooltip
            formatter={(v) => [v, valueLabel]}
            contentStyle={{
              background: '#1c1917',
              border: '1px solid #44403c',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Faction popularity by games actually played — the original chart, kept as a thin wrapper
 * over the generic FactionBarChart so existing callers stay unchanged.
 */
export function FactionPopularityChart({ factions }: { factions: FactionWithStatsDto[] }) {
  return (
    <FactionBarChart
      title="Popularity — games played"
      valueLabel="Games"
      data={factions.map((e) => ({ name: e.faction.name, value: e.stats?.matches_played ?? 0 }))}
    />
  );
}

interface PopularityDatum {
  name: string;
  top: number;
  rest: number;
  total: number;
  topName: string | null;
}

/** Tooltip for the segmented popularity bar — shows the total plus the most prolific player. */
function PopularityTooltip({ active, payload }: { active?: boolean; payload?: { payload: PopularityDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div
      style={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 6, padding: '6px 10px' }}
    >
      <div className="text-xs font-medium text-stone-200">{d.name}</div>
      <div className="text-xs text-stone-400">{d.total} games</div>
      {d.topName && d.top > 0 && (
        <div className="text-xs text-rizzotto-gold-400">
          most: {d.topName} ({d.top})
        </div>
      )}
    </div>
  );
}

/**
 * Faction popularity where each bar is split into two segments: the most prolific single player's
 * share (gold) and everyone else (dim). Hovering shows that player's name + count. Same horizontal
 * layout as FactionBarChart; sorted by total games desc.
 */
export function FactionPopularitySegmentedChart({ factions }: { factions: FactionWithStatsDto[] }) {
  const chartData: PopularityDatum[] = factions
    .map((e) => {
      const total = e.stats?.matches_played ?? 0;
      const top = Math.min(e.stats?.top_player?.games ?? 0, total);
      return {
        name: e.faction.name.length > 20 ? `${e.faction.name.slice(0, 20)}…` : e.faction.name,
        top,
        rest: Math.max(0, total - top),
        total,
        topName: e.stats?.top_player?.username ?? null,
      };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  if (chartData.length === 0) return null;

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="text-xs uppercase tracking-wider text-stone-500">Popularity — games played</p>
      <p className="mb-4 text-[10px] italic text-stone-600">
        Gold segment = the faction&apos;s single most prolific player&apos;s share
      </p>
      <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 24)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis type="number" allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" interval={0} tick={<FactionTick />} width={140} />
          <Tooltip content={<PopularityTooltip />} cursor={{ fill: '#ffffff10' }} />
          <Bar dataKey="top" stackId="pop" fill="#d4a853" />
          <Bar dataKey="rest" stackId="pop" fill="#5f5233" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
