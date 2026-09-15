/**
 * Siege competitive rules at tournament creation.
 *
 * Siege is attacker-favoured on most maps, so a single game is ~a coin-flip. To count
 * competitively it is ALWAYS Bo2 (each player attacks once → the bias cancels, 1–1 = draw),
 * and a Siege tournament is points-only: no elimination bracket, no playoffs. The create
 * route rejects incompatible choices (refineSiege) and coerces the safe defaults.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = 'c1e60000-0000-0000-0000-000000000001';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: false,
    withCron: false,
    withGraphql: false,
    withDraft: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanupAll() {
  await prisma.tournament.deleteMany({ where: { host_id: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
}

beforeEach(async () => {
  await cleanupAll();
  await prisma.user.create({
    data: { id: ADMIN_ID, discord_id: 'siege_admin', username: 'SiegeAdmin', email: null, role: 'ADMIN' },
  });
});

afterEach(async () => {
  await cleanupAll();
});

function token() {
  return app.jwt.sign({ sub: ADMIN_ID, username: 'test', role: 'ADMIN' });
}

const base = {
  name: 'Siege Rules Test',
  start_date: '2026-10-01T10:00:00.000Z',
  timezone: 'Europe/Berlin',
};

function post(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/tournaments',
    cookies: { auth_token: token() },
    payload: { ...base, ...payload },
  });
}

describe('Siege competitive rules at creation', () => {
  it('rejects an elimination format for Siege', async () => {
    for (const format of ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']) {
      const res = await post({ battle_type: 'SIEGE', format });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects playoffs for Siege', async () => {
    const res = await post({ battle_type: 'SIEGE', format: 'SWISS', playoff_format: 'TOP8' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-Bo2 match format for Siege', async () => {
    const res = await post({ battle_type: 'SIEGE', format: 'SWISS', swiss_match_format: 'BO3' });
    expect(res.statusCode).toBe(400);
  });

  it('creates a Siege Swiss tournament and coerces playoff=NONE + Bo2', async () => {
    const res = await post({ battle_type: 'SIEGE', format: 'SWISS' });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: { battle_type: true, playoff_format: true, swiss_match_format: true },
    });
    expect(t.battle_type).toBe('SIEGE');
    expect(t.playoff_format).toBe('NONE');
    expect(t.swiss_match_format).toBe('BO2');
  });

  it('accepts a Siege Swiss tournament with explicit NONE + BO2', async () => {
    const res = await post({ battle_type: 'SIEGE', format: 'BALANCED_LIECHTENSTEIN', playoff_format: 'NONE', swiss_match_format: 'BO2' });
    expect(res.statusCode).toBe(201);
  });

  it('leaves Domination unaffected — an elimination bracket is still allowed', async () => {
    const res = await post({ battle_type: 'DOMINATION', format: 'SINGLE_ELIMINATION' });
    expect(res.statusCode).toBe(201);
  });
});
