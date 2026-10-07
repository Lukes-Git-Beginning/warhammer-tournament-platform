/**
 * Availability helpers. Slots a player saves are LOCAL time (weekday 0=Mon..6=Sun + hour in their own
 * timezone), so the editing grid shows and stores them directly. The community heatmaps still arrive
 * as a UTC raster; they are converted into the display zone here, per concrete instant, so daylight
 * saving is handled correctly (never one global whole-hour offset).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_MS = 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** The browser's own IANA zone. */
export function getBrowserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** ONE source for the zone everything availability-related is shown in: user.timezone, else the browser's. */
export function resolveDisplayZone(userTimezone?: string | null): string {
  if (userTimezone) {
    try {
      formatterFor(userTimezone);
      return userTimezone;
    } catch {
      /* invalid zone -> browser */
    }
  }
  return getBrowserZone();
}

/** Weekday (0=Mon..6=Sun) and hour the wall clock in `tz` shows at `instant`. */
export function localCellAt(instant: Date, tz: string): { day: number; hour: number } {
  const parts = formatterFor(tz).formatToParts(instant);
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  return { day: (weekday + 6) % 7, hour };
}

/** Monday 00:00 UTC of the UTC week containing `ref`. */
function utcWeekStart(ref: Date): number {
  const dow = (ref.getUTCDay() + 6) % 7;
  return Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - dow);
}

/**
 * Convert one cell of the UTC heatmap raster (weekday 0=Mon..6=Sun, hour) into the weekday + hour it
 * has on the wall clock in `tz`, for the week containing `weekRef`. DST-correct for that week.
 */
export function utcCellToLocal(
  dayUtc: number,
  hourUtc: number,
  tz: string,
  weekRef: Date = new Date(),
): { day: number; hour: number } {
  const instant = new Date(utcWeekStart(weekRef) + (dayUtc * 24 + hourUtc) * HOUR_MS);
  return localCellAt(instant, tz);
}

/** Short zone label for the grid legend, e.g. "Europe/Berlin". */
export function zoneLabel(tz: string): string {
  return tz.replace(/_/g, ' ');
}
