/**
 * Token-authed ops endpoint that re-sends bot DMs which failed with a Discord 429 (DM 429 fix,
 * 2026-09-30). Here we cover the auth guard; the functional dry-run is verified against real data
 * (send defaults to false, so a dry run is safe) before any actual send.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /api/ops/resend-failed-dms — auth', () => {
  it('rejects a request with no push token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ops/resend-failed-dms',
      payload: { marker: 'Wednesday Wars' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a request with a wrong push token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ops/resend-failed-dms',
      headers: { 'x-push-token': 'definitely-not-the-token' },
      payload: { marker: 'Wednesday Wars' },
    });
    expect(res.statusCode).toBe(401);
  });
});
