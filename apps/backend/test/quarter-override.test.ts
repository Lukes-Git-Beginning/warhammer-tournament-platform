/**
 * Admin quarter overrides: the pure resolution (custom name / shifted boundaries over the calendar
 * default) and the GET/PATCH endpoints (admin-gated).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { resolveQuarter } from '../src/lib/competition.js';

// ── Pure resolution ────────────────────────────────────────────────────────
describe('resolveQuarter — calendar default + overrides', () => {
  it('no override → the calendar quarter', () => {
    const q = resolveQuarter('2026-Q4', new Map());
    expect(q?.label).toBe('Q4 2026');
    expect(q?.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(q?.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('custom name only shifts the label, not the boundaries', () => {
    const q = resolveQuarter('2026-Q4', new Map([['2026-Q4', { name: 'Winter Clash', start_date: null, end_date: null }]]));
    expect(q?.label).toBe('Winter Clash');
    expect(q?.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('boundary override shifts the window, keeps the default label', () => {
    const start = new Date('2026-10-05T00:00:00.000Z');
    const q = resolveQuarter('2026-Q4', new Map([['2026-Q4', { name: null, start_date: start, end_date: null }]]));
    expect(q?.label).toBe('Q4 2026');
    expect(q?.from.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(q?.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('invalid period → null', () => {
    expect(resolveQuarter('not-a-quarter', new Map())).toBeNull();
  });
});

// ── Endpoints ────────────────────────────────────────────────────────────────
const ADMIN_ID = 'c1e70000-0000-0000-0000-000000000001';
const USER_ID = 'c1e70000-0000-0000-0000-000000000002';
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
async function cleanup() {
  await prisma.quarterConfig.deleteMany({ where: { period: '2026-Q4' } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
}
beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'q_admin', username: 'QAdmin', email: null, role: 'ADMIN' },
      { id: USER_ID, discord_id: 'q_user', username: 'QUser', email: null, role: 'USER' },
    ],
  });
});
afterEach(cleanup);
function token(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

describe('quarter admin endpoints', () => {
  it('rejects a non-admin override', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quarters/2026-Q4',
      cookies: { auth_token: token(USER_ID, 'USER') },
      payload: { name: 'Winter Clash' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an invalid period', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quarters/2026-Q9',
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('admin sets a name + boundary override, GET reflects it', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/quarters/2026-Q4',
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
      payload: { name: 'Winter Clash', start_date: '2026-10-05T00:00:00.000Z' },
    });
    expect(patch.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/quarters' });
    expect(list.statusCode).toBe(200);
    const body = list.json<{ data: Array<{ period: string; label: string; from: string; override: unknown }> }>();
    const q4 = body.data.find((q) => q.period === '2026-Q4')!;
    expect(q4.label).toBe('Winter Clash');
    expect(new Date(q4.from).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(q4.override).not.toBeNull();
  });

  it('rejects end_date on or before start_date', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quarters/2026-Q4',
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
      payload: { start_date: '2026-11-01T00:00:00.000Z', end_date: '2026-10-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
  });
});
