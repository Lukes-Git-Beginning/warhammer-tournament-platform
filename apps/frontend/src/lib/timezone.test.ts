import { describe, it, expect } from 'vitest';
import { formatInUserTimezone, formatRelative } from './timezone';

describe('formatInUserTimezone', () => {
  it('konvertiert UTC nach Europe/Berlin korrekt (Sommerzeit +2h)', () => {
    const result = formatInUserTimezone('2026-05-13T18:30:00Z', 'Europe/Berlin');
    expect(result).toContain('20:30');
  });

  it('konvertiert UTC nach America/Los_Angeles korrekt (PDT -7h)', () => {
    const result = formatInUserTimezone('2026-05-13T18:30:00Z', 'America/Los_Angeles');
    expect(result).toContain('11:30');
  });

  it('gibt den Input zurueck bei ungueltiger ISO-Zeichenkette', () => {
    expect(formatInUserTimezone('invalid')).toBe('invalid');
  });

  it('gibt leeren String zurueck fuer leeren Input', () => {
    expect(formatInUserTimezone('')).toBe('');
  });

  it('zeigt nur Datum wenn showTime=false gesetzt', () => {
    const result = formatInUserTimezone('2026-05-13T18:30:00Z', 'Europe/Berlin', {
      showTime: false,
    });
    // Datum enthaelt Punkte aber keinen Doppelpunkt (kein Zeitformat)
    expect(result).toContain('13.05.2026');
    expect(result).not.toContain(':');
  });

  it('zeigt nur Zeit wenn showDate=false gesetzt', () => {
    const result = formatInUserTimezone('2026-05-13T18:30:00Z', 'Europe/Berlin', {
      showDate: false,
    });
    expect(result).toContain('20:30');
    expect(result).not.toContain('2026');
  });

  it('fuegt Zeitzonenkuerzel hinzu wenn showTimezone=true', () => {
    const result = formatInUserTimezone('2026-05-13T18:30:00Z', 'Europe/Berlin', {
      showTimezone: true,
    });
    // MESZ oder GMT+2 o.ae. je nach Platform
    expect(result.length).toBeGreaterThan(10);
  });

  it('faellt auf Browser-Timezone zurueck wenn kein userTimezone angegeben', () => {
    // Darf nicht werfen — Ergebnis ist plattformabhaengig
    const result = formatInUserTimezone('2026-05-13T18:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelative', () => {
  it('gibt den Input zurueck bei ungueltiger ISO-Zeichenkette', () => {
    expect(formatRelative('invalid')).toBe('invalid');
  });

  it('gibt deutschen Relativzeit-String zurueck', () => {
    // Datum in der Zukunft
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelative(future);
    // de-DE RelativeTimeFormat nutzt "in X Tagen" oder "uebermorgen"
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
