/**
 * Integration tests for auto-configured formats at tournament creation.
 *
 * AUTO_SWISS and BALANCED_LIECHTENSTEIN both derive their round count + playoff
 * size from the check-in count at start (autoSwissConfig / applyBalancedStartConfig)
 * and run BO1, so the create route must ignore/force these fields regardless of what
 * the client sends. SWISS keeps whatever the host configured — the guard is
 * auto-format-specific, not a blanket override.
 *
 * Requires PostgreSQL with the balanced schema (BALANCED_LIECHTENSTEIN enum value).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = 'ba1a0000-0000-0000-0000-000000000001';

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

async function cleanupAll() {
  await prisma.tournament.deleteMany({ where: { host_id: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
}

beforeEach(async () => {
  await cleanupAll();
  await prisma.user.create({
    data: { id: ADMIN_ID, discord_id: 'ba1a_admin', username: 'BalancedAdmin', email: null, role: 'ADMIN' },
  });
});

afterEach(async () => {
  await cleanupAll();
});

function makeToken(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

/** Payload that tries to force rounds/playoff/match-format values. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Auto-config Test',
    start_date: '2026-08-01T10:00:00.000Z',
    timezone: 'Europe/Berlin',
    rounds_count: 6,
    playoff_format: 'TOP8',
    swiss_match_format: 'BO3',
    playoff_match_format: 'BO3',
    finale_match_format: 'BO3',
    ...overrides,
  };
}

async function createAndFetch(overrides: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tournaments',
    cookies: { auth_token: makeToken(ADMIN_ID, 'ADMIN') },
    payload: body(overrides),
  });
  expect(res.statusCode).toBe(201);
  const { id } = res.json<{ id: string }>();
  return prisma.tournament.findUniqueOrThrow({
    where: { id },
    select: {
      rounds_count: true,
      playoff_format: true,
      swiss_match_format: true,
      playoff_match_format: true,
      finale_match_format: true,
    },
  });
}

describe('POST /api/tournaments — auto-configured formats ignore manual round/playoff/format', () => {
  it('BALANCED_LIECHTENSTEIN auto-sizes the round count but keeps the host playoff size + match format', async () => {
    const t = await createAndFetch({ format: 'BALANCED_LIECHTENSTEIN' });
    // Auto-sizing defaults ON for Balanced → the round count is derived from check-in at
    // start, so the sent 6 is dropped to the DB default here. The playoff SIZE is a host
    // choice (division formation) and is stored verbatim — the sent TOP8 survives.
    expect(t.rounds_count).toBe(5);
    expect(t.playoff_format).toBe('TOP8');
    // Match format is host-configurable for Balanced (unlike Auto Swiss's BO1).
    expect(t.swiss_match_format).toBe('BO3');
    expect(t.playoff_match_format).toBe('BO3');
    expect(t.finale_match_format).toBe('BO3');
  });

  it('BALANCED_LIECHTENSTEIN with auto_sizing off keeps the host round count + playoff size', async () => {
    const t = await createAndFetch({ format: 'BALANCED_LIECHTENSTEIN', auto_sizing: false });
    // Fixed-round Balanced: the host's round count survives (start won't override).
    expect(t.rounds_count).toBe(6);
    // The playoff size is the host's choice (division formation), stored verbatim.
    expect(t.playoff_format).toBe('TOP8');
    expect(t.swiss_match_format).toBe('BO3');
  });

  it('AUTO_SWISS behaves identically (parity guard)', async () => {
    const t = await createAndFetch({ format: 'AUTO_SWISS' });
    expect(t.rounds_count).toBe(5);
    expect(t.playoff_format).toBe('NONE');
    expect(t.swiss_match_format).toBe('BO1');
    expect(t.playoff_match_format).toBe('BO1');
    expect(t.finale_match_format).toBe('BO1');
  });

  it('SWISS keeps the host-configured rounds/playoff/format (override is auto-format-specific)', async () => {
    const t = await createAndFetch({ format: 'SWISS' });
    expect(t.rounds_count).toBe(6);
    expect(t.playoff_format).toBe('TOP8');
    expect(t.swiss_match_format).toBe('BO3');
    expect(t.playoff_match_format).toBe('BO3');
    expect(t.finale_match_format).toBe('BO3');
  });
});
