import { Fragment, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTournaments, type HeatmapSlot, type Tournament } from '../../lib/api';
import { tournamentDurationHours } from '../../lib/tournamentSchedule';

// Date-based scheduling calendar for the tournament create/edit forms — today + the
// next 6 days, mirroring the Open Play ChallengeCalendar. It shows community
// availability (heat) and overlays existing tournaments as blocks so the host can
// see, at a glance, when the field is already busy and pick a clear start time.

const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => i); // 0–23
const ROW_H = 28;
const VISIBLE_ROWS = 16; // default view 8am–11pm; scroll up for earlier hours
const START_HOUR = 8;
const HOUR_COL = 44; // px width of the leading hour-label column

function heatmapBg(count: number, max: number): string {
  if (max === 0 || count === 0) return 'hsl(20,3%,13%)';
  const r = Math.min(count / max, 1);
  return `hsl(38,${(8 + 62 * r).toFixed(0)}%,${(13 + 45 * r).toFixed(0)}%)`;
}

// Local-time bucket for a UTC (weekday, hour) slot. day: Mon=0 … Sun=6.
function utcToLocal(dayUtc: number, hourUtc: number, offset: number): { day: number; hour: number } {
  const total = dayUtc * 24 + hourUtc + offset;
  const day = ((Math.floor(total / 24) % 7) + 7) % 7;
  const hour = ((total % 24) + 24) % 24;
  return { day, hour };
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface CalendarTournament {
  id: string;
  slug: string;
  name: string;
  start: Date;
  durationHours: number;
  status: Tournament['status'];
}

const STATUS_BLOCK: Record<string, { bg: string; border: string; label: string }> = {
  ONGOING: { bg: 'rgba(244,63,94,0.24)', border: 'rgba(251,113,133,0.9)', label: 'live' },
  OPEN_REGISTRATION: { bg: 'rgba(251,191,36,0.22)', border: 'rgba(251,191,36,0.9)', label: 'open' },
  REGISTRATION_CLOSED: { bg: 'rgba(251,191,36,0.16)', border: 'rgba(217,164,65,0.8)', label: 'full' },
  DRAFT: { bg: 'rgba(120,113,108,0.20)', border: 'rgba(168,162,158,0.7)', label: 'draft' },
};

/**
 * Existing scheduled tournaments for the calendar: OPEN + REGISTRATION_CLOSED +
 * ONGOING + your own DRAFTs, whose start falls inside the visible 7-day window.
 * `excludeId` drops the tournament currently being edited so it never clashes with itself.
 */
export function useCalendarTournaments(excludeId?: string): CalendarTournament[] {
  const { data } = useQuery({
    queryKey: ['calendar-tournaments'],
    queryFn: async () => {
      const statuses: Tournament['status'][] = ['OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ONGOING', 'DRAFT'];
      const results = await Promise.allSettled(statuses.map((s) => listTournaments(1, 100, s)));
      const byId = new Map<string, Tournament>();
      for (const r of results) {
        if (r.status === 'fulfilled') for (const t of r.value.data) byId.set(t.id, t);
      }
      return [...byId.values()];
    },
    staleTime: 2 * 60 * 1000,
  });

  return useMemo(() => {
    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + 7);
    return (data ?? [])
      .filter((t) => t.id !== excludeId)
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        start: new Date(t.start_date),
        durationHours: tournamentDurationHours(t),
        status: t.status,
      }))
      .filter((t) => !Number.isNaN(t.start.getTime()) && t.start >= windowStart && t.start < windowEnd);
  }, [data, excludeId]);
}

interface Props {
  /** Weekly availability heat (day_of_week × hour_utc). */
  slots: HeatmapSlot[];
  /** Existing tournaments to overlay as blocks. */
  tournaments: CalendarTournament[];
  /** The form's currently chosen start (or null if unparseable). */
  selectedStart: Date | null;
  /** The form's own estimated duration, for the selection span highlight. */
  selectedDurationHours: number;
  /** Click an empty slot → set this start time. */
  onSelect: (date: Date) => void;
}

