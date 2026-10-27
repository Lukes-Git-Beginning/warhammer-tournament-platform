/**
 * One-time site notices: the Arena Mod release notice goes to players who aren't on the RizzOttoverse
 * Discord server, until they dismiss it. CI has no bot token, so membership is unknown there unless the
 * user row already carries a fresh answer. Requires real PostgreSQL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';

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

async function userWithToken(data: { discord_member?: boolean; discord_member_checked_at?: Date } = {}) {
  const u = await createTestUser();
  createdUserIds.push(u.id);
  if (Object.keys(data).length) await prisma.user.update({ where: { id: u.id }, data });
  return { id: u.id, token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) };
}

const notices = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/api/users/me/notices', cookies: { auth_token: token } })).json<{ notices: string[] }>().notices;

describe('site notices', () => {
  it('shows the release notice when membership is unknown, and hides it once dismissed', async () => {
    const { token } = await userWithToken();
    expect(await notices(token)).toEqual(['arena-mod-release']);

    const res = await app.inject({ method: 'POST', url: '/api/users/me/notices/arena-mod-release/dismiss', cookies: { auth_token: token } });
    expect(res.statusCode).toBe(200);
    expect(await notices(token)).toEqual([]);
  });

  it('skips the notice for a known member of the Discord server', async () => {
    const { token } = await userWithToken({ discord_member: true, discord_member_checked_at: new Date() });
    expect(await notices(token)).toEqual([]);
  });

  it('shows it to a known non-member', async () => {
    const { token } = await userWithToken({ discord_member: false, discord_member_checked_at: new Date() });
    expect(await notices(token)).toEqual(['arena-mod-release']);
  });

  it('rejects dismissing an unknown notice', async () => {
    const { token } = await userWithToken();
    const res = await app.inject({ method: 'POST', url: '/api/users/me/notices/nope/dismiss', cookies: { auth_token: token } });
    expect(res.statusCode).toBe(400);
  });
});
