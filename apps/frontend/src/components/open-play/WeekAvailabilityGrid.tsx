import { useRef, useState, useEffect } from 'react';
import type { AvailabilityContext, AvailabilitySlot } from '../../lib/api';
import { getUtcOffsetHours } from '../../lib/timezone';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => i); // 0–23 local hours
const ROW_H = 28;
const VISIBLE_ROWS = 16;
const START_HOUR = 8;

const C_MATCHMAKING = 'rgba(245,158,11,0.65)';
const C_TOURNAMENT  = 'rgba(56,189,248,0.65)';
const C_BOTH        = `linear-gradient(135deg, ${C_MATCHMAKING} 50%, ${C_TOURNAMENT} 50%)`;

function emptyBg(displayIdx: number, dayIdx: number): string {
  const band = Math.floor(displayIdx / 3) % 2;
  const isWeekend = dayIdx >= 5;
  if (isWeekend) return band === 0 ? 'hsl(22,6%,16%)' : 'hsl(22,6%,13%)';
  return band === 0 ? 'hsl(20,3%,15%)' : 'hsl(20,3%,12%)';
}

// UTC {day,hour} → local {day,hour} given offset in whole hours
function utcToLocal(dayUtc: number, hourUtc: number, offset: number): { day: number; hour: number } {
  const total = dayUtc * 24 + hourUtc + offset;
  const day  = ((Math.floor(total / 24) % 7) + 7) % 7;
  const hour = ((total % 24) + 24) % 24;
  return { day, hour };
}

// Local {day,hour} → UTC {day,hour} given offset in whole hours
function localToUtc(dayLocal: number, hourLocal: number, offset: number): { day: number; hour: number } {
  const total = dayLocal * 24 + hourLocal - offset;
  const day  = ((Math.floor(total / 24) % 7) + 7) % 7;
  const hour = ((total % 24) + 24) % 24;
  return { day, hour };
}

interface WeekAvailabilityGridProps {
  slots: AvailabilitySlot[];
  editContext: AvailabilityContext;
  onChange: (slots: AvailabilitySlot[]) => void;
  disabled?: boolean;
  userTimezone?: string;
}

type Cell = { day: number; hour: number };

function getRect(a: Cell, b: Cell) {
  return {
    minDay: Math.min(a.day, b.day), maxDay: Math.max(a.day, b.day),
    minHour: Math.min(a.hour, b.hour), maxHour: Math.max(a.hour, b.hour),
  };
}

