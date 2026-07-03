/**
 * GET /api/tournaments visibility: drafts appear in the list only for their host
 * (and co-hosts / staff), never for anonymous or unrelated viewers.
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

const tournamentIds: string[] = [];
const userIds: string[] = [];
let host: TestUser;
let other: TestUser;
let draftSlug: string;
let publishedSlug: string;

function cookieFor(userId: string, role = 'USER') {
  const token = app.jwt.sign({ sub: userId, username: 'test', role });
  return { [process.env.JWT_COOKIE_NAME ?? 'auth_token']: token };
}

async function slugsFor(cookies?: Record<string, string>): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: '/api/tournaments?pageSize=100', ...(cookies ? { cookies } : {}) });
  expect(res.statusCode).toBe(200);
  return (res.json().data as Array<{ slug: string }>).map((t) => t.slug);
}

beforeAll(async () => {
  host = await createTestUser({ username: 'DraftHost' });
  other = await createTestUser({ username: 'DraftOther' });
  userIds.push(host.id, other.id);

  const mk = async (status: 'DRAFT' | 'OPEN_REGISTRATION') => {
    const id = randomUUID();
    const slug = `vis-${status.toLowerCase()}-${id.slice(0, 8)}`;
    tournamentIds.push(id);
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: `Visibility ${status}`,
        host_id: host.id,
        format: 'SWISS',
        status,
        visibility: 'PUBLIC',
        start_date: new Date('2027-01-01'), // future → sorts to the top of the list
        timezone: 'Europe/Berlin',
      },
    });
    return slug;
  };
  draftSlug = await mk('DRAFT');
  publishedSlug = await mk('OPEN_REGISTRATION');
});

afterAll(async () => {
  for (const id of tournamentIds) await cleanupTournament(id);
  await cleanupUsers(userIds);
});

describe('GET /api/tournaments — draft visibility', () => {
  it('hides drafts from anonymous viewers, shows published', async () => {
    const slugs = await slugsFor();
    expect(slugs).toContain(publishedSlug);
    expect(slugs).not.toContain(draftSlug);
  });

  it('shows a host their own draft', async () => {
    const slugs = await slugsFor(cookieFor(host.id));
    expect(slugs).toContain(draftSlug);
    expect(slugs).toContain(publishedSlug);
  });

  it('hides the draft from an unrelated signed-in user', async () => {
    const slugs = await slugsFor(cookieFor(other.id));
    expect(slugs).not.toContain(draftSlug);
    expect(slugs).toContain(publishedSlug);
  });

  it('shows all drafts to staff (admin)', async () => {
    const slugs = await slugsFor(cookieFor(other.id, 'ADMIN'));
    expect(slugs).toContain(draftSlug);
  });
});
