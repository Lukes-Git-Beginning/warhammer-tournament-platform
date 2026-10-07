/**
 * Open Play is bound by the Standard Ruleset (Alex, 2026-10-07): a faction in its banned_factions
 * cannot be blind-picked there. Tournaments are not bound (hosts run with or without the Standard
 * Rules and ban factions per tournament). The default ruleset bans Undead Legions.
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { openPlayBannedFactionIds, standardBannedFactionIds, STANDARD_RULESET_CONFIG_KEY } from '../src/lib/standard-ruleset.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

let app: FastifyInstance;
const userIds: string[] = [];
const matchIds: string[] = [];
let savedConfig: { value: unknown } | null = null;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
  savedConfig = await prisma.adminConfig.findUnique({ where: { key: STANDARD_RULESET_CONFIG_KEY }, select: { value: true } });
});

afterEach(async () => {
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (userIds.length) await cleanupUsers(userIds);
  matchIds.length = 0;
  userIds.length = 0;
  // Restore whatever Standard Ruleset config the DB had.
  await prisma.adminConfig.deleteMany({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
  if (savedConfig) {
    await prisma.adminConfig.create({ data: { key: STANDARD_RULESET_CONFIG_KEY, value: savedConfig.value as object } });
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const cookieFor = (userId: string) => ({ auth_token: app.jwt.sign({ sub: userId, username: 'test', role: 'USER' }) });

async function setRuleset(bannedFactions: string[]) {
  const ruleset = { settings: [], banned_factions: bannedFactions, banned: [], banned_abilities: [], conduct: [] };
  await prisma.adminConfig.upsert({
    where: { key: STANDARD_RULESET_CONFIG_KEY },
    create: { key: STANDARD_RULESET_CONFIG_KEY, value: { 'DOMINATION:ONE_V_ONE': ruleset } },
    update: { value: { 'DOMINATION:ONE_V_ONE': ruleset } },
  });
}

async function openPlayMatch() {
  const [p1, p2] = await Promise.all([createTestUser(), createTestUser()]);
  userIds.push(p1.id, p2.id);
  const { matchId } = await createOpenPlayMatch(prisma, p1.id, p2.id, 'QUEUE', 'DOMINATION');
  matchIds.push(matchId);
  const decision = await prisma.matchMapDecision.findFirst({ where: { game: { match_id: matchId } } });
  expect(decision?.picked_map_id).toBeTruthy(); // the blind-pick phase needs a decided map
  return { matchId, p1, p2 };
}

const lock = (matchId: string, userId: string, factionId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/decision/blind-pick/lock`,
    cookies: cookieFor(userId),
    payload: { faction_id: factionId },
  });

describe('Open Play: Standard Ruleset banned factions are binding', () => {
  it('rejects a banned faction at the blind-pick lock and allows others', async () => {
    await setRuleset(['undead_legions']);
    const { matchId, p1, p2 } = await openPlayMatch();
    const banned = await lock(matchId, p1.id, 'undead_legions');
    expect(banned.statusCode).toBe(422);
    expect(banned.json<{ message: string }>().message).toMatch(/banned in Open Play/i);

    const other = await prisma.faction.findFirst({ where: { id: { not: 'undead_legions' } }, select: { id: true } });
    expect((await lock(matchId, p2.id, other!.id)).statusCode).toBe(200);
  });

  it('exposes the banned list on the decision state so the client greys it out', async () => {
    await setRuleset(['undead_legions']);
    const { matchId, p1 } = await openPlayMatch();
    const res = await app.inject({ method: 'GET', url: `/api/matches/${matchId}/decision`, cookies: cookieFor(p1.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ bannedFactions: string[] }>().bannedFactions).toEqual(['undead_legions']);
  });

  it('with no stored ruleset the default bans Undead Legions', async () => {
    await prisma.adminConfig.deleteMany({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
    expect(await standardBannedFactionIds('DOMINATION', 'ONE_V_ONE')).toEqual(['undead_legions']);
  });

  it('resolves a typed faction NAME to its id and ignores unknown entries', async () => {
    await setRuleset(['Undead Legions', 'Not A Faction']);
    expect(await standardBannedFactionIds('DOMINATION', 'ONE_V_ONE')).toEqual(['undead_legions']);
  });

  it('does not bind tournaments', async () => {
    await setRuleset(['undead_legions']);
    expect(
      await openPlayBannedFactionIds({ tournament_id: 'any-tournament', competitor_format: 'ONE_V_ONE', battle_type: 'DOMINATION' }),
    ).toEqual([]);
  });

  it('an empty ban list allows every faction', async () => {
    await setRuleset([]);
    const { matchId, p1 } = await openPlayMatch();
    expect((await lock(matchId, p1.id, 'undead_legions')).statusCode).toBe(200);
  });
});
