/**
 * Land Battle — database side: the migration's map pool (its own rows next to the Conquest maps of the
 * same name) and creating a Land Battle tournament. The pure rules live in land-battle-rules.test.ts.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';

// ---------------------------------------------------------------------------
// Database: the migration's map pool and a Land Battle tournament
// ---------------------------------------------------------------------------

const ADMIN_ID = '1b000000-0000-0000-0000-000000000001';
let app: FastifyInstance;
const createdTournamentIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
  await prisma.user.upsert({
    where: { id: ADMIN_ID },
    update: {},
    create: { id: ADMIN_ID, discord_id: 'lb_admin', username: 'LBAdmin', email: null, role: 'ADMIN' },
  });
});

afterEach(async () => {
  if (createdTournamentIds.length > 0) {
    await prisma.tournamentMapPool.deleteMany({ where: { tournament_id: { in: createdTournamentIds } } });
    await prisma.auditLog.deleteMany({ where: { entity_id: { in: createdTournamentIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
    createdTournamentIds.length = 0;
  }
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actor_id: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
  await app.close();
  await prisma.$disconnect();
});

describe('Land Battle — map pool', () => {
  it('offers its own maps, alongside (not instead of) the Conquest ones of the same name', async () => {
    const land = await app.inject({ method: 'GET', url: '/api/maps?battle_type=LAND_BATTLE' });
    expect(land.statusCode).toBe(200);
    const landMaps = land.json<{ data: Array<{ name: string; image_url: string | null }> }>().data;
    expect(landMaps.length).toBeGreaterThanOrEqual(34);
    const ashLand = landMaps.find((m) => m.name === 'Ash Plains');
    expect(ashLand?.image_url).toBe('/maps/land-battle/ash-plains.png');
    expect(landMaps.some((m) => m.name === 'Shagrath Strand')).toBe(true);

    const conquest = await app.inject({ method: 'GET', url: '/api/maps?battle_type=CONQUEST' });
    const ashConquest = conquest
      .json<{ data: Array<{ name: string; image_url: string | null }> }>()
      .data.find((m) => m.name === 'Ash Plains');
    expect(ashConquest?.image_url).toBe('/maps/ash-plains.png');
  });
});

describe('Land Battle — tournaments', () => {
  it('creates a Land Battle elimination tournament as-is (no Siege points-only coercion)', async () => {
    const token = app.jwt.sign({ sub: ADMIN_ID, username: 'LBAdmin', role: 'ADMIN' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: {
        name: 'Land Battle Cup',
        format: 'SINGLE_ELIMINATION',
        battle_type: 'LAND_BATTLE',
        start_date: '2026-12-01T10:00:00.000Z',
        timezone: 'Europe/Berlin',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ id: string; battle_type: string; format: string }>();
    createdTournamentIds.push(body.id);
    expect(body).toMatchObject({ battle_type: 'LAND_BATTLE', format: 'SINGLE_ELIMINATION' });
  });
});
