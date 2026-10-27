/**
 * The welcome page (onboarding): /me tells the frontend whether to show it (onboarded_at) and whether the
 * player is on the Discord server (discord_member); onboarding-complete closes it for good; the release
 * migration marks every existing player as past it. Requires real PostgreSQL.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

const backfillSql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..',
    'packages/db/prisma/migrations/20261027100400_backfill_onboarded_at/migration.sql',
  ),
  'utf8',
);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const createdUserIds: string[] = [];
afterEach(async () => {
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdUserIds.length = 0;
});

async function newPlayer(data: { discord_member?: boolean } = {}) {
  const u = await createTestUser();
  createdUserIds.push(u.id);
  await prisma.user.update({ where: { id: u.id }, data: { onboarded_at: null, ...data } });
  return { id: u.id, token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) };
}

const me = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/api/users/me', cookies: { auth_token: token } })).json<{
    onboarded_at: string | null;
    discord_member: boolean | null;
  }>();

describe('welcome page', () => {
  it('/me says a new player has not seen it, and whether he is on the Discord server', async () => {
    const unknown = await newPlayer();
    expect(await me(unknown.token)).toMatchObject({ onboarded_at: null, discord_member: null });
    const member = await newPlayer({ discord_member: true });
    expect((await me(member.token)).discord_member).toBe(true);
  });

  it('onboarding-complete closes it for good', async () => {
    const { token } = await newPlayer();
    const res = await app.inject({ method: 'POST', url: '/api/users/me/onboarding-complete', cookies: { auth_token: token }, payload: {} });
    expect(res.statusCode).toBe(200);
    expect((await me(token)).onboarded_at).not.toBeNull();
  });

  it('the release migration marks existing players as past it', async () => {
    const { id } = await newPlayer();
    const ROLLBACK = new Error('rollback');
    // In a rolled-back transaction: the statement touches every user, and a local test run shares the dev DB.
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(backfillSql);
        const row = await tx.user.findUniqueOrThrow({ where: { id }, select: { onboarded_at: true } });
        expect(row.onboarded_at).not.toBeNull();
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });
  });
});
