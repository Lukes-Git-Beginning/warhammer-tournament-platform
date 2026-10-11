/**
 * Admin Players report: the pure row builder (window counts, team expansion, no-show rule, hosting,
 * queue + DM counters, questionnaire coverage) and the admin-only report routes (real PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import {
  answeredScopes,
  buildPlayerReportRows,
  isCustomTournamentPref,
  type PlayerReportInput,
  type ReportUser,
} from '../src/lib/admin-player-report.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const WS = new Date('2026-09-10T12:00:00Z'); // 30-day window
const IN = new Date('2026-10-01T18:00:00Z');
const OLD = new Date('2026-08-01T18:00:00Z');

function user(id: string, extra: Partial<ReportUser> = {}): ReportUser {
  return {
    id,
    username: id,
    createdAt: OLD,
    lastLogin: NOW,
    timezone: 'Europe/Berlin',
    botPolicy: 'NORMAL',
    paused: false,
    discordId: `d-${id}`,
    steamVerified: true,
    referralSource: null,
    answered: { general: false, DOMINATION: false, CONQUEST: false, SIEGE: false },
    ...extra,
  };
}

function input(patch: Partial<PlayerReportInput>): PlayerReportInput {
  return {
    windowStart: WS,
    users: [user('a'), user('b'), user('c')],
    slots: [],
    tournamentPrefCustom: new Set(),
    queuePrefSet: new Set(),
    teamMembers: new Map(),
    games: [],
    participants: [],
    hosted: [],
    queueEvents: [],
    dms: [],
    ...patch,
  };
}

const row = (rows: ReturnType<typeof buildPlayerReportRows>, id: string) =>
  rows.find((r) => r.id === id)!;

describe('buildPlayerReportRows', () => {
  it('splits games by source inside the window and keeps all-time first/last/total', () => {
    const rows = buildPlayerReportRows(
      input({
        games: [
          {
            playedAt: IN,
            type: 'TOURNAMENT',
            source: null,
            tournamentId: 't1',
            hasReplay: true,
            competitorIds: ['a', 'b'],
          },
          {
            playedAt: IN,
            type: 'OPEN_PLAY',
            source: 'QUEUE',
            tournamentId: null,
            hasReplay: false,
            competitorIds: ['a', 'b'],
          },
          {
            playedAt: IN,
            type: 'OPEN_PLAY',
            source: 'AVAILABILITY',
            tournamentId: null,
            hasReplay: true,
            competitorIds: ['a', 'c'],
          },
          {
            playedAt: IN,
            type: 'OPEN_PLAY',
            source: 'CHALLENGE',
            tournamentId: null,
            hasReplay: false,
            competitorIds: ['a', 'c'],
          },
          {
            playedAt: OLD,
            type: 'TOURNAMENT',
            source: null,
            tournamentId: 't0',
            hasReplay: true,
            competitorIds: ['a', 'b'],
          },
        ],
      }),
    );
    const a = row(rows, 'a');
    expect([
      a.tournamentGames,
      a.openPlayQueue,
      a.openPlayAvailability,
      a.openPlayChallenge,
    ]).toEqual([1, 1, 1, 1]);
    expect(a.gamesWithReplay).toBe(2); // the old game is outside the window
    expect(a.gamesTotal).toBe(5);
    expect(a.firstGameAt).toBe(OLD.toISOString());
    expect(a.lastGameAt).toBe(IN.toISOString());
  });

  it('credits 2v2 games to every team member', () => {
    const rows = buildPlayerReportRows(
      input({
        teamMembers: new Map([['team1', ['a', 'b']]]),
        games: [
          {
            playedAt: IN,
            type: 'TOURNAMENT',
            source: null,
            tournamentId: 't1',
            hasReplay: false,
            competitorIds: ['team1', 'c'],
          },
        ],
      }),
    );
    expect(rows.map((r) => r.tournamentGames)).toEqual([1, 1, 1]);
  });

  it('counts no-shows only for started tournaments without a game, drops separately', () => {
    const rows = buildPlayerReportRows(
      input({
        games: [
          {
            playedAt: IN,
            type: 'TOURNAMENT',
            source: null,
            tournamentId: 't1',
            hasReplay: false,
            competitorIds: ['a', 'b'],
          },
        ],
        participants: [
          {
            userId: 'a',
            tournamentId: 't1',
            status: 'CHECKED_IN',
            tournamentStart: IN,
            tournamentStarted: true,
          },
          {
            userId: 'c',
            tournamentId: 't1',
            status: 'REGISTERED',
            tournamentStart: IN,
            tournamentStarted: true,
          },
          {
            userId: 'c',
            tournamentId: 't2',
            status: 'REGISTERED',
            tournamentStart: IN,
            tournamentStarted: false,
          },
          {
            userId: 'b',
            tournamentId: 't3',
            status: 'WITHDREW',
            tournamentStart: IN,
            tournamentStarted: true,
          },
          {
            userId: 'b',
            tournamentId: 't4',
            status: 'JOIN_REQUESTED',
            tournamentStart: IN,
            tournamentStarted: true,
          },
          {
            userId: 'b',
            tournamentId: 't5',
            status: 'REGISTERED',
            tournamentStart: OLD,
            tournamentStarted: true,
          },
        ],
      }),
    );
    expect(row(rows, 'a')).toMatchObject({ tournamentsEntered: 1, noShows: 0, drops: 0 });
    expect(row(rows, 'c')).toMatchObject({ tournamentsEntered: 2, noShows: 1 });
    expect(row(rows, 'b')).toMatchObject({ tournamentsEntered: 1, drops: 1, noShows: 0 });
  });

  it('counts availability, hosting, queue behaviour and DMs', () => {
    const rows = buildPlayerReportRows(
      input({
        slots: [
          { userId: 'a', context: 'MATCHMAKING' },
          { userId: 'a', context: 'MATCHMAKING' },
          { userId: 'a', context: 'TOURNAMENT' },
        ],
        tournamentPrefCustom: new Set(['a']),
        queuePrefSet: new Set(['b']),
        hosted: [
          { userId: 'b', start: IN },
          { userId: 'b', start: OLD },
        ],
        queueEvents: [
          { userId: 'c', event: 'JOIN', at: IN },
          { userId: 'c', event: 'WARNING', at: IN },
          { userId: 'c', event: 'TIMEOUT', at: IN },
          { userId: 'c', event: 'TIMEOUT', at: OLD },
        ],
        dms: [
          { discordId: 'd-a', status: 'SENT' },
          { discordId: 'd-a', status: 'FAILED' },
          { discordId: 'unknown', status: 'SENT' },
        ],
      }),
    );
    expect(row(rows, 'a')).toMatchObject({
      mmSlots: 2,
      tournamentSlots: 1,
      tournamentDmFilterCustom: true,
      dmSent: 1,
      dmFailed: 1,
    });
    expect(row(rows, 'b')).toMatchObject({
      hosted: 1,
      hostedTotal: 2,
      lastHostedAt: IN.toISOString(),
      queuePrefsSaved: true,
    });
    expect(row(rows, 'c')).toMatchObject({ queueJoins: 1, queueWarnings: 1, queueTimeouts: 1 });
  });
});

describe('report helpers', () => {
  it('detects narrowed tournament DM prefs', () => {
    expect(
      isCustomTournamentPref(['DOMINATION', 'CONQUEST', 'SIEGE'], ['ONE_V_ONE', 'TWO_V_TWO']),
    ).toBe(false);
    expect(isCustomTournamentPref(['DOMINATION'], ['ONE_V_ONE', 'TWO_V_TWO'])).toBe(true);
    expect(isCustomTournamentPref(['DOMINATION', 'CONQUEST', 'SIEGE'], ['ONE_V_ONE'])).toBe(true);
  });

  it('maps answers to the questionnaire scopes they cover', () => {
    const questions = [
      { id: 'g1' },
      { id: 'd1', battleTypes: ['DOMINATION'] },
      { id: 'c1', battleTypes: ['CONQUEST'] },
    ];
    expect(answeredScopes({ g1: 'x', c1: 'y' }, questions)).toEqual({
      general: true,
      DOMINATION: false,
      CONQUEST: true,
      SIEGE: false,
    });
    expect(answeredScopes(null, questions)).toEqual({
      general: false,
      DOMINATION: false,
      CONQUEST: false,
      SIEGE: false,
    });
  });
});

describe('admin report routes', () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let player: TestUser;
  const cookie = (u: TestUser, role: string) => ({
    auth_token: app.jwt.sign({ sub: u.id, username: u.username, role }),
  });

  beforeAll(async () => {
    app = await buildApp({
      withSocket: false,
      withRedis: false,
      withCron: false,
      withGraphql: false,
      withDraft: false,
    });
    await app.ready();
    admin = await createTestUser({ username: 'report-admin' });
    player = await createTestUser({ username: 'report-player' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  });

  afterAll(async () => {
    await cleanupUsers([admin.id, player.id]);
    await app.close();
    await prisma.$disconnect();
  });

  it('serves players, hosts and schedule to admins', async () => {
    const players = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/players?days=30',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(players.statusCode).toBe(200);
    const body = players.json() as { days: number; players: { id: string }[] };
    expect(body.days).toBe(30);
    expect(body.players.some((p) => p.id === player.id)).toBe(true);

    const hosts = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/hosts?days=0',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(hosts.statusCode).toBe(200);

    const schedule = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/schedule',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(schedule.statusCode).toBe(200);
    const grid = (schedule.json() as { tournamentAvailability: number[][] }).tournamentAvailability;
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
  });

  it('rejects non-admins and bad windows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/players',
      cookies: cookie(player, 'USER'),
    });
    expect(res.statusCode).toBe(403);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/admin/reports/players?days=-1',
      cookies: cookie(admin, 'ADMIN'),
    });
    expect(bad.statusCode).toBe(400);
  });
});
