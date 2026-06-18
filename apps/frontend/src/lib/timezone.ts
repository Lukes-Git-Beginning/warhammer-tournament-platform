/**
 * Formats ISO-string into user-friendly local-time representation.
 * Falls back to browser-detected timezone if no user-preference provided.
 *
 * Examples:
 *   formatInUserTimezone('2026-05-13T18:30:00Z')              // → "13.05.2026, 20:30" (in Europe/Berlin)
 *   formatInUserTimezone('2026-05-13T18:30:00Z', 'America/Los_Angeles')  // → "13.05.2026, 11:30"
 */
export function formatInUserTimezone(
  isoString: string,
  userTimezone?: string,
  opts?: { showDate?: boolean; showTime?: boolean; showTimezone?: boolean },
): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString; // fallback for invalid input

  const tz = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDate = opts?.showDate ?? true;
  const showTime = opts?.showTime ?? true;
  const showTimezone = opts?.showTimezone ?? false;

  const formatOpts: Intl.DateTimeFormatOptions = { timeZone: tz };
  if (showDate) {
    formatOpts.day = '2-digit';
    formatOpts.month = '2-digit';
    formatOpts.year = 'numeric';
  }
  if (showTime) {
    formatOpts.hour = '2-digit';
    formatOpts.minute = '2-digit';
    formatOpts.hour12 = false;
  }
  if (showTimezone) {
    formatOpts.timeZoneName = 'short';
  }

  // Use de-DE locale by default for the platform's primary language
  const formatter = new Intl.DateTimeFormat('de-DE', formatOpts);
  return formatter.format(date);
}

/**
 * Returns the UTC offset in whole hours for a given IANA timezone string.
 * e.g. "Europe/Berlin" in summer → 2, "America/Chicago" → -5
 */
export function getUtcOffsetHours(timezone: string): number {
  try {
    const now = new Date();
    const utcMs = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    const tzMs  = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime();
    return Math.round((tzMs - utcMs) / 3_600_000);
  } catch {
    return 0;
  }
}

/**
 * Returns a Discord timestamp tag, e.g. <t:1234567890:F>.
 * Paste into Discord — it renders in each user's local timezone automatically.
 * Styles: F = full date+time, R = relative, D = date only, t = time only.
 */
export function toDiscordTimestamp(isoString: string, style: 'F' | 'R' | 'D' | 't' = 'F'): string {
  const unix = Math.floor(new Date(isoString).getTime() / 1000);
  return `<t:${unix}:${style}>`;
}

/**
 * Returns relative time string like "vor 3 Stunden" or "in 2 Tagen".
 */
export function formatRelative(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const diffMs = date.getTime() - Date.now();
  const absMin = Math.abs(diffMs) / 60_000;
  const absHour = absMin / 60;
  const absDay = absHour / 24;

  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  if (absDay >= 1) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  if (absHour >= 1) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (absMin >= 1) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  return rtf.format(Math.round(diffMs / 1000), 'second');
}
