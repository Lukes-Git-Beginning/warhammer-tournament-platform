/**
 * Persistent Open Play queue settings (UserQueuePref): REST contract, join behaviour, Bo1/Bo3 +
 * Siege-Bo2 matching and series length, the filtered availability DMs and the DM offer claim.
 *
 * Real PostgreSQL + Redis. The queue keys are shared with the local Redis, so they are snapshotted
 * and restored around the suite. Discord sends are mocked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';

vi.mock('../src/lib/discord-notify.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/discord-notify.js')>()),
  notifyAvailabilityPing: vi.fn().mockResolvedValue(undefined),
  notifyMatchFoundWithButtons: vi.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '../src/app.js';
import { notifyAvailabilityPing } from '../src/lib/discord-notify.js';
import { localSlotNow } from '../src/lib/availability-time.js';
import {
  QUEUE_KEY,
  JOINED_AT_KEY,
  QUEUE_PREFS_KEY,
  runMatchmakingTick,
} from '../src/lib/matchmaking-tick.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { finalizeGameResult } from '../src/lib/match-games.js';
import { claimQueueOffer } from '../src/lib/queue-offer.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

const MM_KEYS = ['rizzotto:mm:hold', 'rizzotto:mm:ratelimit', 'rizzotto:mm:contacted', 'rizzotto:mm:tick:lock'];
const ALL_KEYS = [QUEUE_KEY, JOINED_AT_KEY, QUEUE_PREFS_KEY, ...MM_KEYS];

let app: FastifyInstance;
const saved = new Map<string, { type: string; value: string[] | Record<string, string> | string | null }>();
let users: TestUser[] = [];

async function snapshot() {
  for (const key of ALL_KEYS) {
    const type = await app.redis.type(key);
    if (type === 'list') saved.set(key, { type, value: await app.redis.lrange(key, 0, -1) });
    else if (type === 'hash') saved.set(key, { type, value: await app.redis.hgetall(key) });
    else if (type === 'string') saved.set(key, { type, value: await app.redis.get(key) });
    else if (type === 'set') saved.set(key, { type, value: await app.redis.smembers(key) });
  }
}

async function restore() {
  await app.redis.del(...ALL_KEYS);
  for (const [key, { type, value }] of saved) {
    if (type === 'list' && (value as string[]).length) await app.redis.rpush(key, ...(value as string[]));
    else if (type === 'hash' && Object.keys(value as object).length) await app.redis.hset(key, value as Record<string, string>);
    else if (type === 'string' && value !== null) await app.redis.set(key, value as string);
    else if (type === 'set' && (value as string[]).length) await app.redis.sadd(key, ...(value as string[]));
  }
}

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: true, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
  await snapshot();
});

afterAll(async () => {
  await restore();
  await app.close();
  await prisma.$disconnect();
});

async function newUser(name: string): Promise<TestUser> {
  const u = await createTestUser({ username: name });
  users.push(u);
  return u;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await app.redis.del(...ALL_KEYS);
});

afterEach(async () => {
  const ids = users.map((u) => u.id);
  await prisma.matchGame.deleteMany({ where: { match: { type: 'OPEN_PLAY', OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] } } });
  await prisma.match.deleteMany({ where: { type: 'OPEN_PLAY', OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] } });
  await prisma.team.deleteMany({ where: { captain_id: { in: ids } } });
  await prisma.availabilitySlot.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: ids } } });
  await cleanupUsers(ids);
  users = [];
  await app.redis.del(...ALL_KEYS);
});

const cookie = (u: TestUser) => ({ auth_token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) });
const getPrefs = (u: TestUser) =>
  app.inject({ method: 'GET', url: '/api/open-play/queue/prefs', cookies: cookie(u) });
const putPrefs = (u: TestUser, body: unknown) =>
  app.inject({ method: 'PUT', url: '/api/open-play/queue/prefs', cookies: cookie(u), payload: body as object });
const join = (u: TestUser, body?: unknown) =>
  app.inject({ method: 'POST', url: '/api/open-play/queue', cookies: cookie(u), payload: (body ?? {}) as object });

const DEFAULTS = {
  battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'],
  matchFormats: ['BO1', 'BO3'],
  competitorFormat: 'ONE_V_ONE',
  teamId: null,
};

async function makeTeam(captain: TestUser, mate: TestUser, acceptedMate = true) {
  return prisma.team.create({
    data: {
      name: `Duo ${captain.id.slice(0, 6)}`,
      roster_key: `${captain.id}:${mate.id}`,
      captain_id: captain.id,
      status: 'ACTIVE',
      members: {
        create: [
          { user_id: captain.id, accepted_at: new Date() },
          { user_id: mate.id, accepted_at: acceptedMate ? new Date() : null },
        ],
      },
    },
  });
}

describe('stored queue preferences', () => {
  it('new players get all battle types, Bo1+Bo3 and 1v1', async () => {
    const u = await newUser('PrefNew');
    const res = await getPrefs(u);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULTS);
  });

  it('PUT persists and GET returns the stored settings', async () => {
    const u = await newUser('PrefPut');
    const body = { battleTypes: ['CONQUEST'], matchFormats: ['BO3'], competitorFormat: 'ONE_V_ONE', teamId: null };
    expect((await putPrefs(u, body)).statusCode).toBe(200);
    expect((await getPrefs(u)).json()).toEqual(body);
    expect(await prisma.userQueuePref.count({ where: { user_id: u.id } })).toBe(1);
  });

  it('rejects empty selections and Bo5', async () => {
    const u = await newUser('PrefBad');
    expect((await putPrefs(u, { ...DEFAULTS, battleTypes: [] })).statusCode).toBe(400);
    expect((await putPrefs(u, { ...DEFAULTS, matchFormats: [] })).statusCode).toBe(400);
    expect((await putPrefs(u, { ...DEFAULTS, matchFormats: ['BO5'] })).statusCode).toBe(400);
  });

  it('a join without a body uses the stored settings', async () => {
    const u = await newUser('PrefJoin');
    await putPrefs(u, { battleTypes: ['SIEGE', 'CONQUEST'], matchFormats: ['BO3'], competitorFormat: 'ONE_V_ONE', teamId: null });
    expect((await join(u)).statusCode).toBe(200);
    expect(JSON.parse((await app.redis.hget(QUEUE_PREFS_KEY, u.id))!)).toEqual({
      format: 'ONE_V_ONE',
      battleTypes: ['SIEGE', 'CONQUEST'],
      matchFormats: ['BO3'],
    });
  });

  it('a join body only changes the stored settings with save: true', async () => {
    const u = await newUser('PrefSave');
    await join(u, { battleTypes: ['CONQUEST'], matchFormats: ['BO1'] });
    expect((await getPrefs(u)).json()).toEqual(DEFAULTS); // unchanged
    expect(JSON.parse((await app.redis.hget(QUEUE_PREFS_KEY, u.id))!).battleTypes).toEqual(['CONQUEST']);

    await app.inject({ method: 'DELETE', url: '/api/open-play/queue', cookies: cookie(u) });
    await join(u, { battleTypes: ['CONQUEST'], matchFormats: ['BO1'], save: true });
    expect((await getPrefs(u)).json()).toMatchObject({ battleTypes: ['CONQUEST'], matchFormats: ['BO1'] });
  });

  it('falls back to 1v1 when the stored team is no longer valid, without rewriting the preference', async () => {
    const cap = await newUser('PrefCap');
    const mate = await newUser('PrefMate');
    const team = await makeTeam(cap, mate, false); // only one accepted member -> not queueable
    await putPrefs(cap, { ...DEFAULTS, competitorFormat: 'TWO_V_TWO', teamId: team.id });

    const res = await join(cap);
    expect(res.statusCode).toBe(200);
    expect(res.json().fellBackTo1v1).toBe(true);
    expect(await app.redis.lpos(QUEUE_KEY, cap.id)).toBe(0);
    expect(JSON.parse((await app.redis.hget(QUEUE_PREFS_KEY, cap.id))!).format).toBe('ONE_V_ONE');
    expect((await getPrefs(cap)).json()).toMatchObject({ competitorFormat: 'TWO_V_TWO', teamId: team.id });
  });

  it('queues the stored team for 2v2 when it is valid', async () => {
    const cap = await newUser('PrefCap2');
    const mate = await newUser('PrefMate2');
    const team = await makeTeam(cap, mate);
    await putPrefs(cap, { ...DEFAULTS, competitorFormat: 'TWO_V_TWO', teamId: team.id });

    const res = await join(cap);
    expect(res.json().fellBackTo1v1).toBe(false);
    expect(await app.redis.lpos(QUEUE_KEY, team.id)).toBe(0);
    expect(JSON.parse((await app.redis.hget(QUEUE_PREFS_KEY, team.id))!).format).toBe('TWO_V_TWO');
  });

  it('an explicit 2v2 join with an invalid team is still a 400', async () => {
    const u = await newUser('PrefNoTeam');
    expect((await join(u, { competitorFormat: 'TWO_V_TWO' })).statusCode).toBe(400);
  });
});

describe('queue matching and series length', () => {
  async function joinBoth(a: object, b: object) {
    const p1 = await newUser('MatchA');
    const p2 = await newUser('MatchB');
    expect((await join(p1, a)).json().matched).toBe(false);
    const res2 = await join(p2, b);
    return { p1, p2, res2 };
  }

  it('both formats shared -> Bo1', async () => {
    const { res2 } = await joinBoth(
      { battleTypes: ['CONQUEST'], matchFormats: ['BO1', 'BO3'] },
      { battleTypes: ['CONQUEST'], matchFormats: ['BO1', 'BO3'] },
    );
    expect(res2.json().matched).toBe(true);
    const m = await prisma.match.findUnique({ where: { id: res2.json().match_id } });
    expect(m?.match_format).toBe('BO1');
  });

  it('one shared format -> that format (Bo3)', async () => {
    const { res2 } = await joinBoth(
      { battleTypes: ['DOMINATION'], matchFormats: ['BO3'] },
      { battleTypes: ['DOMINATION'], matchFormats: ['BO1', 'BO3'] },
    );
    const m = await prisma.match.findUnique({ where: { id: res2.json().match_id } });
    expect(m?.match_format).toBe('BO3');
  });

  it('disjoint formats never match', async () => {
    const { res2 } = await joinBoth(
      { battleTypes: ['DOMINATION'], matchFormats: ['BO1'] },
      { battleTypes: ['DOMINATION'], matchFormats: ['BO3'] },
    );
    expect(res2.json().matched).toBe(false);
    expect(await app.redis.llen(QUEUE_KEY)).toBe(2);
  });

  it('Siege ignores the formats and is played Bo2', async () => {
    const { res2 } = await joinBoth(
      { battleTypes: ['SIEGE'], matchFormats: ['BO1'] },
      { battleTypes: ['SIEGE'], matchFormats: ['BO3'] },
    );
    expect(res2.json().matched).toBe(true);
    const m = await prisma.match.findUnique({ where: { id: res2.json().match_id }, include: { games: true } });
    expect(m?.match_format).toBe('BO2');
    expect(m?.games[0]?.battle_type).toBe('SIEGE');
  });
});

describe('series length of queue matches', () => {
  async function reportAndFinalize(matchId: string, gameNumber: number, winnerId: string) {
    const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId, game_number: gameNumber } });
    await prisma.matchGame.update({ where: { id: game.id }, data: { reported_winner_id: winnerId } });
    await finalizeGameResult(app, game.id);
  }

  it('a Bo3 queue match needs two wins', async () => {
    const p1 = await newUser('SeriesA');
    const p2 = await newUser('SeriesB');
    const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'CONQUEST', 'ONE_V_ONE', 'BO3');

    await reportAndFinalize(matchId, 1, p1.id);
    let m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { games: true } });
    expect(m.status).toBe('ONGOING');
    expect(m.games.map((g) => g.game_number).sort()).toEqual([1, 2]);
    expect(m.games.every((g) => g.battle_type === 'CONQUEST')).toBe(true);

    await reportAndFinalize(matchId, 2, p1.id);
    m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { games: true } });
    expect(m.status).toBe('COMPLETED');
    expect(m.winner_id).toBe(p1.id);
  });

  it('a Bo1 queue match ends after one game', async () => {
    const p1 = await newUser('SeriesC');
    const p2 = await newUser('SeriesD');
    const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', 'BO1');
    await reportAndFinalize(matchId, 1, p2.id);
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(m.status).toBe('COMPLETED');
    expect(m.winner_id).toBe(p2.id);
  });

  it('a Siege queue match is Bo2: both games are played and 1-1 is a draw', async () => {
    const p1 = await newUser('SeriesE');
    const p2 = await newUser('SeriesF');
    const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'SIEGE', 'ONE_V_ONE', 'BO2');
    await reportAndFinalize(matchId, 1, p1.id);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe('ONGOING');
    await reportAndFinalize(matchId, 2, p2.id);
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(m.status).toBe('COMPLETED');
    expect(m.winner_id).toBeNull();
  });
});

describe('availability DM filter', () => {
  async function availableUser(name: string, prefs?: object) {
    const u = await newUser(name);
    const local = localSlotNow(new Date(), null);
    await prisma.availabilitySlot.create({
      data: { user_id: u.id, day_of_week: local.day_of_week, hour_local: local.hour, context: 'MATCHMAKING' },
    });
    if (prefs) await putPrefs(u, prefs);
    return u;
  }
  const waiter = async (id: string, prefs: object) => {
    await app.redis.rpush(QUEUE_KEY, id);
    await app.redis.hset(QUEUE_PREFS_KEY, id, JSON.stringify(prefs));
  };
  const BOTH = ['BO1', 'BO3'];

  it('does not DM a recipient whose saved settings fit no waiting entry', async () => {
    const u = await availableUser('DmMiss', { ...DEFAULTS, battleTypes: ['DOMINATION'] });
    await waiter('w1', { format: 'ONE_V_ONE', battleTypes: ['CONQUEST'], matchFormats: BOTH });
    await runMatchmakingTick(app);
    await new Promise((r) => setImmediate(r));
    expect(notifyAvailabilityPing).not.toHaveBeenCalledWith(u.discord_id, expect.anything(), expect.anything());
    // No DM sent -> no hold/rate-limit armed either.
    expect(await app.redis.exists('rizzotto:mm:hold')).toBe(0);
  });

  it('does not DM when only the series length is disjoint (non-Siege)', async () => {
    const u = await availableUser('DmFmt', { ...DEFAULTS, battleTypes: ['CONQUEST'], matchFormats: ['BO3'] });
    await waiter('w1', { format: 'ONE_V_ONE', battleTypes: ['CONQUEST'], matchFormats: ['BO1'] });
    await runMatchmakingTick(app);
    await new Promise((r) => setImmediate(r));
    expect(notifyAvailabilityPing).not.toHaveBeenCalledWith(u.discord_id, expect.anything(), expect.anything());
  });

  it('DMs a matching recipient with de-duplicated offers (Siege -> Bo2)', async () => {
    const u = await availableUser('DmHit', { ...DEFAULTS, battleTypes: ['CONQUEST', 'SIEGE'], matchFormats: ['BO1'] });
    await waiter('w1', { format: 'ONE_V_ONE', battleTypes: ['CONQUEST', 'SIEGE'], matchFormats: BOTH });
    await waiter('w2', { format: 'ONE_V_ONE', battleTypes: ['SIEGE'], matchFormats: ['BO3'] });
    await runMatchmakingTick(app);
    await new Promise((r) => setImmediate(r));
    expect(notifyAvailabilityPing).toHaveBeenCalledTimes(1);
    const [discordId, count, offers] = vi.mocked(notifyAvailabilityPing).mock.calls[0]!;
    expect(discordId).toBe(u.discord_id);
    expect(count).toBe(2);
    expect(offers).toEqual([
      { battleType: 'CONQUEST', size: 1, matchFormat: 'BO1' },
      { battleType: 'SIEGE', size: 1, matchFormat: 'BO2' },
    ]);
  });

  it('2v2 offers only reach captains of a valid active team', async () => {
    const cap = await availableUser('DmCap');
    const mate = await newUser('DmMate');
    const team = await makeTeam(cap, mate);
    await putPrefs(cap, { ...DEFAULTS, competitorFormat: 'TWO_V_TWO', teamId: team.id });
    const noTeam = await availableUser('DmNoTeam', { ...DEFAULTS, competitorFormat: 'TWO_V_TWO' });
    await waiter('t-other', { format: 'TWO_V_TWO', battleTypes: ['CONQUEST'], matchFormats: BOTH });

    await runMatchmakingTick(app);
    await new Promise((r) => setImmediate(r));
    const called = vi.mocked(notifyAvailabilityPing).mock.calls;
    expect(called.map((c) => c[0])).toEqual([cap.discord_id]);
    expect(called[0]![2]).toEqual([{ battleType: 'CONQUEST', size: 2, matchFormat: 'BO1' }]);
    expect(called.map((c) => c[0])).not.toContain(noTeam.discord_id);
  });
});

describe('claimQueueOffer (Discord offer button)', () => {
  const BOTH = ['BO1', 'BO3'];

  it('pairs with a fitting waiting entry, creates the match with that format, keeps stored settings', async () => {
    const waiting = await newUser('OfferWait');
    const clicker = await newUser('OfferClick');
    await putPrefs(clicker, { ...DEFAULTS, battleTypes: ['DOMINATION'], matchFormats: ['BO1'] });
    await app.redis.rpush(QUEUE_KEY, waiting.id);
    await app.redis.hset(QUEUE_PREFS_KEY, waiting.id, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['CONQUEST'], matchFormats: ['BO3'] }));

    const res = await claimQueueOffer(app, clicker.id, { battleType: 'CONQUEST', size: 1, matchFormat: 'BO3' });
    expect(res.status).toBe('matched');
    if (res.status !== 'matched') return;
    const m = await prisma.match.findUniqueOrThrow({ where: { id: res.matchId }, include: { games: true } });
    expect(m.match_format).toBe('BO3');
    expect(m.source).toBe('AVAILABILITY');
    expect(m.games[0]?.battle_type).toBe('CONQUEST');
    expect([m.player1_id, m.player2_id].sort()).toEqual([waiting.id, clicker.id].sort());
    // Queue emptied, clicker never queued, stored settings untouched.
    expect(await app.redis.llen(QUEUE_KEY)).toBe(0);
    expect((await getPrefs(clicker)).json()).toMatchObject({ battleTypes: ['DOMINATION'], matchFormats: ['BO1'] });
  });

  it('offer gone: no match, clicker is not left in the queue, others untouched', async () => {
    const waiting = await newUser('OfferWait2');
    const clicker = await newUser('OfferClick2');
    await app.redis.rpush(QUEUE_KEY, waiting.id);
    await app.redis.hset(QUEUE_PREFS_KEY, waiting.id, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['DOMINATION'], matchFormats: BOTH }));

    const res = await claimQueueOffer(app, clicker.id, { battleType: 'CONQUEST', size: 1, matchFormat: 'BO1' });
    expect(res.status).toBe('gone');
    expect(await app.redis.lrange(QUEUE_KEY, 0, -1)).toEqual([waiting.id]);
    expect(await app.redis.lpos(QUEUE_KEY, clicker.id)).toBeNull();
    expect(await app.redis.hget(QUEUE_PREFS_KEY, clicker.id)).toBeNull();
  });

  it('an empty queue is also "gone"', async () => {
    const clicker = await newUser('OfferClick3');
    expect((await claimQueueOffer(app, clicker.id, { battleType: 'SIEGE', size: 1, matchFormat: 'BO2' })).status).toBe('gone');
  });

  it('Siege offers are Bo2 regardless of the waiting entry’s format list', async () => {
    const waiting = await newUser('OfferWait4');
    const clicker = await newUser('OfferClick4');
    await app.redis.rpush(QUEUE_KEY, waiting.id);
    await app.redis.hset(QUEUE_PREFS_KEY, waiting.id, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['SIEGE'], matchFormats: ['BO3'] }));
    const res = await claimQueueOffer(app, clicker.id, { battleType: 'SIEGE', size: 1, matchFormat: 'BO2' });
    expect(res.status).toBe('matched');
    if (res.status !== 'matched') return;
    expect((await prisma.match.findUniqueOrThrow({ where: { id: res.matchId } })).match_format).toBe('BO2');
  });

  it('does not take an offer for a different team size', async () => {
    const waiting = await newUser('OfferWait5');
    const clicker = await newUser('OfferClick5');
    await app.redis.rpush(QUEUE_KEY, waiting.id);
    await app.redis.hset(QUEUE_PREFS_KEY, waiting.id, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['CONQUEST'], matchFormats: BOTH }));
    const res = await claimQueueOffer(app, clicker.id, { battleType: 'CONQUEST', size: 2, matchFormat: 'BO1' });
    expect(res.status).toBe('blocked'); // clicker has no valid team
    expect(await app.redis.lrange(QUEUE_KEY, 0, -1)).toEqual([waiting.id]);
  });
});
