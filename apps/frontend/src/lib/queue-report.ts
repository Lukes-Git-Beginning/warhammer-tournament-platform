/**
 * Totals for the admin Open Play queue report (components/admin/reports/QueueReport.tsx): the daily
 * rows summed over the window, plus per-day averages of the joins and players that got no game.
 */
import type { AdminQueueReportDay } from '@/lib/api.js';

export interface QueueTotals {
  days: number;
  joins: number;
  matched: number;
  matchedViaDm: number;
  left: number;
  expired: number;
  waiting: number;
  /** Left or timed out. */
  unmatched: number;
  /** Share of the settled joins (not the ones still waiting), in whole percent. */
  matchedPct: number;
  unmatchedPct: number;
  unmatchedPerDay: number;
  playersWithoutGamePerDay: number;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function queueTotals(daily: AdminQueueReportDay[]): QueueTotals {
  const sum = (pick: (d: AdminQueueReportDay) => number) => daily.reduce((n, d) => n + pick(d), 0);
  const matched = sum((d) => d.matched);
  const left = sum((d) => d.left);
  const expired = sum((d) => d.expired);
  const unmatched = left + expired;
  const settled = matched + unmatched;
  const days = daily.length;
  return {
    days,
    joins: sum((d) => d.joins),
    matched,
    matchedViaDm: sum((d) => d.matchedViaDm),
    left,
    expired,
    waiting: sum((d) => d.waiting),
    unmatched,
    matchedPct: settled ? Math.round((matched / settled) * 100) : 0,
    unmatchedPct: settled ? Math.round((unmatched / settled) * 100) : 0,
    unmatchedPerDay: days ? oneDecimal(unmatched / days) : 0,
    playersWithoutGamePerDay: days ? oneDecimal(sum((d) => d.playersWithoutGame) / days) : 0,
  };
}

/** "45 s", "3:05 min", or "—" without a value. */
export function formatWait(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec} s`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min`;
}

/** "Wed 28 Oct" for a site-time "YYYY-MM-DD" day. */
export function formatReportDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
