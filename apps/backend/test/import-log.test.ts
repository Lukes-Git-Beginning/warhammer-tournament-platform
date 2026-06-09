/**
 * Integration tests for GET /api/admin/import-log.
 *
 * Auth: ADMIN scope-wide (same as all /api/admin/* routes).
 * Covers:
 *  1. 401 without auth token
 *  2. 403 with USER token (non-admin)
 *  3. 200 with ADMIN token — paginated response shape { entries, total, page, pageSize }
 *  4. ?source=... filter narrows entries correctly
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Deterministic IDs — no collision with other test files
// ---------------------------------------------------------------------------

const ADMIN_ID = 'ab000000-0000-0000-0000-000000000031';
const USER_ID  = 'ab000000-0000-0000-0000-000000000032';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Per-test state — track created ImportLog IDs for scoped cleanup
// ---------------------------------------------------------------------------

let importLogIds: string[];

beforeEach(async () => {
  importLogIds = [];

  // Clean up then seed test users
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'imlog_admin', username: 'ImportLogAdmin', email: null, role: 'ADMIN' },
      { id: USER_ID,  discord_id: 'imlog_user',  username: 'ImportLogUser',  email: null, role: 'USER'  },
    ],
    skipDuplicates: true,
  });
});

afterEach(async () => {
  // Clean up ImportLog rows created during this test
  if (importLogIds.length > 0) {
    await prisma.importLog.deleteMany({ where: { id: { in: importLogIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string): string {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

async function createImportLog(opts: {
  source?: string;
  status?: string;
  records_imported?: number;
  error_message?: string | null;
}): Promise<string> {
  const id = randomUUID();
  importLogIds.push(id);

  await prisma.importLog.create({
    data: {
      id,
      source: opts.source ?? 'test_source',
      status: opts.status ?? 'success',
      records_imported: opts.records_imported ?? 0,
      error_message: opts.error_message ?? null,
      started_at: new Date(),
      finished_at: new Date(),
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/import-log', () => {
  it('1. 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/import-log',
    });
    expect(res.statusCode).toBe(401);
  });

  it('2. 403 with USER token (non-admin)', async () => {
    const token = makeToken(USER_ID, 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/import-log',
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('3. 200 with ADMIN token — response shape and includes created rows', async () => {
    const id1 = await createImportLog({ source: 'totaltavern_factions', status: 'success', records_imported: 42 });
    const id2 = await createImportLog({ source: 'totaltavern_tournament', status: 'error', error_message: 'timeout' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/import-log?page=1&pageSize=50',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      entries: Array<{
        id: string;
        source: string;
        status: string;
        records_imported: number;
        error_message: string | null;
        started_at: string;
        finished_at: string | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>();

    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);

    const ids = body.entries.map((e) => e.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);

    // Verify shape of an entry
    const entry1 = body.entries.find((e) => e.id === id1)!;
    expect(entry1).toBeDefined();
    expect(entry1.source).toBe('totaltavern_factions');
    expect(entry1.status).toBe('success');
    expect(entry1.records_imported).toBe(42);
    expect(entry1.error_message).toBeNull();
    expect(typeof entry1.started_at).toBe('string');
    // started_at must be a valid ISO datetime
    expect(() => new Date(entry1.started_at)).not.toThrow();

    // Entry with error
    const entry2 = body.entries.find((e) => e.id === id2)!;
    expect(entry2).toBeDefined();
    expect(entry2.status).toBe('error');
    expect(entry2.error_message).toBe('timeout');
  });

  it('4. ?source=... filter narrows entries to matching source only', async () => {
    const factionId = await createImportLog({ source: 'totaltavern_factions' });
    const tournamentId = await createImportLog({ source: 'totaltavern_tournament' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/import-log?source=totaltavern_factions',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<{ id: string; source: string }> }>();

    const ids = body.entries.map((e) => e.id);
    expect(ids).toContain(factionId);
    expect(ids).not.toContain(tournamentId);
    expect(body.entries.every((e) => e.source === 'totaltavern_factions')).toBe(true);
  });

  it('5. default pagination values (no query params) — page=1, pageSize=20', async () => {
    await createImportLog({ source: 'default_test' });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/import-log',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ page: number; pageSize: number }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });
});
