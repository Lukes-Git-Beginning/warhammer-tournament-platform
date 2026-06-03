import { Link } from '@tanstack/react-router';
import type { CalendarTournament } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the ISO-8601-like local date tuple [year, month (0-based), day] */
function localDate(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getFullYear(), d.getMonth(), d.getDate()];
}

/** Returns a Date for the Monday of the week that contains `d`. */
function weekStart(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0=Sun … 6=Sat
  // Shift so Monday = 0
  const diff = (dow + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Returns the Date of the last day of the month. */
function lastOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DayCell {
  date: Date;
  /** belongs to previous or next month — render dimmed */
  overflow: boolean;
}

interface MonthCalendarGridProps {
  /** First day of the visible month (day-of-month is ignored; always treated as 1). */
  monthDate: Date;
  tournaments: CalendarTournament[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function MonthCalendarGrid({ monthDate, tournaments }: MonthCalendarGridProps) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = lastOfMonth(year, month);

  // Build grid: start from the Monday of the week containing the 1st,
  // end at the Sunday of the week containing the last day.
  const gridStart = weekStart(firstDay);
  const gridEndSunday = (() => {
    const d = new Date(lastDay);
    const dow = d.getDay();
    const toSunday = dow === 0 ? 0 : 7 - dow;
    d.setDate(d.getDate() + toSunday);
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const cells: DayCell[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEndSunday) {
    cells.push({
      date: new Date(cursor),
      overflow: cursor.getMonth() !== month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Pre-bucket tournaments by "YYYY-M-D" local key for O(1) lookup
  const byDay = new Map<string, CalendarTournament[]>();
  for (const t of tournaments) {
    const [y, m, d] = localDate(t.start_date);
    const key = `${y}-${m}-${d}`;
    const list = byDay.get(key) ?? [];
    list.push(t);
    byDay.set(key, list);
  }

  // Today for highlighting
  const today = new Date();
  const [todayY, todayM, todayD] = [today.getFullYear(), today.getMonth(), today.getDate()];

  return (
    <div className="overflow-hidden rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950/60">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-rizzotto-iron-700">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-2 text-center font-mono text-xs font-semibold uppercase tracking-widest text-rizzotto-stone-500"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 divide-x divide-y divide-rizzotto-iron-800">
        {cells.map((cell, idx) => {
          const [cy, cm, cd] = [cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate()];
          const isToday = cy === todayY && cm === todayM && cd === todayD;
          const key = `${cy}-${cm}-${cd}`;
          const dayTournaments = byDay.get(key) ?? [];

          return (
            <div
              key={idx}
              className={`min-h-[5.5rem] p-1.5 sm:p-2 ${cell.overflow ? 'bg-rizzotto-iron-950/20' : ''}`}
            >
              {/* Day number */}
              <div className="mb-1 flex items-center justify-end">
                <span
                  className={`
                    flex size-6 items-center justify-center rounded-full font-mono text-xs font-semibold
                    ${isToday
                      ? 'bg-rizzotto-gold-500 text-rizzotto-iron-950'
                      : cell.overflow
                        ? 'text-rizzotto-stone-700'
                        : 'text-rizzotto-stone-400'
                    }
                  `}
                >
                  {cd}
                </span>
              </div>

              {/* Tournament chips */}
              <div className="flex flex-col gap-0.5">
                {dayTournaments.map((t) => (
                  <Link
                    key={t.id}
                    to="/tournaments/$slug"
                    params={{ slug: t.slug }}
                    className={`
                      group flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[0.65rem] leading-tight transition-colors
                      ${t.is_major
                        ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400 ring-1 ring-rizzotto-gold-500/30 hover:bg-rizzotto-gold-500/25'
                        : 'bg-rizzotto-iron-700/60 text-rizzotto-stone-300 hover:bg-rizzotto-iron-600/60 hover:text-rizzotto-stone-100'
                      }
                    `}
                  >
                    {t.is_major && (
                      <span
                        aria-label="Major"
                        title="Major Tournament"
                        className="shrink-0 text-rizzotto-gold-400"
                      >
                        ★
                      </span>
                    )}
                    <span className="truncate">{t.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
