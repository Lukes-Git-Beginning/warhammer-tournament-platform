/**
 * Tournament-availability DM filter: which tournaments (battle type + team size) a player wants the
 * DM for, the REST contract for those prefs, and that paused players are skipped.
 *
 * Real PostgreSQL. No Discord sends: the recipient lookup is tested directly.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { findTournamentAvailabilityRecipients } from '../src/lib/discord-notify.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

// Tuesday 20:00 Europe/Berlin (summer) = 18:00Z.
const TUE_20_BERLIN = new Date('2026-07-14T18:00:00Z');
const SLOT = { day_of_week: 1, hour_local: 20 };

let app: FastifyInstance;
let users: TestUser[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  const ids = users.map((u) => u.id);
  await prisma.availabilitySlot.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.userTournamentNotifyPref.deleteMany({ where: { user_id: { in: ids } } });
  await cleanupUsers(ids);
  users = [];
});

/** A player with a TOURNAMENT slot on Tuesday 20:00 Berlin time. */
async function availablePlayer(name: string): Promise<TestUser> {
  const u = await createTestUser({ username: name });
  users.push(u);
  await prisma.user.update({ where: { id: u.id }, data: { timezone: 'Europe/Berlin' } });
  await prisma.availabilitySlot.create({ data: { user_id: u.id, ...SLOT, context: 'TOURNAMENT' } });
  return u;
}

const cookie = (u: TestUser) => ({ auth_token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) });
const getPrefs = (u: TestUser) =>
  app.inject({ method: 'GET', url: '/api/availability/tournament-prefs', cookies: cookie(u) });
const putPrefs = (u: TestUser, body: unknown) =>
  app.inject({ method: 'PUT', url: '/api/availability/tournament-prefs', cookies: cookie(u), payload: body as object });

async function recipientsFor(battle_type: 'DOMINATION' | 'CONQUEST' | 'SIEGE', competitor_format: 'ONE_V_ONE' | 'TWO_V_TWO') {
  const ids = await findTournamentAvailabilityRecipients({ start_date: TUE_20_BERLIN, battle_type, competitor_format });
  const ours = new Set(users.map((u) => u.discord_id));
  return ids.filter((id) => ours.has(id));
}

describe('tournament DM prefs — REST', () => {
  it('defaults to every battle type and both team sizes', async () => {
    const u = await availablePlayer('tnp-default');
    const res = await getPrefs(u);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'],
      competitorFormats: ['ONE_V_ONE', 'TWO_V_TWO'],
    });
  });

  it('stores a selection and returns it de-duplicated', async () => {
    const u = await availablePlayer('tnp-save');
    const put = await putPrefs(u, { battleTypes: ['CONQUEST', 'CONQUEST'], competitorFormats: ['TWO_V_TWO'] });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ battleTypes: ['CONQUEST'], competitorFormats: ['TWO_V_TWO'] });
    expect((await getPrefs(u)).json()).toEqual({ battleTypes: ['CONQUEST'], competitorFormats: ['TWO_V_TWO'] });
  });

  it('rejects an empty selection and unknown values', async () => {
    const u = await availablePlayer('tnp-invalid');
    expect((await putPrefs(u, { battleTypes: [], competitorFormats: ['ONE_V_ONE'] })).statusCode).toBe(400);
    expect((await putPrefs(u, { battleTypes: ['DOMINATION'], competitorFormats: [] })).statusCode).toBe(400);
    expect((await putPrefs(u, { battleTypes: ['LAND_BATTLE'], competitorFormats: ['ONE_V_ONE'] })).statusCode).toBe(400);
  });

  it('requires a login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/availability/tournament-prefs' });
    expect(res.statusCode).toBe(401);
  });
});

describe('tournament DM recipients', () => {
  it('players without stored prefs get every tournament at their slot', async () => {
    const u = await availablePlayer('tnp-all');
    expect(await recipientsFor('DOMINATION', 'ONE_V_ONE')).toEqual([u.discord_id]);
    expect(await recipientsFor('SIEGE', 'TWO_V_TWO')).toEqual([u.discord_id]);
  });

  it('filters by battle type and team size', async () => {
    const dom1v1 = await availablePlayer('tnp-dom-1v1');
    const conq = await availablePlayer('tnp-conq-any');
    await putPrefs(dom1v1, { battleTypes: ['DOMINATION'], competitorFormats: ['ONE_V_ONE'] });
    await putPrefs(conq, { battleTypes: ['CONQUEST'], competitorFormats: ['ONE_V_ONE', 'TWO_V_TWO'] });

    expect(await recipientsFor('DOMINATION', 'ONE_V_ONE')).toEqual([dom1v1.discord_id]);
    expect(await recipientsFor('DOMINATION', 'TWO_V_TWO')).toEqual([]);
    expect((await recipientsFor('CONQUEST', 'TWO_V_TWO'))).toEqual([conq.discord_id]);
    expect(await recipientsFor('SIEGE', 'ONE_V_ONE')).toEqual([]);
  });

  it('skips paused players', async () => {
    const u = await availablePlayer('tnp-paused');
    await prisma.user.update({ where: { id: u.id }, data: { availability_paused: true } });
    expect(await recipientsFor('DOMINATION', 'ONE_V_ONE')).toEqual([]);
  });

  it('only matches the tournament start slot', async () => {
    await availablePlayer('tnp-slot');
    const ids = await findTournamentAvailabilityRecipients({
      start_date: new Date('2026-07-14T19:00:00Z'), // Tue 21:00 Berlin
      battle_type: 'DOMINATION',
      competitor_format: 'ONE_V_ONE',
    });
    expect(ids.filter((id) => users.some((u) => u.discord_id === id))).toEqual([]);
  });
});
