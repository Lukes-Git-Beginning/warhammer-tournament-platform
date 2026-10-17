/**
 * Land Battle — database side: the migration's map pool (its own rows next to the Conquest maps of the
 * same name) and creating a Land Battle tournament. The pure rules live in land-battle-rules.test.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { LAND_BATTLE_CONDUCT } from '../src/lib/standard-ruleset.js';

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

describe('Land Battle — Standard Ruleset migration', () => {
  // Prod has an admin-edited ruleset row, which the CI database (fresh migrations) does not — so run the
  // migration's two ruleset UPDATEs against a prod-shaped row here, then restore whatever was there.
  const migrationSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages/db/prisma/migrations/20261017100100_land_battle_maps_prefs_ruleset/migration.sql'),
    'utf8',
  );
  const rulesetUpdates = migrationSql.match(/UPDATE "AdminConfig"[\s\S]*?;\s*$/gm) ?? [];
  const conquest = {
    settings: ['Default Funds', 'Ultra Unit Scale', '600 Tickets', 'No Character Loading', 'Unit Caps On'],
    banned_factions: ['undead_legions'],
    banned: ['Masque of Slaanesh'],
    banned_abilities: ['Ghostly Howl (Banshees)'],
    conduct: ['10 minutes to ready up', '40 minute round limit'],
  };

  it('copies Conquest without tickets and appends the rules of play once', async () => {
    expect(rulesetUpdates).toHaveLength(2);
    const before = await prisma.adminConfig.findUnique({ where: { key: 'standard_ruleset' } });
    try {
      await prisma.adminConfig.upsert({
        where: { key: 'standard_ruleset' },
        update: { value: { 'CONQUEST:ONE_V_ONE': conquest, 'CONQUEST:TWO_V_TWO': conquest } },
        create: { key: 'standard_ruleset', value: { 'CONQUEST:ONE_V_ONE': conquest, 'CONQUEST:TWO_V_TWO': conquest } },
      });
      // Twice: the migration must not duplicate anything if it ever ran against an already-seeded row.
      for (let i = 0; i < 2; i++) for (const sql of rulesetUpdates) await prisma.$executeRawUnsafe(sql);

      const row = await prisma.adminConfig.findUniqueOrThrow({ where: { key: 'standard_ruleset' } });
      const value = row.value as Record<string, typeof conquest>;
      for (const key of ['LAND_BATTLE:ONE_V_ONE', 'LAND_BATTLE:TWO_V_TWO']) {
        expect(value[key]!.settings).toEqual(['Default Funds', 'Ultra Unit Scale', 'No Character Loading', 'Unit Caps On']);
        expect(value[key]!.banned_abilities).toEqual(conquest.banned_abilities);
        expect(value[key]!.conduct).toEqual([...conquest.conduct, ...LAND_BATTLE_CONDUCT]);
      }
      expect(value['CONQUEST:ONE_V_ONE']).toEqual(conquest); // the source stays untouched
    } finally {
      if (before) await prisma.adminConfig.update({ where: { key: 'standard_ruleset' }, data: { value: before.value as object } });
      else await prisma.adminConfig.deleteMany({ where: { key: 'standard_ruleset' } });
    }
  });
});
