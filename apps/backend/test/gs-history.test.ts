import { describe, it, expect } from 'vitest';
import {
  buildSnapshotRows,
  eachUtcDay,
  endOfUtcDayExclusive,
  GS_HISTORY_LAUNCH_DATE,
} from '../src/lib/gs-history.js';

describe('gs-history pure core', () => {
  it('GS_HISTORY_LAUNCH_DATE is 2026-06-27 00:00 UTC', () => {
    expect(GS_HISTORY_LAUNCH_DATE.toISOString()).toBe('2026-06-27T00:00:00.000Z');
  });

  it('eachUtcDay is inclusive, one entry per UTC day', () => {
    const from = new Date(Date.UTC(2026, 5, 27, 9)); // time-of-day ignored
    const to = new Date(Date.UTC(2026, 5, 29, 15));
    expect(eachUtcDay(from, to).map((d) => d.toISOString())).toEqual([
      '2026-06-27T00:00:00.000Z',
      '2026-06-28T00:00:00.000Z',
      '2026-06-29T00:00:00.000Z',
    ]);
  });

  it('endOfUtcDayExclusive returns the next UTC midnight', () => {
    expect(endOfUtcDayExclusive(new Date(Date.UTC(2026, 5, 27))).toISOString()).toBe(
      '2026-06-28T00:00:00.000Z',
    );
  });

  it('buildSnapshotRows maps entries, derives band from raw GS, and filters non-users (teams)', () => {
    const day = new Date(Date.UTC(2026, 6, 1));
    const rows = buildSnapshotRows(
      [
        { playerId: 'u1', generalSkill: 2.5, stdError: 0.3, gamesCount: 40 }, // >= 2.1972 → band 5
        { playerId: 'u2', generalSkill: -1.0, stdError: 0.5, gamesCount: 10 }, // < -0.619 → band 2
        { playerId: 'team1', generalSkill: 1.5, stdError: 0.4, gamesCount: 20 }, // not a user → dropped
      ],
      day,
      new Set(['u1', 'u2']),
      'v1',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: 'u1', snapshot_date: day, general_skill: 2.5, std_error: 0.3, band: 5, games_count: 40, version_id: 'v1',
    });
    expect(rows[1]).toMatchObject({ user_id: 'u2', band: 2 });
    expect(rows.some((r) => r.user_id === 'team1')).toBe(false);
  });
});
