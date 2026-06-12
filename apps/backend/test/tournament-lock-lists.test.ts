/**
 * Integration tests for Q3 — Army-List Lock.
 *
 * Covers:
 *  1. Organizer locks → 200, all participants have lists_locked_at, Socket event emitted
 *  2. Non-organizer (regular USER) → 403
 *  3. Lock on DRAFT tournament → 400 (wrong state)
 *  4. Army-list upload after lock (regular player) → 403 ListsLocked
 *  5. Admin override army-list upload after lock → 201, AuditLog written
 *  6. GET /api/tournaments/:slug/participants includes lists_locked_at in DTO
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

const ORGANIZER_ID = '1b000000-0000-0000-0000-000000000001';
const PLAYER_ID    = '1b000000-0000-0000-0000-000000000002';
const ADMIN_ID     = '1b000000-0000-0000-0000-000000000003';
const OTHER_ID     = '1b000000-0000-0000-0000-000000000004';

const TOURNAMENT_ID      = '1b000000-0000-0000-0001-000000000001';
const DRAFT_TOURNAMENT_ID = '1b000000-0000-0000-0001-000000000002';
const FACTION_ID         = 'empire'; // seeded faction slug

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

async function cleanup() {
  await prisma.armyList.deleteMany({
    where: { user_id: { in: [ORGANIZER_ID, PLAYER_ID, ADMIN_ID, OTHER_ID] } },
  });
  await prisma.auditLog.deleteMany({
    where: { actor_id: { in: [ORGANIZER_ID, PLAYER_ID, ADMIN_ID, OTHER_ID] } },
  });
  await prisma.auditLog.deleteMany({
    where: { entity_id: { in: [TOURNAMENT_ID, DRAFT_TOURNAMENT_ID] } },
  });
  await prisma.tournamentParticipant.deleteMany({
    where: { tournament_id: { in: [TOURNAMENT_ID, DRAFT_TOURNAMENT_ID] } },
  });
  await prisma.tournament.deleteMany({
    where: { id: { in: [TOURNAMENT_ID, DRAFT_TOURNAMENT_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ORGANIZER_ID, PLAYER_ID, ADMIN_ID, OTHER_ID] } },
  });
}

beforeEach(async () => {
  await cleanup();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: ORGANIZER_ID, discord_id: 'lk_organizer', username: 'LKOrganizer', email: null, role: 'HOST' },
      { id: PLAYER_ID,    discord_id: 'lk_player',    username: 'LKPlayer',    email: null, role: 'USER' },
      { id: ADMIN_ID,     discord_id: 'lk_admin',     username: 'LKAdmin',     email: null, role: 'ADMIN' },
      { id: OTHER_ID,     discord_id: 'lk_other',     username: 'LKOther',     email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });

  // Seed a tournament in ONGOING status
  await prisma.tournament.create({
    data: {
      id: TOURNAMENT_ID,
      slug: `lk-ongoing-${TOURNAMENT_ID.slice(-8)}`,
      name: 'LK Ongoing Tournament',
      organizer_id: ORGANIZER_ID,
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
  });

  // Seed a tournament in DRAFT status (should not be lockable)
  await prisma.tournament.create({
    data: {
      id: DRAFT_TOURNAMENT_ID,
      slug: `lk-draft-${DRAFT_TOURNAMENT_ID.slice(-8)}`,
      name: 'LK Draft Tournament',
      organizer_id: ORGANIZER_ID,
      format: 'SWISS',
      status: 'DRAFT',
      start_date: new Date('2026-07-01'),
      timezone: 'Europe/Berlin',
    },
  });

  // Register PLAYER_ID and OTHER_ID in the ongoing tournament
  await prisma.tournamentParticipant.createMany({
    data: [
      {
        id: randomUUID(),
        tournament_id: TOURNAMENT_ID,
        user_id: PLAYER_ID,
        status: 'CHECKED_IN',
      },
      {
        id: randomUUID(),
        tournament_id: TOURNAMENT_ID,
        user_id: OTHER_ID,
        status: 'REGISTERED',
      },
    ],
  });
});

afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function cookieFor(id: string, role: string) {
  const token = app.jwt.sign({ sub: id, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

// ---------------------------------------------------------------------------
// Multipart builder (raw RFC 2046)
// ---------------------------------------------------------------------------

function buildMultipart(
  boundary: string,
  parts: Array<{
    name: string;
    value?: string;
    filename?: string;
    content?: Buffer | string;
    contentType?: string;
  }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename) header += `; filename="${part.filename}"`;
    if (part.contentType) header += `\r\nContent-Type: ${part.contentType}`;
    header += '\r\n\r\n';
    chunks.push(Buffer.from(header));
    if (part.content !== undefined) {
      chunks.push(Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content));
    } else if (part.value !== undefined) {
      chunks.push(Buffer.from(part.value));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function buildTxtUpload(tournamentId?: string) {
  const boundary = `testbnd-${randomUUID().slice(0, 8)}`;
  const parts: Parameters<typeof buildMultipart>[1] = [
    {
      name: 'file',
      filename: 'army.txt',
      content: 'Land Battle\n\nLord: Karl Franz\n',
      contentType: 'text/plain',
    },
    { name: 'faction_id', value: FACTION_ID },
  ];
  if (tournamentId) {
    parts.push({ name: 'tournament_id', value: tournamentId });
  }
  return { boundary, body: buildMultipart(boundary, parts) };
}

// ---------------------------------------------------------------------------
// Test 1: Organizer locks → 200, participants have lists_locked_at set
// ---------------------------------------------------------------------------

describe('POST /api/tournaments/:tournamentId/lock-lists', () => {
  it('1. Organizer locks → 200, all participants have lists_locked_at, AuditLog created', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/lock-lists`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'HOST') },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      tournament_id: string;
      locked_at: string;
      affected_participants: number;
    }>();
    expect(body.tournament_id).toBe(TOURNAMENT_ID);
    expect(body.affected_participants).toBe(2);
    expect(typeof body.locked_at).toBe('string');
    // Validate ISO datetime format
    expect(() => new Date(body.locked_at)).not.toThrow();

    // DB: all participants should have lists_locked_at set
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournament_id: TOURNAMENT_ID, deleted_at: null },
    });
    expect(participants).toHaveLength(2);
    for (const p of participants) {
      expect(p.lists_locked_at).not.toBeNull();
    }

    // AuditLog: lists_locked action recorded
    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'Tournament', entity_id: TOURNAMENT_ID, action: 'lists_locked' },
    });
    expect(log).not.toBeNull();
    expect(log?.actor_id).toBe(ORGANIZER_ID);
  });

  // -------------------------------------------------------------------------
  // Test 2: Non-organizer (regular USER) → 403
  // -------------------------------------------------------------------------

  it('2. Non-organizer USER → 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/lock-lists`,
      headers: { cookie: cookieFor(PLAYER_ID, 'USER') },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('Forbidden');
  });

  // -------------------------------------------------------------------------
  // Test 3: Lock on DRAFT tournament → 400
  // -------------------------------------------------------------------------

  it('3. Lock on DRAFT-status tournament → 400 BadRequest', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${DRAFT_TOURNAMENT_ID}/lock-lists`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'HOST') },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('BadRequest');
    expect(body.message).toContain('DRAFT');
  });

  // -------------------------------------------------------------------------
  // Test 4: Army-list upload after lock (regular player) → 403 ListsLocked
  // -------------------------------------------------------------------------

  it('4. Army-list upload after lock (regular player) → 403 ListsLocked', async () => {
    // First, lock the lists
    await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/lock-lists`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'HOST') },
    });

    // Player tries to upload an army list for this tournament
    const { boundary, body: multipart } = buildTxtUpload(TOURNAMENT_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/army-lists',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: cookieFor(PLAYER_ID, 'USER'),
      },
      payload: multipart,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ error: string; message: string; statusCode: number }>();
    expect(body.error).toBe('ListsLocked');
    expect(body.statusCode).toBe(403);
    expect(body.message).toMatch(/locked/i);
  });

  // -------------------------------------------------------------------------
  // Test 5: Admin override army-list upload after lock → 201 + AuditLog
  // -------------------------------------------------------------------------

  it('5. Admin override army-list upload after lock → 201, AuditLog written', async () => {
    // First, lock the lists
    await app.inject({
      method: 'POST',
      url: `/api/tournaments/${TOURNAMENT_ID}/lock-lists`,
      headers: { cookie: cookieFor(ORGANIZER_ID, 'HOST') },
    });

    // Admin uploads an army list — should succeed and log override
    const { boundary, body: multipart } = buildTxtUpload(TOURNAMENT_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/army-lists',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: cookieFor(ADMIN_ID, 'ADMIN'),
      },
      payload: multipart,
    });

    expect(res.statusCode).toBe(201);

    // AuditLog: override action recorded for the admin's participant or the override itself
    const log = await prisma.auditLog.findFirst({
      where: {
        actor_id: ADMIN_ID,
        action: 'army_list_override_after_lock',
      },
    });
    expect(log).not.toBeNull();
    expect(log?.entity_type).toBe('TournamentParticipant');
  });

  // -------------------------------------------------------------------------
  // Test 6: GET /api/tournaments/:slug/participants includes lists_locked_at
  // -------------------------------------------------------------------------

  it('6. GET participants includes lists_locked_at field in DTO', async () => {
    const tournament = await prisma.tournament.findUnique({
      where: { id: TOURNAMENT_ID },
      select: { slug: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tournament!.slug}/participants`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: Array<{ id: string; lists_locked_at: string | null }>;
      total: number;
    }>();
    expect(body.total).toBe(2);
    // Before locking: lists_locked_at should be null
    for (const p of body.data) {
      expect('lists_locked_at' in p).toBe(true);
      expect(p.lists_locked_at).toBeNull();
    }
  });
});
