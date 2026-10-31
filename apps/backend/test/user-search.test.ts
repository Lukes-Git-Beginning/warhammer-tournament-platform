/**
 * GET /api/users/search — the picker search. It hides the caller by default (2v2 teammate picker),
 * but the host's late-joiner picker passes includeSelf=true so a host can add themselves.
 * Requires real PostgreSQL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
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

async function search(token: string, query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/users/search?${query}`, cookies: { auth_token: token } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { users: Array<{ id: string }> }).users.map((u) => u.id);
}

describe('GET /api/users/search', () => {
  it('hides the caller by default and includes them with includeSelf=true', async () => {
    const tag = `srch${Date.now().toString(36)}`;
    const me = await createTestUser({ username: `${tag}-host` });
    const other = await createTestUser({ username: `${tag}-player` });
    createdUserIds.push(me.id, other.id);
    const token = app.jwt.sign({ sub: me.id, username: `${tag}-host`, role: 'USER' });

    const byDefault = await search(token, `q=${tag}`);
    expect(byDefault).toContain(other.id);
    expect(byDefault).not.toContain(me.id);

    const withSelf = await search(token, `q=${tag}&includeSelf=true`);
    expect(withSelf).toEqual(expect.arrayContaining([me.id, other.id]));
  });
});
