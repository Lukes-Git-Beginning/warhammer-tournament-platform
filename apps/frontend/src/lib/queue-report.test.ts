import { describe, expect, it } from 'vitest';
import type { AdminQueueReportDay } from '@/lib/api.js';
import { formatReportDay, formatWait, queueTotals } from './queue-report';

const day = (over: Partial<AdminQueueReportDay>): AdminQueueReportDay => ({
  day: '2026-10-28',
  joins: 0,
  matched: 0,
  matchedViaDm: 0,
  left: 0,
  expired: 0,
  waiting: 0,
  players: 0,
  playersWithoutGame: 0,
  ...over,
});

describe('queueTotals', () => {
  it('sums the days and leaves joins still waiting out of the shares', () => {
    const t = queueTotals([
      day({ joins: 5, matched: 1, matchedViaDm: 1, left: 1, expired: 2, waiting: 1, playersWithoutGame: 2 }),
      day({ joins: 3, matched: 2, left: 1, playersWithoutGame: 1 }),
      day({}),
    ]);
    expect(t).toMatchObject({ days: 3, joins: 8, matched: 3, matchedViaDm: 1, unmatched: 4, waiting: 1 });
    expect(t.matchedPct).toBe(43); // 3 of 7 settled
    expect(t.unmatchedPct).toBe(57);
    expect(t.unmatchedPerDay).toBe(1.3);
    expect(t.playersWithoutGamePerDay).toBe(1);
  });

  it('is all zero without days', () => {
    expect(queueTotals([])).toMatchObject({ joins: 0, matchedPct: 0, unmatchedPerDay: 0 });
  });
});

describe('formatting', () => {
  it('writes waits and days', () => {
    expect(formatWait(null)).toBe('—');
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(185)).toBe('3:05 min');
    expect(formatReportDay('2026-10-28')).toBe('Wed 28 Oct');
  });
});
