import { describe, expect, it } from 'vitest';
import { localCellAt, resolveDisplayZone, utcCellToLocal } from './availability-grid';

describe('utcCellToLocal (DST-correct heatmap conversion)', () => {
  const july = new Date('2026-07-14T10:00:00Z');
  const december = new Date('2026-12-15T10:00:00Z');

  it('shows the Berlin Tue 20:00 slot at 20:00 in both summer (18Z) and winter (19Z)', () => {
    expect(utcCellToLocal(1, 18, 'Europe/Berlin', july)).toEqual({ day: 1, hour: 20 });
    expect(utcCellToLocal(1, 19, 'Europe/Berlin', december)).toEqual({ day: 1, hour: 20 });
  });

  it('wraps across the week edge (Sun 23:00Z is Mon 01:00 in Berlin summer)', () => {
    expect(utcCellToLocal(6, 23, 'Europe/Berlin', july)).toEqual({ day: 0, hour: 1 });
  });

  it('handles zones west of UTC (Wed 00:00Z is Tue 20:00 in New York summer)', () => {
    expect(utcCellToLocal(2, 0, 'America/New_York', july)).toEqual({ day: 1, hour: 20 });
    expect(utcCellToLocal(2, 1, 'America/New_York', december)).toEqual({ day: 1, hour: 20 });
  });

  it('localCellAt reads the wall clock of an instant', () => {
    expect(localCellAt(new Date('2026-07-14T18:00:00Z'), 'Europe/Berlin')).toEqual({ day: 1, hour: 20 });
  });
});

describe('resolveDisplayZone', () => {
  it('prefers the user zone, falls back to the browser zone for missing or invalid ones', () => {
    expect(resolveDisplayZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    const browser = resolveDisplayZone(null);
    expect(resolveDisplayZone('Mars/Olympus')).toBe(browser);
    expect(resolveDisplayZone(undefined)).toBe(browser);
  });
});