export function WeekAvailabilityGrid({ slots, editContext, onChange, disabled, userTimezone }: WeekAvailabilityGridProps) {
  const offset = userTimezone ? getUtcOffsetHours(userTimezone) : 0;

  // Current local day and hour for the "now" indicator
  const nowUtc = new Date();
  const { day: nowLocalDay, hour: nowLocalHour } = utcToLocal(
    (nowUtc.getUTCDay() + 6) % 7,
    nowUtc.getUTCHours(),
    offset,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragMode = useRef<'add' | 'remove'>('add');
  const dragAnchor = useRef<Cell | null>(null);
  const dragCurrent = useRef<Cell | null>(null);
  const [dragHighlight, setDragHighlight] = useState<Set<string>>(new Set());

  const slotsRef = useRef(slots);
  const editCtxRef = useRef(editContext);
  const onChangeRef = useRef(onChange);
  const offsetRef = useRef(offset);
  slotsRef.current = slots;
  editCtxRef.current = editContext;
  onChangeRef.current = onChange;
  offsetRef.current = offset;

  // Convert stored UTC slots to local {day, hour} for display
  const matchSet = new Set(
    slots.filter((s) => s.context === 'MATCHMAKING').map((s) => {
      const { day, hour } = utcToLocal(s.day_of_week, s.hour_utc, offset);
      return `${day}:${hour}`;
    }),
  );
  const tournSet = new Set(
    slots.filter((s) => s.context === 'TOURNAMENT').map((s) => {
      const { day, hour } = utcToLocal(s.day_of_week, s.hour_utc, offset);
      return `${day}:${hour}`;
    }),
  );
  const editSet = editContext === 'MATCHMAKING' ? matchSet : tournSet;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = START_HOUR * ROW_H;
    }
  }, []);

  useEffect(() => {
    const onUp = () => { if (isDragging.current) applyDrag(); };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  function highlightRect(anchor: Cell, current: Cell) {
    const rect = getRect(anchor, current);
    const hs = new Set<string>();
    for (let d = rect.minDay; d <= rect.maxDay; d++)
      for (let h = rect.minHour; h <= rect.maxHour; h++) hs.add(`${d}:${h}`);
    setDragHighlight(hs);
  }

  function applyDrag() {
    if (!dragAnchor.current || !dragCurrent.current) {
      isDragging.current = false; setDragHighlight(new Set()); return;
    }
    const s = slotsRef.current;
    const ctx = editCtxRef.current;
    const off = offsetRef.current;
    const rect = getRect(dragAnchor.current, dragCurrent.current);

    // Build set of currently selected local positions for this context
    const curLocalSet = new Set(
      s.filter((sl) => sl.context === ctx).map((sl) => {
        const { day, hour } = utcToLocal(sl.day_of_week, sl.hour_utc, off);
        return `${day}:${hour}`;
      }),
    );

    const other = s.filter((sl) => sl.context !== ctx);
    const same  = s.filter((sl) => sl.context === ctx);

    if (dragMode.current === 'add') {
      const toAdd: AvailabilitySlot[] = [];
      for (let d = rect.minDay; d <= rect.maxDay; d++) {
        for (let h = rect.minHour; h <= rect.maxHour; h++) {
          if (!curLocalSet.has(`${d}:${h}`)) {
            const utc = localToUtc(d, h, off);
            toAdd.push({ day_of_week: utc.day, hour_utc: utc.hour, context: ctx });
          }
        }
      }
      onChangeRef.current([...other, ...same, ...toAdd]);
    } else {
      onChangeRef.current([
        ...other,
        ...same.filter((sl) => {
          const { day: ld, hour: lh } = utcToLocal(sl.day_of_week, sl.hour_utc, off);
          return !(ld >= rect.minDay && ld <= rect.maxDay && lh >= rect.minHour && lh <= rect.maxHour);
        }),
      ]);
    }
    isDragging.current = false;
    dragAnchor.current = null; dragCurrent.current = null;
    setDragHighlight(new Set());
  }

  function onCellDown(day: number, hour: number) {
    if (disabled) return;
    isDragging.current = true;
    dragMode.current = editSet.has(`${day}:${hour}`) ? 'remove' : 'add';
    dragAnchor.current = { day, hour }; dragCurrent.current = { day, hour };
    highlightRect({ day, hour }, { day, hour });
  }

  function onCellEnter(day: number, hour: number) {
    if (!isDragging.current || !dragAnchor.current) return;
    dragCurrent.current = { day, hour };
    highlightRect(dragAnchor.current, { day, hour });
  }

  function getCellStyle(day: number, hour: number, displayIdx: number): React.CSSProperties {
    const hasM = matchSet.has(`${day}:${hour}`);
    const hasT = tournSet.has(`${day}:${hour}`);
    const highlighted = dragHighlight.has(`${day}:${hour}`);

    if (highlighted) {
      const previewColor = editContext === 'MATCHMAKING' ? C_MATCHMAKING : C_TOURNAMENT;
      if (dragMode.current === 'add') return { background: previewColor, opacity: 0.8 };
      return { background: 'rgba(239,68,68,0.35)' };
    }
    if (hasM && hasT) return { background: C_BOTH };
    if (hasM)         return { background: C_MATCHMAKING };
    if (hasT)         return { background: C_TOURNAMENT };
    return { background: emptyBg(displayIdx, day) };
  }

  const colTemplate = `44px repeat(7, 1fr)`;
  const offsetLabel = offset === 0 ? 'UTC' : offset > 0 ? `UTC+${offset}` : `UTC${offset}`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 380 }}>
      <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: ROW_H }} />
        {DAYS.map((d, i) => (
          <div
            key={d}
            style={{
              height: ROW_H,
              background: i === nowLocalDay
                ? 'hsl(40,35%,16%)'
                : (i >= 5 ? 'hsl(22,6%,13%)' : 'hsl(20,3%,11%)'),
            }}
            className={[
              'flex items-center justify-center text-xs font-medium border-b',
              i === nowLocalDay ? 'text-amber-400 border-amber-800' : 'text-stone-400 border-stone-700',
            ].join(' ')}
          >
            {d}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="overflow-y-auto" style={{ height: VISIBLE_ROWS * ROW_H }}>
        <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
          {DISPLAY_HOURS.map((hour, displayIdx) => (
            <>
              <div
                key={`label-${hour}`}
                style={{ height: ROW_H, background: 'hsl(20,3%,11%)' }}
                className={[
                  'flex items-center justify-end pr-2 text-xs border-b border-stone-700/50',
                  hour === nowLocalHour ? 'text-amber-400 font-semibold' : 'text-stone-500',
                ].join(' ')}
              >
                {String(hour).padStart(2, '0')}
              </div>
              {Array.from({ length: 7 }, (_, day) => (
                <div
                  key={`cell-${day}-${hour}`}
                  style={{ height: ROW_H, ...getCellStyle(day, hour, displayIdx) }}
                  onMouseDown={() => onCellDown(day, hour)}
                  onMouseEnter={() => onCellEnter(day, hour)}
                  className={[
                    'border-b border-r border-stone-700/30 transition-colors',
                    !disabled && 'cursor-pointer',
                    disabled && 'opacity-50 cursor-not-allowed',
                  ].filter(Boolean).join(' ')}
                />
              ))}
            </>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={{ background: C_MATCHMAKING }} />
          Matchmaking
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={{ background: C_TOURNAMENT }} />
          Tournaments
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={{ background: C_BOTH }} />
          Both
        </span>
        <span className="text-stone-500">Hours in your local time ({offsetLabel}) · drag to mark</span>
      </div>
    </div>
  );
}
