import type { AvailabilityContext, HeatmapSlot } from '../../lib/api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface AvailabilityHeatmapProps {
  slots: HeatmapSlot[];
  context: AvailabilityContext;
}

function intensityColor(count: number, max: number): string {
  if (max === 0 || count === 0) return 'hsl(0, 0%, 12%)';
  const ratio = Math.min(count / max, 1);
  // amber scale: dark (0) → bright amber (1)
  const lightness = 15 + 55 * ratio;
  const saturation = 10 + 70 * ratio;
  return `hsl(38, ${saturation.toFixed(0)}%, ${lightness.toFixed(0)}%)`;
}

export function AvailabilityHeatmap({ slots, context }: AvailabilityHeatmapProps) {
  const filtered = slots.filter((s) => s.context === context);
  const lookup = new Map(filtered.map((s) => [`${s.day_of_week}:${s.hour_utc}`, s.count]));
  const max = Math.max(0, ...filtered.map((s) => s.count));

  return (
    <div className="overflow-x-auto">
      <div className="grid" style={{ gridTemplateColumns: `40px repeat(7, 1fr)`, minWidth: 360 }}>
        <div className="h-7" />
        {DAYS.map((d) => (
          <div key={d} className="h-7 flex items-center justify-center text-xs text-stone-400 font-medium">
            {d}
          </div>
        ))}
        {HOURS.map((hour) => (
          <>
            <div key={`h${hour}`} className="h-6 flex items-center justify-end pr-2 text-xs text-stone-500">
              {String(hour).padStart(2, '0')}
            </div>
            {Array.from({ length: 7 }, (_, day) => {
              const count = lookup.get(`${day}:${hour}`) ?? 0;
              return (
                <div
                  key={`${day}-${hour}`}
                  className="h-6 border border-stone-800/50"
                  style={{ background: intensityColor(count, max) }}
                  title={count > 0 ? `${count} player${count === 1 ? '' : 's'} available` : undefined}
                />
              );
            })}
          </>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
        <span>Low</span>
        <div className="flex gap-0.5">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => (
            <div
              key={r}
              className="h-3 w-5"
              style={{ background: intensityColor(Math.round(r * 10), 10) }}
            />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  );
}
