/**
 * Integration tests for Army List upload endpoints (M5.4).
 *
 * Uses raw multipart body construction to avoid external form-data dep.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

const USER_ID  = 'a1000000-0000-0000-0000-000000000001';
const OTHER_ID = 'a1000000-0000-0000-0000-000000000002';
const FACTION_ID = 'empire'; // seeded faction slug

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
// Cleanup + seed
// ---------------------------------------------------------------------------

async function cleanup() {
  await prisma.armyList.deleteMany({
    where: { user_id: { in: [USER_ID, OTHER_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [USER_ID, OTHER_ID] } },
  });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: USER_ID,  discord_id: 'al_user',  username: 'ALUser',  email: null, role: 'USER' },
      { id: OTHER_ID, discord_id: 'al_other', username: 'ALOther', email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });
});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function cookieFor(id: string, role = 'USER') {
  const token = app.jwt.sign({ sub: id, discord_id: `disc_${id}`, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

// ---------------------------------------------------------------------------
// Multipart builder (raw RFC 2046)
// ---------------------------------------------------------------------------

function buildMultipart(
  boundary: string,
  parts: Array<{ name: string; value?: string; filename?: string; content?: Buffer | string; contentType?: string }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename) {
      header += `; filename="${part.filename}"`;
    }
    if (part.contentType) {
      header += `\r\nContent-Type: ${part.contentType}`;
    }
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

// ---------------------------------------------------------------------------
// Test 1: POST without auth → 401
// ---------------------------------------------------------------------------

describe('POST /api/army-lists (unauthenticated)', () => {
  it('returns 401 when no auth cookie is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/army-lists',
      headers: { 'content-type': 'multipart/form-data; boundary=testboundary' },
      payload: Buffer.from(''),
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test 2: POST with TXT file + faction_id → 201 + parsed_data
// ---------------------------------------------------------------------------

describe('POST /api/army-lists (TXT upload)', () => {
  it('returns 201 and parsed_data for a valid TXT army list', async () => {
    const boundary = 'txtboundary123';
    const txtContent = [
      'Land Battle',
      '',
      'Lord: Karl Franz',
      'Hero: Balthasar Gelt',
      '',
      'Units:',
      'Reiksguard',
      'Greatswords',
    ].join('\n');

    const body = buildMultipart(boundary, [
      {
        name: 'file',
        filename: 'my-army.txt',
        content: txtContent,
        contentType: 'text/plain',
      },
      { name: 'faction_id', value: FACTION_ID },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/army-lists',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: cookieFor(USER_ID),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json<{
      id: string;
      file_type: string;
      file_name: string;
      parsed_data: { battle_type?: string; lord?: string } | null;
    }>();
    expect(json.file_type).toBe('TXT');
    expect(json.file_name).toBe('my-army.txt');
    expect(json.parsed_data).not.toBeNull();
    expect(json.parsed_data!.lord).toBe('Karl Franz');
    expect(json.parsed_data!.battle_type).toMatch(/land/i);
  });
});

// ---------------------------------------------------------------------------
// Test 3: POST with PDF magic bytes → 201 + parsed_data: null
// ---------------------------------------------------------------------------

describe('POST /api/army-lists (PDF upload)', () => {
  it('returns 201 with parsed_data null for a PDF file', async () => {
    const boundary = 'pdfboundary456';
    // Minimal PDF: magic bytes + filler
    const pdfContent = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(100, 0x20), // spaces to pass isTxt if misdetected
    ]);

    const body = buildMultipart(boundary, [
      {
        name: 'file',
        filename: 'army.pdf',
        content: pdfContent,
        contentType: 'application/pdf',
      },
      { name: 'faction_id', value: FACTION_ID },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/army-lists',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: cookieFor(USER_ID),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json<{ file_type: string; parsed_data: null }>();
    expect(json.file_type).toBe('PDF');
    expect(json.parsed_data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4: GET /api/army-lists/:id/download for non-owner, non-privileged → 403
// ---------------------------------------------------------------------------

describe('GET /api/army-lists/:id/download (ACL)', () => {
  it('returns 403 for a non-owner USER trying to download another user\'s army list', async () => {
    // Create an army list owned by USER_ID directly in the DB
    const armyList = await prisma.armyList.create({
      data: {
        user_id: USER_ID,
        faction_id: FACTION_ID,
        file_url: '/uploads/army-lists/fake/fake.txt',
        file_name: 'fake.txt',
        file_type: 'TXT',
        parsed_data: null,
      },
    });

    // OTHER_ID (plain USER) tries to download
    const res = await app.inject({
      method: 'GET',
      url: `/api/army-lists/${armyList.id}/download`,
      headers: { cookie: cookieFor(OTHER_ID, 'USER') },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json<{ error: string }>();
    expect(json.error).toBe('Forbidden');
  });
});
