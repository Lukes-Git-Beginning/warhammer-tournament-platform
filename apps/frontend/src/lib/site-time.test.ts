import { describe, expect, it } from 'vitest';
import { isoToSiteInput, siteInputToIso, formatSiteDateTime } from './site-time';

// Admin date inputs are German wall-clock time regardless of the browser's zone. The old helpers
// sliced the UTC ISO into the input and read it back as browser-local → every save shifted.
describe('site-time (admin date inputs)', () => {
  it('shows a UTC instant as German wall-clock time in a datetime-local value', () => {
    expect(isoToSiteInput('2026-10-01T22:00:00.000Z')).toBe('2026-10-02T00:00'); // CEST
    expect(isoToSiteInput('2026-12-01T23:00:00.000Z')).toBe('2026-12-02T00:00'); // CET
    expect(isoToSiteInput(null)).toBe('');
  });

  it('reads a datetime-local value as German time (DST-safe)', () => {
    expect(siteInputToIso('2026-10-02T00:00')).toBe('2026-10-01T22:00:00.000Z');
    expect(siteInputToIso('2026-12-02T00:00')).toBe('2026-12-01T23:00:00.000Z');
    expect(siteInputToIso('2026-10-25T12:00')).toBe('2026-10-25T11:00:00.000Z'); // DST end day, CET
    expect(siteInputToIso('')).toBeNull();
  });

  it('round-trips without drift (the bug: each save moved the time)', () => {
    const iso = '2026-10-01T22:00:00.000Z';
    expect(siteInputToIso(isoToSiteInput(iso))).toBe(iso);
  });

  it('formats in German time', () => {
    expect(formatSiteDateTime('2026-10-06T20:30:00Z')).toBe('06.10.2026, 22:30');
  });
});
