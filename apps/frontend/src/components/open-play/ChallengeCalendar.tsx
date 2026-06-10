import { useRef, useEffect, useMemo } from 'react';
import type { MatchFormat } from '../../lib/api';

// Duration in hours per format
const FORMAT_DURATION_H: Record<MatchFormat, number> = {
  BO1: 0.5,
  BO3: 1.5,
  BO5: 2.5,
};
// How many hour-rows to highlight (ceil)
const FORMAT_ROWS: Record<MatchFormat, number> = {
  BO1: 1,
  BO3: 2,
  BO5: 3,
};

// Same display ordering as availability grid: 6am → 5am
const DISPLAY_HOURS = [
  ...Array.from({ length: 18 }, (_, i) => i + 6),
  ...Array.from({ length: 6 }, (_, i) => i),
];
const ROW_H = 28;
const VISIBLE_ROWS = 18;
const START_HOUR = 8;

interface ChallengeCalendarProps {
  format: MatchFormat;
  selected: Date | null;
  onSelect: (date: Date) => void;
}

export function ChallengeCalendar({ format, selected, onSelect }: ChallengeCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const durationRows = FORMAT_ROWS[format];

  // Compute the 7 real calendar days once on mount
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
      const idx = DISPLAY_HOURS.indexOf(START_HOUR);
      scrollRef.current.scrollTop = idx * ROW_H;
    }
  }, []);

  function isPast(day: Date, hour: number): boolean {
    const slot = new Date(day);
    slot.setHours(hour, 0, 0, 0);
    return slot.getTime() <= Date.now();
  }

  // Returns 'start' | 'span' | null for selection state
  function selectionRole(day: Date, hour: number): 'start' | 'span' | null {
    if (!selected) return null;
    const selDay = new Date(selected);
    selDay.setHours(0, 0, 0, 0);
    const thisDay = new Date(day);
    thisDay.setHours(0, 0, 0, 0);
    if (selDay.getTime() !== thisDay.getTime()) return null;
    const startH = selected.getHours();
    if (hour === startH) return 'start';
    if (hour > startH && hour < startH + durationRows) return 'span';
    return null;
  }

  function handleClick(day: Date, hour: number) {
    if (isPast(day, hour)) return;
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    onSelect(d);
  }

  function dayHeader(d: Date) {
    return {
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    };
  }

  const colTemplate = `44px repeat(7, 1fr)`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 380 }}>
      {/* Day headers with real dates */}
      <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: 40 }} />
        {days.map((d, i) => {
          const { weekday, date } = dayHeader(d);
          return (
            <div
              key={i}
              style={{ height: 40, background: i === 0 ? 'hsl(38,8%,14%)' : 'hsl(20,3%,11%)' }}
              className="flex flex-col items-center justify-center border-b border-stone-700"
            >
              <span className="text-[11px] font-medium text-stone-400">{weekday}</span>
              <span className={`text-[11px] ${i === 0 ? 'text-amber-400' : 'text-stone-500'}`}>{date}</span>
            </div>
          );
        })}
      </div>

      {/* Scrollable hour rows */}
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
              {days.map((day, dayIdx) => {
                const past = isPast(day, hour);
                const role = selectionRole(day, hour);
                let bg: string;
                if (role === 'start')   bg = 'rgba(245,158,11,0.75)';
                else if (role === 'span') bg = 'rgba(245,158,11,0.30)';
                else if (past)           bg = 'hsl(20,3%,9%)';
                else                     bg = dayIdx === 0 ? 'hsl(38,6%,14%)' : 'hsl(20,3%,13%)';

                return (
                  <div
                    key={`${dayIdx}-${hour}`}
                    style={{ height: ROW_H, background: bg }}
                    onClick={() => handleClick(day, hour)}
                    className={[
                      'border-b border-r border-stone-700/30 transition-colors',
                      past ? 'cursor-not-allowed' : 'cursor-pointer',
                      !past && !role && 'hover:bg-amber-500/20',
                    ].filter(Boolean).join(' ')}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Duration hint */}
      {selected && (
        <p className="mt-2 text-xs text-stone-400">
          Selected:{' '}
          <span className="text-amber-400">
            {selected.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
            at {String(selected.getHours()).padStart(2, '0')}:00
          </span>
          {' '}· ~{FORMAT_DURATION_H[format] * 60} min reserved
        </p>
      )}
    </div>
  );
}
