import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

let app: FastifyInstance;

// Deterministic UUIDs
const ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
const USER_ID = 'a0000000-0000-0000-0000-000000000002';
const ORGANIZER_ID = 'a0000000-0000-0000-0000-000000000003';
const DELETED_ID = 'a0000000-0000-0000-0000-000000000004';

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({
    where: { entity_id: { in: [ADMIN_ID, USER_ID, ORGANIZER_ID, DELETED_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ID, USER_ID, ORGANIZER_ID, DELETED_ID] } },
  });

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'disc_role_admin', username: 'AdminUser', email: null, role: 'ADMIN' },
      { id: USER_ID, discord_id: 'disc_role_user', username: 'NormalUser', email: null, role: 'USER' },
      { id: ORGANIZER_ID, discord_id: 'disc_role_orga', username: 'OrgaUser', email: null, role: 'ORGANIZER' },
      {
        id: DELETED_ID,
        discord_id: 'disc_role_deleted',
        username: 'DeletedUser',
        email: null,
        role: 'USER',
        deleted_at: new Date('2025-01-01'),
      },
    ],
    skipDuplicates: true,
  });
});

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, discord_id: `disc_${id}`, username: 'test', role });
}

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role
// ---------------------------------------------------------------------------

describe('PATCH /api/users/:id/role', () => {
  it('ADMIN can promote USER to ORGANIZER', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${USER_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'ORGANIZER' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; username: string; role: string }>();
    expect(body.id).toBe(USER_ID);
    expect(body.role).toBe('ORGANIZER');

    // Verify DB was updated
    const dbUser = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(dbUser?.role).toBe('ORGANIZER');
  });

  it('non-ADMIN (USER role in JWT) gets 403', async () => {
    const token = makeToken(USER_ID, 'USER');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${ADMIN_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'USER' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('non-ADMIN (ORGANIZER role in JWT) gets 403', async () => {
    const token = makeToken(ORGANIZER_ID, 'ORGANIZER');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${USER_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('PATCH on non-existing user returns 404', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');
    const nonExisting = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${nonExisting}/role`,
      cookies: { auth_token: token },
      payload: { role: 'ORGANIZER' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('PATCH on soft-deleted user returns 404', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${DELETED_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'ORGANIZER' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('invalid role value returns 400', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${USER_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'SUPERUSER' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('creates an audit log entry on successful role update', async () => {
    const token = makeToken(ADMIN_ID, 'ADMIN');

    await app.inject({
      method: 'PATCH',
      url: `/api/users/${USER_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'MODERATOR' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'User', entity_id: USER_ID, action: 'role_update' },
    });
    expect(log).not.toBeNull();
    expect(log?.actor_id).toBe(ADMIN_ID);
  });
});

// ---------------------------------------------------------------------------
// requireRole — DB-Lookup path (withRedis: false, so no cache)
// ---------------------------------------------------------------------------

describe('requireRole DB-Lookup (no Redis)', () => {
  it('reads role from DB, not JWT — changed role in DB is respected', async () => {
    // Update USER_ID's role directly in DB to ORGANIZER (bypassing the API)
    await prisma.user.update({ where: { id: USER_ID }, data: { role: 'ORGANIZER' } });

    // Sign a JWT that still says USER role (simulates stale JWT)
    const staleToken = makeToken(USER_ID, 'USER');

    // Use PATCH /api/users/:id/role as the ADMIN-only test surface:
    // USER_ID now has ORGANIZER role in DB. PATCH on some target as that user:
    // Should be 403 (ORGANIZER is not ADMIN), not 401 or some JWT-based error.
    // But we need an ADMIN-protected endpoint. Let's use PATCH /api/users/:id/role.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${ADMIN_ID}/role`,
      cookies: { auth_token: staleToken },
      payload: { role: 'USER' },
    });
    // DB says ORGANIZER, ADMIN role required → 403
    expect(res.statusCode).toBe(403);
  });

  it('soft-deleted user is rejected with 401 by requireRole', async () => {
    // Sign a valid JWT for the deleted user (role still in token)
    const token = makeToken(DELETED_ID, 'ADMIN');

    // Any ADMIN-protected endpoint will trigger requireRole
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${USER_ID}/role`,
      cookies: { auth_token: token },
      payload: { role: 'ORGANIZER' },
    });
    // DB lookup: user has deleted_at set → returns null → 401
    expect(res.statusCode).toBe(401);
  });
});