export function TournamentScheduleCalendar({
  slots,
  tournaments,
  selectedStart,
  selectedDurationHours,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const offset = -new Date().getTimezoneOffset() / 60;
  const heatLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) {
      const { day, hour } = utcToLocal(s.day_of_week, s.hour_utc, offset);
      m.set(`${day}:${hour}`, (m.get(`${day}:${hour}`) ?? 0) + s.count);
    }
    return m;
  }, [slots, offset]);
  const heatMax = Math.max(0, ...heatLookup.values());

  const days = useMemo<Date[]>(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, []);

  const blocks = useMemo(() => {
    return tournaments
      .map((t) => {
        const dayIdx = days.findIndex((d) => sameLocalDate(d, t.start));
        if (dayIdx === -1) return null;
        const startHour = t.start.getHours() + t.start.getMinutes() / 60;
        return { t, dayIdx, startHour };
      })
      .filter((b): b is { t: CalendarTournament; dayIdx: number; startHour: number } => b !== null);
  }, [tournaments, days]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DISPLAY_HOURS.indexOf(START_HOUR) * ROW_H;
  }, []);

  function isPast(day: Date, hour: number): boolean {
    const slot = new Date(day);
    slot.setHours(hour, 0, 0, 0);
    return slot.getTime() <= Date.now();
  }

  const selDurRows = Math.max(1, Math.ceil(selectedDurationHours));
  function selRole(day: Date, hour: number): 'start' | 'span' | null {
    if (!selectedStart || !sameLocalDate(day, selectedStart)) return null;
    const sh = selectedStart.getHours();
    if (hour === sh) return 'start';
    if (hour > sh && hour < sh + selDurRows) return 'span';
    return null;
  }

  function cellStyle(day: Date, hour: number): React.CSSProperties {
    const role = selRole(day, hour);
    if (isPast(day, hour)) return { background: 'hsl(20,3%,9%)', opacity: 0.5 };
    if (role === 'start') return { background: 'rgba(56,189,248,0.85)', boxShadow: 'inset 0 0 0 2px rgba(186,230,253,0.8)' };
    if (role === 'span') return { background: 'rgba(56,189,248,0.30)' };
    const localDay = (day.getDay() + 6) % 7; // Mon=0 … Sun=6
    return { background: heatmapBg(heatLookup.get(`${localDay}:${hour}`) ?? 0, heatMax) };
  }

  const colTemplate = `${HOUR_COL}px repeat(7, 1fr)`;

  return (
    <div className="overflow-x-auto select-none" style={{ minWidth: 380 }}>
      {/* Day headers */}
      <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
        <div style={{ height: 40 }} />
        {days.map((d, i) => (
          <div
            key={i}
            style={{ height: 40, background: i === 0 ? 'hsl(38,8%,14%)' : 'hsl(20,3%,11%)' }}
            className="flex flex-col items-center justify-center border-b border-stone-700"
          >
            <span className="text-[11px] font-medium text-stone-400">
              {d.toLocaleDateString('en-GB', { weekday: 'short' })}
            </span>
            <span className={`text-[11px] ${i === 0 ? 'text-amber-400' : 'text-stone-500'}`}>
              {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        ))}
      </div>

      {/* Scrollable grid + tournament block overlay */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ height: VISIBLE_ROWS * ROW_H }}>
        <div className="grid" style={{ gridTemplateColumns: colTemplate, position: 'relative' }}>
          {DISPLAY_HOURS.map((hour) => (
            <Fragment key={hour}>
              <div
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
                    onClick={() => {
                      if (!past) {
                        const d = new Date(day);
                        d.setHours(hour, 0, 0, 0);
                        onSelect(d);
                      }
                    }}
                    className={[
                      'border-b border-r border-stone-700/20 transition-colors',
                      past ? 'cursor-not-allowed' : 'cursor-pointer',
                      !past && !role && 'hover:brightness-125',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                );
              })}
            </Fragment>
          ))}

          {/* Tournament blocks: absolutely positioned over the grid, clicks pass through. */}
          <div className="pointer-events-none absolute inset-0">
            {blocks.map(({ t, dayIdx, startHour }) => {
              const s = STATUS_BLOCK[t.status] ?? STATUS_BLOCK.OPEN_REGISTRATION!;
              return (
                <div
                  key={t.id}
                  title={`${t.name} · ${t.start.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ~${t.durationHours}h (${s.label})`}
                  style={{
                    position: 'absolute',
                    top: startHour * ROW_H + 1,
                    height: Math.max(ROW_H, t.durationHours * ROW_H) - 3,
                    left: `calc(${HOUR_COL}px + ${dayIdx} * (100% - ${HOUR_COL}px) / 7 + 2px)`,
                    width: `calc((100% - ${HOUR_COL}px) / 7 - 4px)`,
                    background: s.bg,
                    borderLeft: `3px solid ${s.border}`,
                    borderRadius: 3,
                  }}
                  className="overflow-hidden px-1 py-0.5"
                >
                  <span className="block truncate text-[10px] font-medium leading-tight text-stone-100">
                    {t.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend + selection info */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm" style={{ background: heatmapBg(10, 10) }} />
            Players free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm" style={{ background: 'rgba(56,189,248,0.85)' }} />
            Your start
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm" style={{ background: 'rgba(251,191,36,0.5)' }} />
            Scheduled tournament
          </span>
        </div>
        {selectedStart ? (
          <span className="text-stone-300">
            <span className="text-sky-400">
              {selectedStart.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
              {String(selectedStart.getHours()).padStart(2, '0')}:00
            </span>{' '}
            · ~{selectedDurationHours}h
          </span>
        ) : (
          <span>Click a slot to set the start time</span>
        )}
      </div>
    </div>
  );
}
