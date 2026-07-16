/**
 * Integration test for FACTION_WAR mode — each faction is globally exclusive: once a
 * player claims it, no other player in the tournament can pick it (first come, first
 * served). Withdrawing frees the faction again.
 *
 * Requires real PostgreSQL + at least 2 seeded factions (skips gracefully otherwise).
 * No Redis, no Socket.IO.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function cookieFor(userId: string) {
  const token = app.jwt.sign({ sub: userId, username: 'test', role: 'USER' });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return { [cookieName]: token };
}

const createdTournamentIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdUserIds.length = 0;
});

async function twoFactionIds(): Promise<[string, string] | null> {
  const f = await prisma.faction.findMany({ take: 2, select: { id: true }, orderBy: { id: 'asc' } });
  return f.length >= 2 ? [f[0]!.id, f[1]!.id] : null;
}

async function setupOpenTournament(): Promise<string> {
  const host = await createTestUser({ username: 'FWHost' });
  createdUserIds.push(host.id);
  const id = randomUUID();
  createdTournamentIds.push(id);
  const slug = `test-fw-${id.slice(0, 8)}`;
  await prisma.tournament.create({
    data: {
      id,
      slug,
      name: 'Faction War Test',
      host_id: host.id,
      format: 'SWISS',
      mode: 'FACTION_WAR',
      status: 'OPEN_REGISTRATION',
      start_date: new Date('2027-06-01'), // future → registration open, no auto check-in
      timezone: 'Europe/Berlin',
    },
  });
  return slug;
}

function register(slug: string, user: TestUser, factionId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/tournaments/${slug}/register`,
    cookies: cookieFor(user.id),
    payload: { faction_id: factionId },
  });
}

describe('FACTION_WAR — globally exclusive faction picks', () => {
  it('rejects a faction already claimed by another player, allows a free one', async () => {
    const factions = await twoFactionIds();
    if (!factions) return; // no seeded factions → skip
    const [x, y] = factions;
    const slug = await setupOpenTournament();
    const a = await createTestUser({ username: 'FWA' });
    const b = await createTestUser({ username: 'FWB' });
    createdUserIds.push(a.id, b.id);

    expect((await register(slug, a, x)).statusCode).toBeLessThan(300); // A claims X
    expect((await register(slug, b, x)).statusCode).toBe(409); // X is taken
    expect((await register(slug, b, y)).statusCode).toBeLessThan(300); // Y is free

    const taken = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/taken-factions` });
    expect(taken.statusCode).toBe(200);
    expect(new Set(taken.json().takenFactionIds as string[])).toEqual(new Set([x, y]));
  });

  it('frees the faction when its holder withdraws, so another player can take it', async () => {
    const factions = await twoFactionIds();
    if (!factions) return;
    const [x] = factions;
    const slug = await setupOpenTournament();
    const a = await createTestUser({ username: 'FWA2' });
    const b = await createTestUser({ username: 'FWB2' });
    createdUserIds.push(a.id, b.id);

    expect((await register(slug, a, x)).statusCode).toBeLessThan(300);
    expect((await register(slug, b, x)).statusCode).toBe(409); // taken by A

    const withdraw = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${slug}/withdraw`,
      cookies: cookieFor(a.id),
    });
    expect(withdraw.statusCode).toBeLessThan(300);

    expect((await register(slug, b, x)).statusCode).toBeLessThan(300); // X is free again
  });
});
