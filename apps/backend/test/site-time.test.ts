/**
 * Site time (Europe/Berlin): calendar boundaries the server decides on its own follow German
 * time, DST-safe (Alex, 2026-10-06).
 */
import { describe, expect, it } from 'vitest';
import {
  siteMidnight,
  siteDayKey,
  siteDayAsDate,
  siteDaysBetween,
  startOfSiteDay,
  addSiteDays,
  nextMidnightIn,
  formatSiteTime,
} from '../src/lib/site-time.js';
import { LAUNCH_DATE, daysSince } from '../src/lib/competition.js';

describe('site-time', () => {
  it('midnight is local German midnight in summer (CEST) and winter (CET)', () => {
    expect(siteMidnight(2026, 9, 1).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(siteMidnight(2026, 10, 1).toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('is exact on both DST transition days', () => {
    expect(siteMidnight(2026, 9, 25).toISOString()).toBe('2026-10-24T22:00:00.000Z'); // CEST → CET
    expect(siteMidnight(2026, 9, 26).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(siteMidnight(2027, 2, 28).toISOString()).toBe('2027-03-27T23:00:00.000Z'); // CET → CEST
    expect(siteMidnight(2027, 2, 29).toISOString()).toBe('2027-03-28T22:00:00.000Z');
    expect(addSiteDays(new Date('2026-10-25T12:00:00Z'), 1).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('a game at 00:30 German time belongs to that German day, not the previous UTC day', () => {
    const t = new Date('2026-10-06T22:30:00Z'); // 7 Oct 00:30 CEST
    expect(siteDayKey(t)).toBe('2026-10-07');
    expect(siteDayAsDate(t).toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(startOfSiteDay(t).toISOString()).toBe('2026-10-06T22:00:00.000Z');
  });

  it('counts German calendar days crossed', () => {
    expect(siteDaysBetween(siteMidnight(2026, 9, 1), siteMidnight(2027, 0, 1))).toBe(92);
    // 23:59 → 00:01 German time is a new day even though only 2 minutes passed.
    expect(siteDaysBetween(new Date('2026-10-06T21:59:00Z'), new Date('2026-10-06T22:01:00Z'))).toBe(1);
    expect(siteDaysBetween(new Date('2026-10-07T10:00:00Z'), new Date('2026-10-06T10:00:00Z'))).toBe(0);
  });

  it('launch is 27 Jun 2026 00:00 German time and daysSince ticks at German midnight', () => {
    expect(LAUNCH_DATE.toISOString()).toBe('2026-06-26T22:00:00.000Z');
    expect(daysSince(LAUNCH_DATE, new Date('2026-06-27T21:59:00Z'))).toBe(0);
    expect(daysSince(LAUNCH_DATE, new Date('2026-06-27T22:00:00Z'))).toBe(1);
  });

  it('"rest of today" ends at midnight in the user\'s own zone, falling back to German time', () => {
    const now = new Date('2026-10-06T21:00:00Z');
    expect(nextMidnightIn('America/New_York', now).toISOString()).toBe('2026-10-07T04:00:00.000Z');
    expect(nextMidnightIn('Europe/Berlin', now).toISOString()).toBe('2026-10-06T22:00:00.000Z');
    expect(nextMidnightIn('Not/AZone', now).toISOString()).toBe('2026-10-06T22:00:00.000Z');
    expect(nextMidnightIn(null, now).toISOString()).toBe('2026-10-06T22:00:00.000Z');
  });

  it('formats admin-facing timestamps in German time with the zone', () => {
    expect(formatSiteTime(new Date('2026-10-06T20:30:00Z'))).toBe('06 Oct 2026, 22:30 CEST');
    expect(formatSiteTime(new Date('2026-12-06T20:30:00Z'))).toBe('06 Dec 2026, 21:30 CET');
  });
});
