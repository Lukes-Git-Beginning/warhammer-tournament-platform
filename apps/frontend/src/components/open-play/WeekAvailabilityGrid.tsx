import { useRef, useState, useEffect } from 'react';
import type { AvailabilityContext, AvailabilitySlot } from '../../lib/api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Display order starts at 6am, wraps through midnight
// [6, 7, ..., 23, 0, 1, 2, 3, 4, 5]
const DISPLAY_HOURS = [
  ...Array.from({ length: 18 }, (_, i) => i + 6),
  ...Array.from({ length: 6 }, (_, i) => i),
];

const ROW_H = 28;        // px per row
const VISIBLE_ROWS = 18; // default visible window height
const START_HOUR = 8;    // scroll so 8am is at the top by default

interface WeekAvailabilityGridProps {
  slots: AvailabilitySlot[];
  context: AvailabilityContext;
  onChange: (slots: AvailabilitySlot[]) => void;
  disabled?: boolean;
}

type Cell = { day: number; hour: number };

function getRect(a: Cell, b: Cell) {
  return {
    minDay: Math.min(a.day, b.day),
    maxDay: Math.max(a.day, b.day),
    minHour: Math.min(a.hour, b.hour),
    maxHour: Math.max(a.hour, b.hour),
  };
}

export function WeekAvailabilityGrid({ slots, context, onChange, disabled }: WeekAvailabilityGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag state — refs to avoid unnecessary re-renders
  const isDragging = useRef(false);
  const dragMode = useRef<'add' | 'remove'>('add');
  const dragAnchor = useRef<Cell | null>(null);
  const dragCurrent = useRef<Cell | null>(null);
  const [dragHighlight, setDragHighlight] = useState<Set<string>>(new Set());

  // Keep latest props accessible inside window listener without re-registering
  const slotsRef = useRef(slots);
  const contextRef = useRef(context);
  const onChangeRef = useRef(onChange);
  slotsRef.current = slots;
  contextRef.current = context;
  onChangeRef.current = onChange;

  const slotSet = new Set(
    slots.filter((s) => s.context === context).map((s) => `${s.day_of_week}:${s.hour_utc}`),
  );

  // Scroll to default start hour on mount
  useEffect(() => {
    if (scrollRef.current) {
      const startIdx = DISPLAY_HOURS.indexOf(START_HOUR);
      scrollRef.current.scrollTop = startIdx * ROW_H;
    }
  }, []);

  // Global mouseup — finalize drag even if released outside the grid
  useEffect(() => {
    const onUp = () => {
      if (!isDragging.current) return;
      applyDrag();
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function highlightRect(anchor: Cell, current: Cell) {
    const rect = getRect(anchor, current);
    const hs = new Set<string>();
    for (let d = rect.minDay; d <= rect.maxDay; d++) {
      for (let h = rect.minHour; h <= rect.maxHour; h++) {
        hs.add(`${d}:${h}`);
      }
    }
    setDragHighlight(hs);
  }

  function applyDrag() {
    if (!dragAnchor.current || !dragCurrent.current) {
      isDragging.current = false;
      setDragHighlight(new Set());
      return;
    }

    const s = slotsRef.current;
    const ctx = contextRef.current;
    const currentSet = new Set(
      s.filter((sl) => sl.context === ctx).map((sl) => `${sl.day_of_week}:${sl.hour_utc}`),
    );
    const rect = getRect(dragAnchor.current, dragCurrent.current);
    const other = s.filter((sl) => sl.context !== ctx);
    const same = s.filter((sl) => sl.context === ctx);

    if (dragMode.current === 'add') {
      const toAdd: AvailabilitySlot[] = [];
      for (let d = rect.minDay; d <= rect.maxDay; d++) {
        for (let h = rect.minHour; h <= rect.maxHour; h++) {
          if (!currentSet.has(`${d}:${h}`)) {
            toAdd.push({ day_of_week: d, hour_utc: h, context: ctx });
          }
        }
      }
      onChangeRef.current([...other, ...same, ...toAdd]);
    } else {
      onChangeRef.current([
        ...other,
        ...same.filter(
          (sl) =>
            !(
              sl.day_of_week >= rect.minDay &&
              sl.day_of_week <= rect.maxDay &&
              sl.hour_utc >= rect.minHour &&
              sl.hour_utc <= rect.maxHour
            ),
        ),
      ]);
    }

    isDragging.current = false;
    dragAnchor.current = null;
    dragCurrent.current = null;
    setDragHighlight(new Set());
  }

  function onCellDown(day: number, hour: number) {
    if (disabled) return;
    isDragging.current = true;
    dragMode.current = slotSet.has(`${day}:${hour}`) ? 'remove' : 'add';
    dragAnchor.current = { day, hour };
    dragCurrent.current = { day, hour };
    highlightRect({ day, hour }, { day, hour });
  }

  function onCellEnter(day: number, hour: number) {
    if (!isDragging.current || !dragAnchor.current) return;
    dragCurrent.current = { day, hour };
    highlightRect(dragAnchor.current, { day, hour });
  }

  const colTemplate = `44px repeat(7, 1fr)`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 360 }}>
      {/* Day headers — outside scroll so they stay visible */}
      <div className="grid sticky top-0 z-10 bg-stone-950" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: ROW_H }} />
        {DAYS.map((d) => (
          <div
            key={d}
            style={{ height: ROW_H }}
            className="flex items-center justify-center text-xs font-medium text-stone-400 border-b border-stone-800"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Scrollable hour grid */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: VISIBLE_ROWS * ROW_H }}
        onMouseLeave={() => {
          // Keep dragging — just don't update highlight when outside
        }}
      >
        <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
          {DISPLAY_HOURS.map((hour) => (
            <>
              <div
                key={`label-${hour}`}
                style={{ height: ROW_H }}
                className="flex items-center justify-end pr-2 text-xs text-stone-500 border-b border-stone-800/40"
              >
                {String(hour).padStart(2, '0')}:00
              </div>
              {Array.from({ length: 7 }, (_, day) => {
                const isActive = slotSet.has(`${day}:${hour}`);
                const isHighlighted = dragHighlight.has(`${day}:${hour}`);
                const showActive = isHighlighted
                  ? dragMode.current === 'add'
                  : isActive;

                return (
                  <div
                    key={`cell-${day}-${hour}`}
                    style={{ height: ROW_H }}
                    onMouseDown={() => onCellDown(day, hour)}
                    onMouseEnter={() => onCellEnter(day, hour)}
                    className={[
                      'border-b border-r border-stone-800/40 transition-colors',
                      showActive ? 'bg-amber-500/70' : 'bg-stone-900',
                      !disabled && 'cursor-pointer',
                      !disabled && !showActive && 'hover:bg-stone-700',
                      disabled && 'opacity-50 cursor-not-allowed',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-stone-500">Hours in UTC. Click or drag to mark availability.</p>
    </div>
  );
}
