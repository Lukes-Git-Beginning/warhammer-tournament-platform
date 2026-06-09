/**
 * Integration tests for Admin routes (M5.4.1).
 *
 * Covers: audit-log pagination, stats KPIs, ban/unban flows,
 * auth-matrix (no auth → 401, USER → 403, ADMIN → 200).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

const ADMIN_ID  = 'ad000000-0000-0000-0000-000000000001';
const USER_ID   = 'ad000000-0000-0000-0000-000000000002';
const TARGET_ID = 'ad000000-0000-0000-0000-000000000003'; // user to ban/unban

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
// Cleanup + seed
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Cleanup in FK-safe order
  await prisma.auditLog.deleteMany({
    where: { actor_id: { in: [ADMIN_ID, USER_ID] } },
  });
  await prisma.auditLog.deleteMany({
    where: { entity_id: { in: [ADMIN_ID, USER_ID, TARGET_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ID, USER_ID, TARGET_ID] } },
  });
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID,  discord_id: 'adm_admin',  username: 'AdminUser',  email: null, role: 'ADMIN' },
      { id: USER_ID,   discord_id: 'adm_user',   username: 'NormalUser', email: null, role: 'USER' },
      { id: TARGET_ID, discord_id: 'adm_target', username: 'TargetUser', email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({
    where: { actor_id: { in: [ADMIN_ID, USER_ID] } },
  });
  await prisma.auditLog.deleteMany({
    where: { entity_id: { in: [ADMIN_ID, USER_ID, TARGET_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ID, USER_ID, TARGET_ID] } },
  });
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

// ---------------------------------------------------------------------------
// GET /api/admin/audit-log
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log', () => {
  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-log' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for USER role', async () => {
    const token = makeToken(USER_ID, 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-log',
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with paginated audit log for ADMIN', async () => {
    // Seed two audit log entries
    await prisma.auditLog.createMany({
      data: [
        { entity_type: 'User', entity_id: TARGET_ID, action: 'BAN',   actor_id: ADMIN_ID },
        { entity_type: 'User', entity_id: TARGET_ID, action: 'UNBAN', actor_id: ADMIN_ID },
      ],
    });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-log?page=1&pageSize=10',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      entries: Array<{ id: string; entity_type: string; action: string; actor: { id: string } | null }>;
      total: number;
      page: number;
      pageSize: number;
    }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    // entries include actor relation
    const withActor = body.entries.filter((e) => e.actor !== null);
    expect(withActor.length).toBeGreaterThan(0);
    expect(withActor[0].actor!.id).toBe(ADMIN_ID);
  });

  it('filters by entity_type query param', async () => {
    await prisma.auditLog.createMany({
      data: [
        { entity_type: 'User',       entity_id: TARGET_ID, action: 'BAN',    actor_id: ADMIN_ID },
        { entity_type: 'Tournament', entity_id: TARGET_ID, action: 'CREATE', actor_id: ADMIN_ID },
      ],
    });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-log?entity_type=Tournament',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<{ entity_type: string }> }>();
    expect(body.entries.every((e) => e.entity_type === 'Tournament')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------

describe('GET /api/admin/stats', () => {
  it('returns 200 with expected KPI fields for ADMIN', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      users: { active: number };
      tournaments: { total: number; active: number; completed: number };
      matches: { total: number };
      top_factions: unknown[];
      season: unknown;
    }>();
    expect(typeof body.users.active).toBe('number');
    expect(typeof body.tournaments.total).toBe('number');
    expect(typeof body.tournaments.active).toBe('number');
    expect(typeof body.tournaments.completed).toBe('number');
    expect(typeof body.matches.total).toBe('number');
    expect(Array.isArray(body.top_factions)).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/ban
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/ban', () => {
  it('bans user — sets deleted_at and creates AuditLog entry', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${TARGET_ID}/ban`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; username: string; deleted_at: string }>();
    expect(body.id).toBe(TARGET_ID);
    expect(body.deleted_at).toBeTruthy();

    // DB: deleted_at is set
    const dbUser = await prisma.user.findUnique({ where: { id: TARGET_ID } });
    expect(dbUser?.deleted_at).not.toBeNull();

    // AuditLog: BAN action recorded
    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'User', entity_id: TARGET_ID, action: 'BAN' },
    });
    expect(log).not.toBeNull();
    expect(log?.actor_id).toBe(ADMIN_ID);
  });

  it('returns 409 when user is already banned', async () => {
    // Pre-ban
    await prisma.user.update({
      where: { id: TARGET_ID },
      data: { deleted_at: new Date() },
    });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${TARGET_ID}/ban`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('Conflict');
  });

  it('returns 404 for non-existent user', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/ffffffff-ffff-ffff-ffff-ffffffffffff/ban',
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NotFound');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id/ban (unban)
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id/ban', () => {
  it('unbans user — clears deleted_at and creates AuditLog entry', async () => {
    // Pre-ban the target
    await prisma.user.update({
      where: { id: TARGET_ID },
      data: { deleted_at: new Date() },
    });

    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${TARGET_ID}/ban`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; username: string }>();
    expect(body.id).toBe(TARGET_ID);

    // DB: deleted_at cleared
    const dbUser = await prisma.user.findUnique({ where: { id: TARGET_ID } });
    expect(dbUser?.deleted_at).toBeNull();

    // AuditLog: UNBAN action recorded
    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'User', entity_id: TARGET_ID, action: 'UNBAN' },
    });
    expect(log).not.toBeNull();
    expect(log?.actor_id).toBe(ADMIN_ID);
  });

  it('returns 409 when trying to unban a non-banned user', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${TARGET_ID}/ban`,
      cookies: { auth_token: token },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('Conflict');
  });
});
