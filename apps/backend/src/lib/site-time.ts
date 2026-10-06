/**
 * Site time: the community / admin timezone (Europe/Berlin, CET/CEST).
 *
 * Instants are stored and exchanged as UTC (Prisma DateTime, ISO strings) — that is correct and
 * unchanged. What this module fixes is every CALENDAR decision the server makes on its own:
 * day / month / quarter boundaries, "per day" counts, daily stats buckets and snapshots, cron
 * schedules. Those follow German time, so something "in October" runs from 1 Oct 00:00 to
 * 31 Oct 23:59 CET/CEST and a game at 00:30 counts for that day, not the previous one (Alex,
 * 2026-10-06). What a VIEWER sees stays in their own timezone (frontend / Discord <t:…>).
 */

export const SITE_TZ = 'Europe/Berlin';

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface SiteParts {
  year: number;
  /** 0-based, like Date#getMonth. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, like Date#getDay. */
  weekday: number;
}

/** Wall-clock fields of an instant in site time (or another IANA zone). */
export function siteParts(d: Date, tz: string = SITE_TZ): SiteParts {
  const parts = formatterFor(tz).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')) - 1,
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** The zone's UTC offset (ms) at an instant: wall clock read as UTC, minus the instant. */
function offsetAt(instant: number, tz: string): number {
  const p = siteParts(new Date(instant), tz);
  return Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of a site-time wall clock (year, 0-based month, day, hour…). Month/day overflow
 * normalises like Date.UTC (day 32 → next month). DST-safe: the offset is re-evaluated at the
 * corrected instant, so it is right on both sides of a transition.
 */
export function siteTimeToInstant(year: number, month: number, day = 1, hour = 0, minute = 0, tz: string = SITE_TZ): Date {
  const wall = Date.UTC(year, month, day, hour, minute);
  let instant = wall - offsetAt(wall, tz);
  instant = wall - offsetAt(instant, tz);
  return new Date(instant);
}

/** UTC instant of site-time midnight on the given calendar date. */
export function siteMidnight(year: number, month: number, day = 1): Date {
  return siteTimeToInstant(year, month, day);
}

/** Site-time midnight at the start of the day containing `d`. */
export function startOfSiteDay(d: Date): Date {
  const p = siteParts(d);
  return siteMidnight(p.year, p.month, p.day);
}

/** Site-time midnight `n` days after the start of the day containing `d` (n may be negative). */
export function addSiteDays(d: Date, n: number): Date {
  const p = siteParts(d);
  return siteMidnight(p.year, p.month, p.day + n);
}

/** Site-time calendar day of an instant as "YYYY-MM-DD" (the key for daily buckets/snapshots). */
export function siteDayKey(d: Date): string {
  const p = siteParts(d);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * A site-time calendar day as a UTC-midnight Date — the value to store in a `@db.Date` column
 * (Postgres DATE has no zone; Prisma maps it through UTC midnight).
 */
export function siteDayAsDate(d: Date): Date {
  const p = siteParts(d);
  return new Date(Date.UTC(p.year, p.month, p.day));
}

/** Site-time calendar days from `from` to `to` (midnights crossed; never negative). */
export function siteDaysBetween(from: Date, to: Date): number {
  const a = siteParts(from);
  const b = siteParts(to);
  const diff = Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / DAY_MS);
  return Math.max(0, diff);
}

/**
 * The next local midnight after `now` in an arbitrary IANA zone — "the rest of today" for a user in
 * their own timezone. Falls back to site time for a missing/invalid zone.
 */
export function nextMidnightIn(tz: string | null | undefined, now: Date = new Date()): Date {
  let zone = SITE_TZ;
  if (tz) {
    try {
      formatterFor(tz);
      zone = tz;
    } catch {
      /* invalid zone → site time */
    }
  }
  const p = siteParts(now, zone);
  return siteTimeToInstant(p.year, p.month, p.day + 1, 0, 0, zone);
}

const displayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SITE_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/** A server-written, admin/host-facing timestamp in site time, e.g. "06 Oct 2026, 22:30 CEST". */
export function formatSiteTime(d: Date): string {
  return displayFormatter.format(d);
}
