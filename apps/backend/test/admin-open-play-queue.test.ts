/**
 * GET /api/admin/open-play/queue — the admin "Queue" panel. Each entry carries what it queued for
 * (battle types + 1v1/2v2) from the queue prefs hash, and 2v2 entries (queued as the TEAM id,
 * team-as-actor) are resolved to the team instead of silently dropping out of the list.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { QUEUE_KEY, QUEUE_PREFS_KEY } from '../src/lib/matchmaking-tick.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';

const ADMIN_ID = 'a91a0000-0000-0000-0000-000000000001';
const P1_ID = 'a91a0000-0000-0000-0000-000000000002';
const P2_ID = 'a91a0000-0000-0000-0000-000000000003';
const P3_ID = 'a91a0000-0000-0000-0000-000000000004';
const TEAM_ID = 'a91a0000-0000-0000-0000-0000000000aa';
const USER_IDS = [ADMIN_ID, P1_ID, P2_ID, P3_ID];

let app: FastifyInstance;
// The test uses the real queue keys of the (local/CI) Redis — snapshot and restore them.
let savedQueue: string[] = [];
let savedPrefs: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: true, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
  savedQueue = await app.redis.lrange(QUEUE_KEY, 0, -1);
  savedPrefs = await app.redis.hgetall(QUEUE_PREFS_KEY);
});

afterAll(async () => {
  await app.redis.del(QUEUE_KEY, QUEUE_PREFS_KEY);
  if (savedQueue.length > 0) await app.redis.rpush(QUEUE_KEY, ...savedQueue);
  if (Object.keys(savedPrefs).length > 0) await app.redis.hset(QUEUE_PREFS_KEY, savedPrefs);
  await app.close();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.match.deleteMany({ where: { type: 'OPEN_PLAY', player1_id: { in: [...USER_IDS, TEAM_ID] } } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await app.redis.del(QUEUE_KEY, QUEUE_PREFS_KEY);
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'aq_admin', username: 'QueueAdmin', email: null, role: 'ADMIN' },
      { id: P1_ID, discord_id: 'aq_p1', username: 'Domi', email: null, role: 'USER' },
      { id: P2_ID, discord_id: 'aq_p2', username: 'Legacy', email: null, role: 'USER' },
      { id: P3_ID, discord_id: 'aq_p3', username: 'Captain', email: null, role: 'USER' },
    ],
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: 'Queue Duo',
      roster_key: `${P1_ID}:${P3_ID}`,
      captain_id: P3_ID,
      status: 'ACTIVE',
      members: {
        create: [
          { user_id: P3_ID, accepted_at: new Date() },
          { user_id: P1_ID, accepted_at: new Date() },
        ],
      },
    },
  });
});

afterEach(cleanup);

function getQueue(role = 'ADMIN') {
  return app.inject({
    method: 'GET',
    url: '/api/admin/open-play/queue',
    cookies: { auth_token: app.jwt.sign({ sub: ADMIN_ID, username: 'QueueAdmin', role }) },
  });
}

describe('GET /api/admin/open-play/queue', () => {
  it('lists each entry in queue order with the battle types + format it queued for', async () => {
    await app.redis.rpush(QUEUE_KEY, P1_ID, P2_ID, TEAM_ID);
    await app.redis.hset(QUEUE_PREFS_KEY, P1_ID, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['DOMINATION', 'SIEGE'] }));
    await app.redis.hset(QUEUE_PREFS_KEY, TEAM_ID, JSON.stringify({ format: 'TWO_V_TWO', battleTypes: ['CONQUEST'] }));
    // P2 has no prefs (legacy join via Discord button) → defaults to 1v1, every battle type.

    const res = await getQueue();
    expect(res.statusCode).toBe(200);
    const { members } = res.json<{ members: Array<{ id: string; username: string; isTeam: boolean; format: string; battleTypes: string[] }> }>();

    expect(members.map((m) => m.id)).toEqual([P1_ID, P2_ID, TEAM_ID]);
    expect(members[0]).toMatchObject({ username: 'Domi', isTeam: false, format: 'ONE_V_ONE', battleTypes: ['DOMINATION', 'SIEGE'] });
    expect(members[1]).toMatchObject({ username: 'Legacy', isTeam: false, format: 'ONE_V_ONE', battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'] });
    // The 2v2 team used to be dropped (the route only looked ids up as users).
    expect(members[2]).toMatchObject({ username: 'Queue Duo', isTeam: true, format: 'TWO_V_TWO', battleTypes: ['CONQUEST'] });
  });

  it('is empty when nobody is queued', async () => {
    const res = await getQueue();
    expect(res.statusCode).toBe(200);
    expect(res.json<{ members: unknown[] }>().members).toEqual([]);
  });
});

describe('GET /api/admin/open-play/active-matches', () => {
  it('carries each match\'s battle type and 1v1/2v2 format', async () => {
    const { matchId: siegeId } = await createOpenPlayMatch(prisma, P1_ID, P2_ID, 'QUEUE', 'SIEGE');
    const { matchId: duoId } = await createOpenPlayMatch(prisma, TEAM_ID, P2_ID, 'QUEUE', 'CONQUEST', 'TWO_V_TWO');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/open-play/active-matches',
      cookies: { auth_token: app.jwt.sign({ sub: ADMIN_ID, username: 'QueueAdmin', role: 'ADMIN' }) },
    });
    expect(res.statusCode).toBe(200);
    const { matches } = res.json<{ matches: Array<{ id: string; format: string; battleType: string | null }> }>();
    expect(matches.find((m) => m.id === siegeId)).toMatchObject({ format: 'ONE_V_ONE', battleType: 'SIEGE' });
    expect(matches.find((m) => m.id === duoId)).toMatchObject({ format: 'TWO_V_TWO', battleType: 'CONQUEST' });
  });
});
