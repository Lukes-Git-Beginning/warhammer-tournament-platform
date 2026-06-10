import { useRef, useEffect, useMemo } from 'react';
import type { MatchFormat, HeatmapSlot } from '../../lib/api';

const FORMAT_DURATION_H: Record<MatchFormat, number> = { BO1: 0.5, BO3: 1.5, BO5: 2.5 };
const FORMAT_ROWS: Record<MatchFormat, number> = { BO1: 1, BO3: 2, BO5: 3 };

const DISPLAY_HOURS = [
  ...Array.from({ length: 18 }, (_, i) => i + 6),
  ...Array.from({ length: 6 }, (_, i) => i),
];
const ROW_H = 28;
const VISIBLE_ROWS = 18;
const START_HOUR = 8;

// Heatmap background: dark stone → warm amber
function heatmapBg(count: number, max: number): string {
  if (max === 0 || count === 0) return 'hsl(20,3%,13%)';
  const r = Math.min(count / max, 1);
  return `hsl(38,${(8 + 62 * r).toFixed(0)}%,${(13 + 45 * r).toFixed(0)}%)`;
}

interface ChallengeCalendarProps {
  format: MatchFormat;
  slots: HeatmapSlot[];   // community heatmap data (MATCHMAKING)
  selected: Date | null;
  onSelect: (date: Date) => void;
}

export function ChallengeCalendar({ format, slots, selected, onSelect }: ChallengeCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const durationRows = FORMAT_ROWS[format];

  // Aggregate heatmap slots into a lookup: "dayOfWeek:hour" → count
  // For the 7-day forward view we match by hour (local) since heatmap is weekly recurring
  const heatLookup = useMemo(() => {
    const m = new Map<number, number>(); // hour → total count across all days
    for (const s of slots) m.set(s.hour_utc, (m.get(s.hour_utc) ?? 0) + s.count);
    return m;
  }, [slots]);
  const heatMax = Math.max(0, ...heatLookup.values());

  const days = useMemo<Date[]>(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DISPLAY_HOURS.indexOf(START_HOUR) * ROW_H;
    }
  }, []);

  function isPast(day: Date, hour: number) {
    const slot = new Date(day); slot.setHours(hour, 0, 0, 0);
    return slot.getTime() <= Date.now();
  }

  function selRole(day: Date, hour: number): 'start' | 'span' | null {
    if (!selected) return null;
    const sDay = new Date(selected); sDay.setHours(0, 0, 0, 0);
    const tDay = new Date(day);      tDay.setHours(0, 0, 0, 0);
    if (sDay.getTime() !== tDay.getTime()) return null;
    const sh = selected.getHours();
    if (hour === sh) return 'start';
    if (hour > sh && hour < sh + durationRows) return 'span';
    return null;
  }

  function cellStyle(day: Date, hour: number): React.CSSProperties {
    const past = isPast(day, hour);
    const role = selRole(day, hour);
    const heat = heatLookup.get(hour) ?? 0;

    if (past) return { background: 'hsl(20,3%,9%)', opacity: 0.5 };

    // Selection overlays the heatmap
    if (role === 'start') return { background: 'rgba(56,189,248,0.85)', boxShadow: 'inset 0 0 0 2px rgba(186,230,253,0.8)' };
    if (role === 'span')  return { background: 'rgba(56,189,248,0.30)' };

    return { background: heatmapBg(heat, heatMax) };
  }

  const colTemplate = `44px repeat(7, 1fr)`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 380 }}>
      {/* Day headers with real dates */}
      <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: 40 }} />
        {days.map((d, i) => (
          <div
            key={i}
            style={{ height: 40, background: i === 0 ? 'hsl(38,8%,14%)' : 'hsl(20,3%,11%)' }}
            className="flex flex-col items-center justify-center border-b border-stone-700"
          >
            <span className="text-[11px] font-medium text-stone-400">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <span className={`text-[11px] ${i === 0 ? 'text-amber-400' : 'text-stone-500'}`}>
              {d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          </div>
        ))}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ height: VISIBLE_ROWS * ROW_H }}>
        <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
          {DISPLAY_HOURS.map((hour) => (
            <>
              <div
                key={`l-${hour}`}
                style={{ height: ROW_H, background: 'hsl(20,3%,11%)' }}
                className="flex items-center justify-end pr-2 text-xs text-stone-500 border-b border-stone-700/50"
              >
                {String(hour).padStart(2, '0')}
              </div>
              {days.map((day, di) => {
                const past = isPast(day, hour);
                const role = selRole(day, hour);
                return (
                  <div
                    key={`${di}-${hour}`}
                    style={{ height: ROW_H, ...cellStyle(day, hour) }}
                    onClick={() => { if (!past) { const d = new Date(day); d.setHours(hour, 0, 0, 0); onSelect(d); } }}
                    className={[
                      'border-b border-r border-stone-700/20 transition-colors',
                      past   ? 'cursor-not-allowed' : 'cursor-pointer',
                      !past && !role && 'hover:brightness-125',
                    ].filter(Boolean).join(' ')}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Legend + selection info */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm" style={{ background: heatmapBg(10, 10) }} />
            Many free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm" style={{ background: 'rgba(56,189,248,0.85)' }} />
            Your slot
          </span>
        </div>
        {selected ? (
          <span className="text-stone-300">
            <span className="text-sky-400">
              {selected.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
              {String(selected.getHours()).padStart(2, '0')}:00
            </span>
            {' '}· ~{FORMAT_DURATION_H[format] * 60} min
          </span>
        ) : (
          <span>Click a slot to schedule</span>
        )}
      </div>
    </div>
  );
}
