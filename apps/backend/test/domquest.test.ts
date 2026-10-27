/**
 * Domquest — database side: the migration's map pool (a Domquest copy of every available Domination map),
 * the Standard Ruleset copy, the maps route and creating a Domquest tournament. Requires real PostgreSQL.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { DOMQUEST_SETTINGS, defaultRulesetFor, DEFAULT_STANDARD_RULESET } from '../src/lib/standard-ruleset.js';

const ADMIN_ID = '1d000000-0000-0000-0000-000000000001';
let app: FastifyInstance;
const createdTournamentIds: string[] = [];
const migrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages/db/prisma/migrations/20261027100100_domquest_maps_prefs_ruleset/migration.sql'),
  'utf8',
);

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
  await prisma.user.upsert({
    where: { id: ADMIN_ID },
    update: {},
    create: { id: ADMIN_ID, discord_id: 'dq_admin', username: 'DQAdmin', email: null, role: 'ADMIN' },
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
  await prisma.map.deleteMany({ where: { slug: { startsWith: 'dq-test-' } } });
  await prisma.auditLog.deleteMany({ where: { actor_id: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
  await app.close();
  await prisma.$disconnect();
});

describe('Domquest — map pool migration', () => {
  const insert = migrationSql.match(/INSERT INTO "Map"[\s\S]*?;\s*$/m)?.[0];

  it('copies every available Domination map once, with the same image, and skips unavailable ones', async () => {
    expect(insert).toBeDefined();
    await prisma.map.createMany({
      data: [
        { slug: 'dq-test-open', name: 'DQ Test Open', image_url: '/maps/dq-test-open.png', battle_type: 'DOMINATION', available: true },
        { slug: 'dq-test-off', name: 'DQ Test Off', image_url: '/maps/dq-test-off.png', battle_type: 'DOMINATION', available: false },
      ],
    });
    // Twice: ON CONFLICT keeps the copy unique if the statement ever ran again.
    await prisma.$executeRawUnsafe(insert!);
    await prisma.$executeRawUnsafe(insert!);

    const copies = await prisma.map.findMany({ where: { slug: { in: ['dq-test-open-domquest', 'dq-test-off-domquest'] } } });
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ name: 'DQ Test Open', image_url: '/maps/dq-test-open.png', battle_type: 'DOMQUEST', available: true });
  });

  it('serves the Domquest pool on its own and rejects unknown battle types', async () => {
    await prisma.map.upsert({
      where: { slug: 'dq-test-route-domquest' },
      update: {},
      create: { slug: 'dq-test-route-domquest', name: 'DQ Test Route', battle_type: 'DOMQUEST', available: true },
    });
    const res = await app.inject({ method: 'GET', url: '/api/maps?battle_type=DOMQUEST' });
    expect(res.statusCode).toBe(200);
    const maps = res.json<{ data: Array<{ slug: string; battle_type: string }> }>().data;
    expect(maps.some((m) => m.slug === 'dq-test-route-domquest')).toBe(true);
    expect(maps.every((m) => m.battle_type === 'DOMQUEST')).toBe(true);

    expect((await app.inject({ method: 'GET', url: '/api/maps?battle_type=FREE_FOR_ALL' })).statusCode).toBe(400);
  });
});

describe('Domquest — Standard Ruleset', () => {
  it('defaults to Domination bans and conduct with the settings the mod fixes', () => {
    const rs = defaultRulesetFor('DOMQUEST');
    expect(rs.settings).toEqual([...DOMQUEST_SETTINGS]);
    expect(rs.banned_factions).toEqual(DEFAULT_STANDARD_RULESET.banned_factions);
    expect(rs.conduct).toEqual(DEFAULT_STANDARD_RULESET.conduct);
  });

  it("the migration copies prod's Domination ruleset with Domquest's settings, once", async () => {
    const update = migrationSql.match(/UPDATE "AdminConfig"[\s\S]*?;\s*$/m)?.[0];
    expect(update).toBeDefined();
    const domination = {
      settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
      banned_factions: ['undead_legions'],
      banned: ['Masque of Slaanesh', 'Skreech Verminking'],
      banned_abilities: [],
      conduct: ['10 minutes to ready up', '40 minute round limit'],
    };
    const before = await prisma.adminConfig.findUnique({ where: { key: 'standard_ruleset' } });
    try {
      const value = { 'DOMINATION:ONE_V_ONE': domination, 'DOMINATION:TWO_V_TWO': domination };
      await prisma.adminConfig.upsert({ where: { key: 'standard_ruleset' }, update: { value }, create: { key: 'standard_ruleset', value } });
      await prisma.$executeRawUnsafe(update!);
      // An admin edits the copy; running the statement again must not overwrite it.
      const edited = (await prisma.adminConfig.findUniqueOrThrow({ where: { key: 'standard_ruleset' } })).value as Record<string, typeof domination>;
      edited['DOMQUEST:ONE_V_ONE']!.conduct = ['edited'];
      await prisma.adminConfig.update({ where: { key: 'standard_ruleset' }, data: { value: edited } });
      await prisma.$executeRawUnsafe(update!);

      const row = (await prisma.adminConfig.findUniqueOrThrow({ where: { key: 'standard_ruleset' } })).value as Record<string, typeof domination>;
      expect(row['DOMQUEST:ONE_V_ONE']!.conduct).toEqual(['edited']);
      expect(row['DOMQUEST:TWO_V_TWO']).toEqual({ ...domination, settings: [...DOMQUEST_SETTINGS] });
      expect(row['DOMINATION:ONE_V_ONE']).toEqual(domination); // the source stays untouched
    } finally {
      if (before) await prisma.adminConfig.update({ where: { key: 'standard_ruleset' }, data: { value: before.value as object } });
      else await prisma.adminConfig.deleteMany({ where: { key: 'standard_ruleset' } });
    }
  });
});

describe('Domquest — tournaments', () => {
  it('creates a Domquest tournament', async () => {
    const token = app.jwt.sign({ sub: ADMIN_ID, username: 'DQAdmin', role: 'ADMIN' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token },
      payload: {
        name: 'Domquest Cup',
        format: 'SWISS',
        battle_type: 'DOMQUEST',
        start_date: '2026-12-01T10:00:00.000Z',
        timezone: 'Europe/Berlin',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ id: string; battle_type: string }>();
    createdTournamentIds.push(body.id);
    expect(body.battle_type).toBe('DOMQUEST');
  });
});
