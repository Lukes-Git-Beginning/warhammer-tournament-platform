import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getSkillHistory } from '@/lib/api.js';

interface Props {
  userId: string;
}

export function SkillHistoryChart({ userId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['skill-history', userId],
    queryFn: () => getSkillHistory(userId),
  });

  const points = data?.points ?? [];

  // Nothing to show yet — render a subtle placeholder rather than crashing.
  if (!isLoading && !error && points.length === 0) {
    return (
      <p className="text-sm text-stone-500 italic">No skill history yet.</p>
    );
  }

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      {isLoading && (
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      )}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load skill history.
        </div>
      )}

      {!isLoading && !error && points.length > 0 && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={points} margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              width={40}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{
                background: '#1c1917',
                border: '1px solid #44403c',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="generalSkill"
              name="General Skill"
              stroke="#d4a853"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
