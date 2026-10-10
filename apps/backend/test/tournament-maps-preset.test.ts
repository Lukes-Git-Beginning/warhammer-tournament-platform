/**
 * GET /api/tournaments/:slug/maps includes the host-preset maps (onslaught-testing-tournament,
 * 2026-10-10): rounds 3–5 used preset maps outside the pool snapshot, so clients — which resolve a
 * match's map name/image from this list — showed players no map from round 3 on.
 *
 * Requires real PostgreSQL. No Redis.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { presetMapIdsOf } from '../src/routes/tournaments.js';
import { createTestUser, createTestTournament, cleanupTournament, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const tournamentIds: string[] = [];
const mapIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterEach(async () => {
  for (const id of tournamentIds) {
    await prisma.tournamentMapPool.deleteMany({ where: { tournament_id: id } });
    await cleanupTournament(id);
  }
  if (mapIds.length) await prisma.map.deleteMany({ where: { id: { in: mapIds } } });
  if (userIds.length) await cleanupUsers(userIds);
  tournamentIds.length = 0;
  mapIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function makeMap(name: string): Promise<string> {
  const id = randomUUID();
  await prisma.map.create({ data: { id, slug: `test-map-${id}`, name } });
  mapIds.push(id);
  return id;
}

describe('tournament maps include host-preset maps', () => {
  it('lists pool maps plus every map named in the preset (also pick/ban sub-pools), once each', async () => {
    const host = await createTestUser();
    userIds.push(host.id);
    const t = await createTestTournament({ organizerId: host.id });
    tournamentIds.push(t.id);
    const [inPool, presetOnly, pickBanOnly] = [await makeMap('A Pool'), await makeMap('B Preset'), await makeMap('C PickBan')];
    await prisma.tournamentMapPool.create({ data: { tournament_id: t.id, map_id: inPool } });
    await prisma.tournament.update({
      where: { id: t.id },
      data: { map_decision_mode: 'HOST_PRESET', map_preset_config: { swiss_1: [inPool], swiss_3: [presetOnly], playoff_sf: [[pickBanOnly, inPool]] } },
    });

    const res = await app.inject({ method: 'GET', url: `/api/tournaments/${t.slug}/maps` });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ data: { id: string }[] }>().data.map((m) => m.id);
    expect(ids.sort()).toEqual([inPool, presetOnly, pickBanOnly].sort());
  });

  it('presetMapIdsOf flattens and dedupes, ignoring junk', () => {
    expect(presetMapIdsOf({ swiss_1: ['b', 'a'], playoff_sf: [['a', 'c'], ['d']], weird: 5 })).toEqual(['a', 'b', 'c', 'd']);
    expect(presetMapIdsOf(null)).toEqual([]);
  });
});
