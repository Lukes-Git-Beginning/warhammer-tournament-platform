import { useRef, useEffect } from 'react';
import type { HeatmapSlot } from '../../lib/api';
import { getUtcOffsetHours } from '../../lib/timezone';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => i);
const ROW_H = 28;
const VISIBLE_ROWS = 16;
const START_HOUR = 8;

function intensityColor(count: number, max: number, hue: number): string {
  if (max === 0 || count === 0) return 'hsl(20,3%,13%)';
  const ratio = Math.min(count / max, 1);
  const lightness = 13 + 45 * ratio;
  const saturation = 8 + 62 * ratio;
  return `hsl(${hue},${saturation.toFixed(0)}%,${lightness.toFixed(0)}%)`;
}

function utcToLocal(dayUtc: number, hourUtc: number, offset: number): { day: number; hour: number } {
  const total = dayUtc * 24 + hourUtc + offset;
  const day  = ((Math.floor(total / 24) % 7) + 7) % 7;
  const hour = ((total % 24) + 24) % 24;
  return { day, hour };
}

interface AvailabilityHeatmapProps {
  slots: HeatmapSlot[];
  userTimezone?: string;
  /** HSL hue for the density colour. 38 = amber (matchmaking), 199 = sky (tournament). */
  hue?: number;
}

export function AvailabilityHeatmap({ slots, userTimezone, hue = 38 }: AvailabilityHeatmapProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const offset = userTimezone ? getUtcOffsetHours(userTimezone) : 0;

  // Aggregate into local-time buckets
  const lookup = new Map<string, number>();
  for (const s of slots) {
    const { day, hour } = utcToLocal(s.day_of_week, s.hour_utc, offset);
    const key = `${day}:${hour}`;
    lookup.set(key, (lookup.get(key) ?? 0) + s.count);
  }
  const max = Math.max(0, ...lookup.values());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = START_HOUR * ROW_H;
    }
  }, []);

  const colTemplate = `44px repeat(7, 1fr)`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 380 }}>
      <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: ROW_H }} />
        {DAYS.map((d, i) => (
          <div
            key={d}
            style={{ height: ROW_H, background: i >= 5 ? 'hsl(22,6%,13%)' : 'hsl(20,3%,11%)' }}
            className="flex items-center justify-center text-xs font-medium text-stone-400 border-b border-stone-700"
          >
            {d}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="overflow-y-auto" style={{ height: VISIBLE_ROWS * ROW_H }}>
        <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
          {DISPLAY_HOURS.map((hour) => (
            <>
              <div
                key={`label-${hour}`}
                style={{ height: ROW_H, background: 'hsl(20,3%,11%)' }}
                className="flex items-center justify-end pr-2 text-xs text-stone-500 border-b border-stone-700/50"
              >
                {String(hour).padStart(2, '0')}
              </div>
              {Array.from({ length: 7 }, (_, day) => {
                const count = lookup.get(`${day}:${hour}`) ?? 0;
                return (
                  <div
                    key={`${day}-${hour}`}
                    style={{ height: ROW_H, background: intensityColor(count, max, hue) }}
                    className="border-b border-r border-stone-700/30"
                    title={count > 0 ? `${count} player${count === 1 ? '' : 's'} available` : undefined}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
        <span>Less</span>
        <div className="flex gap-0.5">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => (
            <div key={r} className="h-3 w-5 rounded-sm" style={{ background: intensityColor(Math.round(r * 10), 10, hue) }} />
          ))}
        </div>
        <span>More</span>
        <span className="ml-2 text-stone-600">· all players in your local time</span>
      </div>
    </div>
  );
}
