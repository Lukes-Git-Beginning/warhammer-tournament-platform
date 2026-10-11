import { describe, expect, it } from 'vitest';
import type { AdminPlayerReportRow } from './api';
import {
  buildFunnel,
  computeKpis,
  filterRows,
  timezoneCounts,
  toCsv,
  type PresetContext,
} from './player-report';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const ctx: PresetContext = {
  nowMs: NOW,
  windowStartMs: NOW - 30 * 86_400_000,
  lapsedDays: 21,
  notInDiscord: null,
};

function row(id: string, patch: Partial<AdminPlayerReportRow> = {}): AdminPlayerReportRow {
  return {
    id,
    username: id,
    createdAt: '2026-08-15T10:00:00.000Z',
    lastLogin: null,
    timezone: 'Europe/Berlin',
    steamVerified: true,
    referralSource: null,
    botPolicy: 'NORMAL',
    mmSlots: 0,
    tournamentSlots: 0,
    paused: false,
    tournamentDmFilterCustom: false,
    queuePrefsSaved: false,
    tournamentGames: 0,
    openPlayQueue: 0,
    openPlayAvailability: 0,
    openPlayChallenge: 0,
    gamesWithReplay: 0,
    gamesTotal: 0,
    firstGameAt: null,
    lastGameAt: null,
    tournamentsEntered: 0,
    drops: 0,
    noShows: 0,
    disqualified: 0,
    hosted: 0,
    hostedTotal: 0,
    lastHostedAt: null,
    queueJoins: 0,
    queueWarnings: 0,
    queueTimeouts: 0,
    dmSent: 0,
    dmFailed: 0,
    answered: { general: false, DOMINATION: false, CONQUEST: false, SIEGE: false },
    ...patch,
  };
}

const rows = [
  row('mm', {
    mmSlots: 3,
    openPlayQueue: 4,
    gamesTotal: 10,
    lastGameAt: '2026-10-08T20:00:00.000Z',
  }),
  row('tourney', {
    tournamentSlots: 2,
    tournamentGames: 6,
    gamesWithReplay: 1,
    gamesTotal: 6,
    lastGameAt: '2026-10-05T20:00:00.000Z',
  }),
  row('lapsed', {
    gamesTotal: 40,
    lastGameAt: '2026-08-20T20:00:00.000Z',
    botPolicy: 'NO_BROADCASTS',
  }),
  row('new', { createdAt: '2026-10-01T10:00:00.000Z', timezone: null }),
];

describe('player report presets', () => {
  it('AND-combines presets and the name search', () => {
    expect(filterRows(rows, ['openPlay'], '', ctx).map((r) => r.id)).toEqual(['mm']);
    expect(filterRows(rows, ['tournamentsOnly'], '', ctx).map((r) => r.id)).toEqual(['tourney']);
    expect(filterRows(rows, ['active', 'mmAvail'], '', ctx).map((r) => r.id)).toEqual(['mm']);
    expect(filterRows(rows, [], 'TOUR', ctx).map((r) => r.id)).toEqual(['tourney']);
  });

  it('finds lapsed players, new sign-ups, low replay rates and unreachable players', () => {
    expect(filterRows(rows, ['lapsed'], '', ctx).map((r) => r.id)).toEqual(['lapsed']);
    expect(filterRows(rows, ['newSignups'], '', ctx).map((r) => r.id)).toEqual(['new']);
    expect(filterRows(rows, ['lowReplay'], '', ctx).map((r) => r.id)).toEqual(['tourney']);
    expect(filterRows(rows, ['unreachable'], '', ctx).map((r) => r.id)).toEqual(['lapsed']);
    const withDiscord = { ...ctx, notInDiscord: new Set(['new']) };
    expect(filterRows(rows, ['unreachable'], '', withDiscord).map((r) => r.id)).toEqual([
      'lapsed',
      'new',
    ]);
  });

  it('computes KPIs relative to active players', () => {
    const k = computeKpis(rows, ctx);
    expect(k.players).toBe(4);
    expect(k.active).toBe(2);
    expect(k.mmAvail).toBe(1);
    expect(k.pct(k.mmAvail)).toBe(50);
    expect(k.lapsed).toBe(1);
  });
});

describe('funnel, timezones, CSV', () => {
  it('builds sign-up cohorts by month, newest first', () => {
    const f = buildFunnel(rows, NOW);
    expect(f.map((c) => c.month)).toEqual(['2026-10', '2026-08']);
    expect(f[1]).toEqual({
      month: '2026-08',
      registered: 3,
      verified: 3,
      played1: 3,
      played5: 3,
      active30: 2,
    });
  });

  it('counts timezones with unknown for missing ones', () => {
    expect(timezoneCounts(rows)).toEqual([
      { zone: 'Europe/Berlin', count: 3 },
      { zone: 'unknown', count: 1 },
    ]);
  });

  it('writes a CSV header and quotes awkward values', () => {
    const csv = toCsv([row('x', { username: 'Doe, "J"' })]).split('\n');
    expect(csv[0]?.startsWith('username,id,registered')).toBe(true);
    expect(csv[1]?.startsWith('"Doe, ""J""",x,2026-08-15')).toBe(true);
  });
});
