/**
 * Site time (Europe/Berlin) for ADMIN surfaces. Players see times in their own timezone
 * (lib/timezone.ts → user.timezone / browser); the admin panel always shows and takes input in
 * German time, so it never shifts with the machine the admin happens to be on (Alex, 2026-10-06).
 * Mirrors apps/backend/src/lib/site-time.ts.
 */
import { formatInUserTimezone } from './timezone';

export const SITE_TZ = 'Europe/Berlin';

/** Format an ISO instant in German time ("06.10.2026, 22:30"). */
export function formatSiteDateTime(
  iso: string | null | undefined,
  opts?: { showDate?: boolean; showTime?: boolean; showTimezone?: boolean },
): string {
  if (!iso) return '';
  return formatInUserTimezone(iso, SITE_TZ, opts);
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function wallClockAsUtc(instant: number): number {
  const parts = partsFormatter.formatToParts(new Date(instant));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

/** ISO instant → `datetime-local` value ("YYYY-MM-DDTHH:MM") showing German wall-clock time. */
export function isoToSiteInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(wallClockAsUtc(t)).toISOString().slice(0, 16);
}

/** `datetime-local` value read as German wall-clock time → ISO instant (DST-safe), or null. */
export function siteInputToIso(local: string): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let instant = wall - (wallClockAsUtc(wall) - wall);
  instant = wall - (wallClockAsUtc(instant) - instant);
  return new Date(instant).toISOString();
}
