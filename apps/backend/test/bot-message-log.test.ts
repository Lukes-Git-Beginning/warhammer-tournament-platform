/**
 * Integration tests for the admin bot-message log endpoint.
 *
 * Verifies:
 *  - Inserting BotMessage rows and querying via GET /api/admin/bot-messages returns them.
 *  - The endpoint enriches DM rows with recipient_username (from site User).
 *  - Filter params (status, q, target_id) narrow the result set correctly.
 *  - Auth matrix: no-token → 401, USER role → 403, ADMIN → 200.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Deterministic test IDs
// ---------------------------------------------------------------------------

const ADMIN_ID = 'b0000000-0000-0000-0000-000000000001';
const USER_ID  = 'b0000000-0000-0000-0000-000000000002';

// Discord ids used for bot-message target_id enrichment test.
const DISCORD_ID_KNOWN   = 'disc-known-bm-test';
const DISCORD_ID_UNKNOWN = 'disc-unknown-bm-test';

const createdMessageIds: string[] = [];
const createdUserIds: string[] = [ADMIN_ID, USER_ID];

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false });
  await app.ready();

  // Seed users
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: DISCORD_ID_KNOWN, username: 'BmAdminUser', email: null, role: 'ADMIN' },
      { id: USER_ID,  discord_id: 'disc-bm-user',   username: 'BmNormalUser', email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  if (createdMessageIds.length > 0) {
    await prisma.botMessage.deleteMany({ where: { id: { in: createdMessageIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

async function seedMessage(overrides: {
  target_type?: 'DM' | 'CHANNEL';
  target_id?: string;
  kind?: string;
  content?: string;
  status?: 'SENT' | 'FAILED' | 'SKIPPED';
  detail?: string;
}): Promise<string> {
  const id = randomUUID();
  await prisma.botMessage.create({
    data: {
      id,
      target_type: overrides.target_type ?? 'DM',
      target_id: overrides.target_id ?? DISCORD_ID_KNOWN,
      kind: overrides.kind ?? null,
      content: overrides.content ?? 'Test message content',
      status: overrides.status ?? 'SENT',
      detail: overrides.detail ?? null,
    },
  });
  createdMessageIds.push(id);
  return id;
}

// ---------------------------------------------------------------------------
// Auth matrix
// ---------------------------------------------------------------------------

describe('GET /api/admin/bot-messages — auth', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/bot-messages' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for USER role', async () => {
    const token = makeToken(USER_ID, 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bot-messages',
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Core list behaviour
// ---------------------------------------------------------------------------

describe('GET /api/admin/bot-messages — list', () => {
  it('returns seeded rows with correct envelope shape', async () => {
    await seedMessage({ content: 'Hello from the bot', target_id: DISCORD_ID_KNOWN });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bot-messages?page=1&limit=10',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: Array<{
        id: string;
        target_type: string;
        target_id: string;
        recipient_username: string | null;
        kind: string | null;
        content: string;
        status: string;
        detail: string | null;
        created_at: string;
      }>;
      total: number;
      page: number;
      limit: number;
    }>();

    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.data)).toBe(true);

    // At least the row we just seeded must appear.
    const seeded = body.data.find((r) => r.content === 'Hello from the bot');
    expect(seeded).toBeDefined();
    expect(seeded?.target_type).toBe('DM');
    expect(seeded?.status).toBe('SENT');
  });

  it('enriches DM rows with recipient_username when the discord_id is known', async () => {
    await seedMessage({ target_type: 'DM', target_id: DISCORD_ID_KNOWN, content: 'Enrichment check' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/bot-messages?target_id=${DISCORD_ID_KNOWN}&limit=10`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ recipient_username: string | null; target_type: string }> }>();
    const dmRows = body.data.filter((r) => r.target_type === 'DM');
    expect(dmRows.length).toBeGreaterThan(0);
    // The admin user has DISCORD_ID_KNOWN as their discord_id — username should be enriched.
    expect(dmRows[0]?.recipient_username).toBe('BmAdminUser');
  });

  it('sets recipient_username to null for unknown DM discord ids', async () => {
    await seedMessage({ target_type: 'DM', target_id: DISCORD_ID_UNKNOWN, content: 'Unknown recipient' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/bot-messages?target_id=${DISCORD_ID_UNKNOWN}&limit=5`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ recipient_username: string | null }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.recipient_username).toBeNull();
  });

  it('sets recipient_username to null for CHANNEL rows', async () => {
    await seedMessage({ target_type: 'CHANNEL', target_id: 'chan-12345', content: 'Channel message' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/bot-messages?target_id=chan-12345&limit=5`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ recipient_username: string | null; target_type: string }> }>();
    const channelRows = body.data.filter((r) => r.target_type === 'CHANNEL');
    expect(channelRows.length).toBeGreaterThan(0);
    expect(channelRows[0]?.recipient_username).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe('GET /api/admin/bot-messages — filters', () => {
  it('filters by status=FAILED', async () => {
    await seedMessage({ status: 'FAILED', detail: 'http_403', content: 'Failed message filter test' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bot-messages?status=FAILED&limit=100',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ status: string }> }>();
    expect(body.data.every((r) => r.status === 'FAILED')).toBe(true);
  });

  it('filters by q (content substring, case-insensitive)', async () => {
    const unique = `unique-content-${randomUUID().slice(0, 8)}`;
    await seedMessage({ content: `The ${unique} marker` });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/bot-messages?q=${encodeURIComponent(unique)}&limit=10`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ content: string }>; total: number }>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.every((r) => r.content.toLowerCase().includes(unique.toLowerCase()))).toBe(true);
  });

  it('returns 400 on invalid status value', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bot-messages?status=INVALID',
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(400);
  });
});
