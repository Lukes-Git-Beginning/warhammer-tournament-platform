import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { getSkillHistory } from '@/lib/api.js';
import { BANDS, THRESHOLDS, bandIndex, winChance } from '@/components/meta/skillBands.js';

interface Props {
  userId: string;
}

interface Row {
  date: string;
  winPct: number;
  band: number;
}

// Band boundaries as win-% vs the average player (sigmoid of the log-odds
// thresholds): New 0–20 · Beginner 20–35 · Intermediate 35–75 · Advanced
// 75–90 · Top 90–100.
const BAND_BOUNDS = THRESHOLDS.map((t) => winChance(t));

// Vertical centre of each band region (in win-%), used to place the right-hand
// legend labels beside — not inside — the plot: New · Beginner · Intermediate
// · Advanced · Top.
const BAND_LABEL_Y = [0, ...BAND_BOUNDS, 100].slice(0, 5).map((lo, i) => {
  const hi = [...BAND_BOUNDS, 100][i]!;
  return (lo + hi) / 2;
});

// Win-% cutoff range per band, shown on hover of the legend label.
const BAND_RANGE = BANDS.map((_, i) => {
  const lo = [0, ...BAND_BOUNDS][i]!;
  const hi = [...BAND_BOUNDS, 100][i]!;
  return `${Math.round(lo)}–${Math.round(hi)}%`;
});

interface BandLabelProps {
  idx?: number;
  viewBox?: { x: number; y: number; width: number; height: number };
}

// Legend label for one band, placed just right of the plot. Carries a native
// <title> so hovering the name reveals that band's win-% cutoff range.
function BandLabel({ idx = 0, viewBox }: BandLabelProps) {
  if (!viewBox) return null;
  return (
    <text
      x={viewBox.x + viewBox.width + 6}
      y={viewBox.y}
      fill={BANDS[idx]!.hex}
      fontSize={10}
      textAnchor="start"
      dominantBaseline="central"
      style={{ cursor: 'help' }}
    >
      {BANDS[idx]!.name}
      <title>{`${BANDS[idx]!.name}: ${BAND_RANGE[idx]} vs. average player`}</title>
    </text>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-stone-400">{row.date}</div>
      <div className="mt-0.5 font-medium" style={{ color: BANDS[row.band]!.hex }}>
        {BANDS[row.band]!.name}
      </div>
      <div className="text-stone-300">{Math.round(row.winPct)}% vs. average</div>
    </div>
  );
}

/**
 * General Skill over time, drawn as win-% vs the average player. The line is
 * painted in the colour of the skill band the player was in at each point,
 * flipping hard at the midpoint whenever the band changes. Dashed reference
 * lines mark the band boundaries.
 */
export function SkillHistoryChart({ userId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['skill-history', userId],
    queryFn: () => getSkillHistory(userId),
  });

  if (isLoading) {
    return <div className="h-[200px] animate-pulse rounded bg-stone-800/50" />;
  }
  if (error) {
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
        Failed to load skill history.
      </div>
    );
  }

  const rows: Row[] = (data?.points ?? []).map((p) => ({
    date: p.date,
    winPct: winChance(p.generalSkill),
    band: bandIndex(p.generalSkill),
  }));

  if (rows.length === 0) {
    return <p className="text-sm italic text-stone-500">No skill history yet.</p>;
  }

  // Piecewise-constant gradient along x: each segment takes its band's colour,
  // flipping at the midpoint between two points whenever the band changes.
  const n = rows.length;
  const stops: { offset: number; color: string }[] = [{ offset: 0, color: BANDS[rows[0]!.band]!.hex }];
  for (let i = 1; i < n; i++) {
    if (rows[i]!.band !== rows[i - 1]!.band) {
      const mid = (i - 0.5) / (n - 1);
      stops.push({ offset: mid, color: BANDS[rows[i - 1]!.band]!.hex });
      stops.push({ offset: mid, color: BANDS[rows[i]!.band]!.hex });
    }
  }
  stops.push({ offset: 1, color: BANDS[rows[n - 1]!.band]!.hex });

  const gradId = `skillband-${userId}`;
  const lastHex = BANDS[rows[n - 1]!.band]!.hex;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={rows} margin={{ left: 0, right: 84, top: 8, bottom: 4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={`${(s.offset * 100).toFixed(3)}%`} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#292524" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#78716c', fontSize: 10 }}
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={28}
          stroke="#44403c"
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={{ fill: '#78716c', fontSize: 10 }}
          width={38}
          tickFormatter={(v: number) => `${v}%`}
          stroke="#44403c"
        />
        {/* Band boundaries — dashed, no labels (names live in the right legend). */}
        {BAND_BOUNDS.map((y) => (
          <ReferenceLine key={y} y={y} stroke="#44403c" strokeDasharray="4 4" />
        ))}
        {/* Right-hand legend — each band name beside the plot, centred on its
            region, with a hover tooltip showing the band's win-% cutoff range. */}
        {BAND_LABEL_Y.map((y, i) => (
          <ReferenceLine key={`lbl-${i}`} y={y} stroke="transparent" label={<BandLabel idx={i} />} />
        ))}
        <Tooltip content={<ChartTooltip />} />
        <Line
          type="monotone"
          dataKey="winPct"
          stroke={`url(#${gradId})`}
          strokeWidth={2.5}
          dot={n === 1 ? { r: 4, fill: lastHex } : false}
          activeDot={{ r: 4, fill: lastHex, stroke: '#1c1917' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
