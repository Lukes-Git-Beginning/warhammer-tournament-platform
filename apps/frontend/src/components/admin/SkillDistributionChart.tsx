import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getAdminSkillDistribution } from '@/lib/api.js';

const COLOR_Q = '#d4a853'; // with questionnaire — gold
const COLOR_DATA = '#78716c'; // games only — stone

export function SkillDistributionChart() {
  // Skill is timeless — the band distribution spans all versions, so there is no version selector.
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-skill-distribution'],
    queryFn: () => getAdminSkillDistribution(),
  });

  const chartData = (data?.distribution ?? []).map((d) => ({
    name: `${d.band} ${d.name}`,
    questionnaire: d.withQuestionnaire,
    dataOnly: d.dataOnly,
  }));
  const classified = (data?.distribution ?? []).reduce((s, d) => s + d.withQuestionnaire + d.dataOnly, 0);

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-1">
        Skill Level Distribution
      </h3>
      <p className="mb-4 text-xs text-stone-500">
        Players per band, split by whether they filled in the questionnaire or are rated from games alone.
      </p>

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
                contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 6, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="questionnaire" name="With questionnaire" stackId="a" fill={COLOR_Q} />
              <Bar dataKey="dataOnly" name="Games only" stackId="a" fill={COLOR_DATA} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-3 text-xs text-stone-500">
            {classified} classified player{classified === 1 ? '' : 's'}
            {data?.unclassified ? (
              <>
                {' · '}
                <span className="text-stone-400">{data.unclassified}</span> unclassified — no questionnaire
                and no games, so <em>not</em> placed in a band (not counted as New)
              </>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

