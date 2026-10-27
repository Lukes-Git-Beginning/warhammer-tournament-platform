/**
 * Tournament-only conduct: the migration that moves the round limit and the disqualification for
 * cheating out of `conduct` into `tournament_conduct`, and the code defaults that are split the same
 * way. Requires real PostgreSQL.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prisma } from '@rizzotto/db';
import { DEFAULT_STANDARD_RULESET, StandardRulesetSchema, defaultRulesetFor } from '../src/lib/standard-ruleset.js';

const migrationSql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..',
    'packages/db/prisma/migrations/20261027100300_standard_ruleset_tournament_conduct/migration.sql',
  ),
  'utf8',
);

const EXPLOIT_OLD = 'Exploiting bugs or glitches is considered cheating and results in disqualification.';
const EXPLOIT_NEW = 'Exploiting bugs or glitches is considered cheating.';
const DQ = 'Cheating results in disqualification.';

describe('tournament-only conduct', () => {
  it('the defaults keep the round limit and disqualification out of Open Play', () => {
    for (const bt of ['DOMINATION', 'DOMQUEST', 'CONQUEST', 'LAND_BATTLE', 'SIEGE'] as const) {
      const rs = defaultRulesetFor(bt);
      expect(rs.conduct.some((c) => /round limit|disqualif/i.test(c))).toBe(false);
      expect(rs.tournament_conduct).toEqual(DEFAULT_STANDARD_RULESET.tournament_conduct);
    }
  });

  it('a ruleset stored without tournament_conduct still parses', () => {
    const rs = StandardRulesetSchema.parse({ settings: [], banned: [], conduct: ['c'] });
    expect(rs.tournament_conduct).toEqual([]);
  });

  it('the migration moves round limits and the cheating consequence, once', async () => {
    const prodLike = (roundLimit: string, extra: string[] = []) => ({
      settings: ['Default Funds'],
      banned_factions: ['undead_legions'],
      banned: [],
      banned_abilities: [],
      conduct: ['10 minutes to ready up', roundLimit, EXPLOIT_OLD, ...extra],
    });
    const value = {
      'DOMINATION:ONE_V_ONE': prodLike('40 minute round limit'),
      'SIEGE:ONE_V_ONE': prodLike('30 minute round limit'),
      'LAND_BATTLE:ONE_V_ONE': prodLike('40 minute round limit', ['Both players must attack at all times.']),
      // An admin rewrote the exploit line: it stays, and no disqualification line is invented.
      'CONQUEST:ONE_V_ONE': { ...prodLike('40 minute round limit'), conduct: ['No exploits, please.', '40 minute round limit'] },
      // Already split (e.g. edited in the admin after release): untouched.
      'DOMQUEST:ONE_V_ONE': { ...prodLike('40 minute round limit'), conduct: ['x'], tournament_conduct: ['y'] },
    };
    const before = await prisma.adminConfig.findUnique({ where: { key: 'standard_ruleset' } });
    try {
      await prisma.adminConfig.upsert({ where: { key: 'standard_ruleset' }, update: { value }, create: { key: 'standard_ruleset', value } });
      await prisma.$executeRawUnsafe(migrationSql);
      await prisma.$executeRawUnsafe(migrationSql); // a second run changes nothing

      const row = (await prisma.adminConfig.findUniqueOrThrow({ where: { key: 'standard_ruleset' } })).value as Record<
        string,
        { conduct: string[]; tournament_conduct?: string[]; settings: string[] }
      >;
      expect(row['DOMINATION:ONE_V_ONE']).toMatchObject({
        conduct: ['10 minutes to ready up', EXPLOIT_NEW],
        tournament_conduct: [DQ, '40 minute round limit'],
        settings: ['Default Funds'],
      });
      expect(row['SIEGE:ONE_V_ONE']!.tournament_conduct).toEqual([DQ, '30 minute round limit']);
      expect(row['LAND_BATTLE:ONE_V_ONE']!.conduct).toEqual(['10 minutes to ready up', EXPLOIT_NEW, 'Both players must attack at all times.']);
      expect(row['CONQUEST:ONE_V_ONE']).toMatchObject({
        conduct: ['No exploits, please.'],
        tournament_conduct: ['40 minute round limit'],
      });
      expect(row['DOMQUEST:ONE_V_ONE']).toMatchObject({ conduct: ['x'], tournament_conduct: ['y'] });
    } finally {
      if (before) await prisma.adminConfig.update({ where: { key: 'standard_ruleset' }, data: { value: before.value as object } });
      else await prisma.adminConfig.deleteMany({ where: { key: 'standard_ruleset' } });
    }
  });
});
