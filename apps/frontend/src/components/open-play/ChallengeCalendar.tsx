import { Fragment, useRef, useEffect, useMemo, useState } from 'react';
import type { MatchFormat, HeatmapSlot, ScheduledMatchup } from '../../lib/api';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const FORMAT_DURATION_H: Record<MatchFormat, number> = { BO1: 0.5, BO3: 1.5, BO5: 2.5 };
const FORMAT_ROWS: Record<MatchFormat, number> = { BO1: 1, BO3: 2, BO5: 3 };
const FORMAT_DURATION_LABEL: Record<MatchFormat, string> = { BO1: '~30 min', BO3: '~90 min', BO5: '~150 min' };

const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => i); // 0–23, full day
const ROW_H = 28;
const VISIBLE_ROWS = 16; // default view: 8am–11pm; scroll up for earlier hours
const START_HOUR = 8;

function heatmapBg(count: number, max: number): string {
  if (max === 0 || count === 0) return 'hsl(20,3%,13%)';
  const r = Math.min(count / max, 1);
  return `hsl(38,${(8 + 62 * r).toFixed(0)}%,${(13 + 45 * r).toFixed(0)}%)`;
}

function ChallengePopoverItem({
  matchup,
  isOwn,
  onAccept,
  onCancel,
}: {
  matchup: ScheduledMatchup;
  isOwn: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const d = new Date(matchup.proposed_at);
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-stone-100 text-sm">{matchup.format}</span>
        <span className="text-xs text-stone-500">{FORMAT_DURATION_LABEL[matchup.format]}</span>
      </div>
      <p className="text-xs text-stone-400">
        {d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
        at {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {!matchup.anonymous && matchup.proposer && (
        <p className="text-xs text-stone-400">
          by <span className="text-stone-300">{matchup.proposer.username}</span>
        </p>
      )}
      {matchup.notes && (
        <p className="text-xs text-stone-500 italic truncate">{matchup.notes}</p>
      )}
      {isOwn ? (
        confirmCancel ? (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-stone-400">Remove this challenge?</span>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium"
            >
              Yes, cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="text-xs text-stone-500 hover:text-stone-400 transition-colors"
          >
            Cancel challenge
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={onAccept}
          className="w-full rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors"
        >
          Accept
        </button>
      )}
    </div>
  );
}

interface ChallengeCalendarProps {
  format: MatchFormat;
  slots: HeatmapSlot[];
  selected: Date | null;
  onSelect: (date: Date) => void;
  matchups?: ScheduledMatchup[];
  currentUserId?: string;
  onAccept?: (id: string) => void;
  onCancel?: (id: string) => void;
}

export function ChallengeCalendar({
  format,
  slots,
  selected,
  onSelect,
  matchups = [],
  currentUserId,
  onAccept,
  onCancel,
}: ChallengeCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const durationRows = FORMAT_ROWS[format];

  const heatLookup = useMemo(() => {
    const m = new Map<number, number>();
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
  }, []); // stable: only runs once on mount

  const matchupsByCell = useMemo(() => {
    const m = new Map<string, ScheduledMatchup[]>();
    for (const mu of matchups) {
      const proposed = new Date(mu.proposed_at);
      const dayIdx = days.findIndex((d) => {
        const dd = new Date(d); dd.setHours(0, 0, 0, 0);
        const pd = new Date(proposed); pd.setHours(0, 0, 0, 0);
        return dd.getTime() === pd.getTime();
      });
      if (dayIdx === -1) continue;
      const key = `${dayIdx}:${proposed.getHours()}`;
      m.set(key, [...(m.get(key) ?? []), mu]);
    }
    return m;
  }, [matchups, days]);

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
    if (role === 'start') return { background: 'rgba(56,189,248,0.85)', boxShadow: 'inset 0 0 0 2px rgba(186,230,253,0.8)' };
    if (role === 'span')  return { background: 'rgba(56,189,248,0.30)' };
    return { background: heatmapBg(heat, heatMax) };
  }

  const colTemplate = `44px repeat(7, 1fr)`;

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

      {/* Scrollable grid */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ height: VISIBLE_ROWS * ROW_H }}>
        <div className="grid" style={{ gridTemplateColumns: colTemplate }}>
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
                const cellMatchups = matchupsByCell.get(`${di}:${hour}`) ?? [];
                const hasChallenges = cellMatchups.length > 0;

                const style: React.CSSProperties = {
                  height: ROW_H,
                  position: 'relative',
                  ...cellStyle(day, hour),
                };
                const cls = [
                  'border-b border-r border-stone-700/20 transition-colors',
                  past ? 'cursor-not-allowed' : 'cursor-pointer',
                  !past && !role && !hasChallenges && 'hover:brightness-125',
                ].filter(Boolean).join(' ');

                if (hasChallenges) {
                  return (
                    <Popover key={`${di}-${hour}`}>
                      <PopoverTrigger asChild>
                        <div style={style} className={cls}>
                          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.5)]" />
                          </span>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-64 p-0 bg-rizzotto-iron-900 border-rizzotto-iron-700"
                        side="right"
                        sideOffset={4}
                      >
                        <div className="divide-y divide-stone-700/60">
                          {cellMatchups.map((mu) => (
                            <ChallengePopoverItem
                              key={mu.id}
                              matchup={mu}
                              isOwn={currentUserId != null && mu.proposer?.id === currentUserId}
                              onAccept={() => onAccept?.(mu.id)}
                              onCancel={() => onCancel?.(mu.id)}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  );
                }

                return (
                  <div
                    key={`${di}-${hour}`}
                    style={style}
                    onClick={() => {
                      if (!past) {
                        const d = new Date(day);
                        d.setHours(hour, 0, 0, 0);
                        onSelect(d);
                      }
                    }}
                    className={cls}
                  />
                );
              })}
            </Fragment>
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
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            Open challenge
          </span>
        </div>
        {selected ? (
          <span className="text-stone-300">
            <span className="text-sky-400">
              {selected.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
              {String(selected.getHours()).padStart(2, '0')}:00
            </span>
            {' '}· ~{FORMAT_DURATION_H[format] * 60} min
          </span>
        ) : (
          <span>Click an empty slot to schedule your challenge, or click a dot to accept one</span>
        )}
      </div>
    </div>
  );
}
