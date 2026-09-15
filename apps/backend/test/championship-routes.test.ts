/**
 * Championship finals wiring: the admin-only championship tag on create, the preview endpoints
 * that feed the leaderboard tile, and the seed/raffle error paths. The size-formula math is
 * covered separately in competitive-finals-size.test.ts; here the quarter has no games, so the
 * field is empty (size 0) — which exercises the "not enough activity" + tile-preview paths.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = 'cf1a0000-0000-0000-0000-000000000001';
const USER_ID = 'cf1a0000-0000-0000-0000-000000000002';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanupAll() {
  await prisma.tournament.deleteMany({ where: { host_id: { in: [ADMIN_ID, USER_ID] } } });
  await prisma.competitiveCycleSnapshot.deleteMany({ where: { period: '2026-Q3' } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
}

beforeEach(async () => {
  await cleanupAll();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'champ_admin', username: 'ChampAdmin', email: null, role: 'ADMIN' },
      { id: USER_ID, discord_id: 'champ_user', username: 'ChampUser', email: null, role: 'USER' },
    ],
  });
});

afterEach(async () => {
  await cleanupAll();
});

function token(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

const base = {
  name: 'Q3 Domination Championship',
  start_date: '2026-10-05T18:00:00.000Z',
  timezone: 'Europe/Berlin',
  format: 'SINGLE_ELIMINATION',
  battle_type: 'DOMINATION',
  competitor_format: 'ONE_V_ONE',
};

function createChampionship(userId: string, role: string) {
  return app.inject({
    method: 'POST',
    url: '/api/tournaments',
    cookies: { auth_token: token(userId, role) },
    payload: { ...base, championship_kind: 'QUARTERLY', championship_period: '2026-Q3' },
  });
}

describe('Championship finals routes', () => {
  it('rejects a non-admin setting the championship tag', async () => {
    const res = await createChampionship(USER_ID, 'USER');
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin create a tagged final and persists the tag', async () => {
    const res = await createChampionship(ADMIN_ID, 'ADMIN');
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: { championship_kind: true, championship_period: true },
    });
    expect(t.championship_kind).toBe('QUARTERLY');
    expect(t.championship_period).toBe('2026-Q3');
  });

  it('rejects the tag without a period', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
      payload: { ...base, championship_kind: 'QUARTERLY' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('quarterly preview lists all three battle types and links the created final', async () => {
    await createChampionship(ADMIN_ID, 'ADMIN');
    const res = await app.inject({ method: 'GET', url: '/api/championships/quarterly?period=2026-Q3&competitorFormat=ONE_V_ONE' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ battleTypes: Array<{ battleType: string; size: number; belowFloor: boolean; tournament: { slug: string } | null }> }>();
    expect(body.battleTypes.map((b) => b.battleType).sort()).toEqual(['CONQUEST', 'DOMINATION', 'SIEGE']);
    const dom = body.battleTypes.find((b) => b.battleType === 'DOMINATION')!;
    expect(dom.size).toBe(0); // no games in the quarter
    expect(dom.belowFloor).toBe(true);
    expect(dom.tournament).not.toBeNull();
  });

  it('seed returns 422 when the field is empty (not enough activity)', async () => {
    const create = await createChampionship(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/seed`,
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
    });
    expect(res.statusCode).toBe(422);
  });

  it('ladder preview returns an empty field for a quiet month', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/championships/ladder?period=2026-08' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ players: number; size: number; tournament: unknown }>();
    expect(body.players).toBe(0);
    expect(body.size).toBe(0);
    expect(body.tournament).toBeNull();
  });
});
