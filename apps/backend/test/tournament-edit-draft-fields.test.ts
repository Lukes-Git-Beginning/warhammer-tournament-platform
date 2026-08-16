/**
 * Regression: editing a non-DRAFT tournament must not fail just because the edit form
 * re-sends the (unchanged) structural fields.
 *
 * A Faction War tournament past DRAFT could not be saved at all: the form re-sent
 * `mode`, and the PATCH endpoint rejected any *present* draft-only field rather than a
 * genuinely *changed* one. The endpoint now compares against the current value.
 *
 * Covers PATCH /api/tournaments/:slug on an OPEN_REGISTRATION tournament:
 *  1. Re-submitting the unchanged mode (+ a description edit) → 200
 *  2. A genuine mode change → 422 (still blocked past DRAFT)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const HOST_ID = '1d000000-0000-0000-0000-000000000001';
const TOURNAMENT_ID = '1d000000-0000-0000-0001-000000000001';
const SLUG = `edit-fw-${TOURNAMENT_ID.slice(-8)}`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: false,
    withCron: false,
    withGraphql: false,
    withDraft: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
  await prisma.user.deleteMany({ where: { id: HOST_ID } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.create({
    data: { id: HOST_ID, discord_id: 'edit_fw_host', username: 'EditFWHost', email: null, role: 'HOST' },
  });
  await prisma.tournament.create({
    data: {
      id: TOURNAMENT_ID,
      slug: SLUG,
      name: 'Sunday Faction War',
      host_id: HOST_ID,
      format: 'SWISS',
      mode: 'FACTION_WAR',
      status: 'OPEN_REGISTRATION',
      start_date: new Date('2026-09-01'),
      timezone: 'Europe/Berlin',
    },
  });
});

afterEach(async () => {
  await cleanup();
});

function cookieFor(id: string, role: string) {
  const token = app.jwt.sign({ sub: id, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

describe('PATCH /api/tournaments/:slug — draft-only fields past DRAFT', () => {
  it('1. re-submitting the unchanged mode (+ a description edit) saves → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${SLUG}`,
      headers: { cookie: cookieFor(HOST_ID, 'HOST') },
      payload: { mode: 'FACTION_WAR', description: 'Updated blurb' },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.tournament.findUnique({
      where: { id: TOURNAMENT_ID },
      select: { mode: true, description: true },
    });
    expect(after?.mode).toBe('FACTION_WAR');
    expect(after?.description).toBe('Updated blurb');
  });

  it('2. a genuine mode change past DRAFT is still rejected → 422', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${SLUG}`,
      headers: { cookie: cookieFor(HOST_ID, 'HOST') },
      payload: { mode: 'BPT' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('mode');
  });
});
