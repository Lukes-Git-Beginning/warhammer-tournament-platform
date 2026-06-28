/**
 * Cron check-in transition tests.
 *
 * The cron plugin itself schedules tasks via node-cron, so we test the
 * underlying DB-state transitions that the cron handler executes rather than
 * invoking the cron plugin directly. This mirrors how faction-snapshot.test.ts
 * tests takeFactionsSnapshot() in isolation.
 *
 * We extract the cron's two main DB operations as inline helpers and verify:
 *   (A) Upcoming tournament (start_date = now+30min, status REGISTRATION_CLOSED)
 *       → notifyCheckInReminder is called (Discord mock); AuditLog entry written.
 *   (B) Started tournament (start_date = now−5s, status REGISTRATION_CLOSED)
 *       → status transitions to ONGOING; AuditLog entry written.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import {
  createTestUser,
  cleanupTournament,
  cleanupUsers,
} from './helpers/db-fixtures.js';
import type { TestUser } from './helpers/db-fixtures.js';

// ---------------------------------------------------------------------------
// Mock Discord notify — we don't want real HTTP in unit tests
// ---------------------------------------------------------------------------

vi.mock('../src/lib/discord-notify.js', () => ({
  notifyCheckInReminder: vi.fn().mockResolvedValue(undefined),
  notifyRoundPairings: vi.fn().mockResolvedValue(undefined),
  notifyDispute: vi.fn().mockResolvedValue(undefined),
  notifyTournamentAnnounce: vi.fn().mockResolvedValue(undefined),
}));

import { notifyCheckInReminder } from '../src/lib/discord-notify.js';

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let organizer: TestUser;
/** UUIDs of tournaments created in each test, for cleanupTournament() */
let tournamentIds: string[] = [];
/** Slugs of tournaments created in each test, for AuditLog cleanup (entity_id = slug) */
let tournamentSlugs: string[] = [];

beforeEach(async () => {
  organizer = await createTestUser({ username: 'cron-organizer' });
  tournamentIds = [];
  tournamentSlugs = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  // Clean up AuditLog rows (entity_id is the slug in Tournament audit entries)
  if (tournamentSlugs.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity_type: 'Tournament', entity_id: { in: tournamentSlugs } },
    });
  }
  // Clean up tournament rows (by UUID)
  for (const id of tournamentIds) {
    await cleanupTournament(id);
  }
  await cleanupUsers([organizer.id]);
  tournamentIds = [];
  tournamentSlugs = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers that replicate the cron's DB operations (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * Find REGISTRATION_CLOSED tournaments with start_date in the upcoming window
 * and fire notifyCheckInReminder + create AuditLog (mirrors cron checkin branch).
 *
 * scopeToOrganizerIds limits the query to test-owned tournaments to avoid
 * interference from other tests' fixtures in the shared DB.
 */
async function runCheckinReminderPass(
  now: Date,
  windowMs: number,
  remindedSet: Set<string>,
  scopeToOrganizerIds?: string[],
): Promise<string[]> {
  const windowEnd = new Date(now.getTime() + windowMs);

  const upcoming = await prisma.tournament.findMany({
    where: {
      status: 'REGISTRATION_CLOSED',
      start_date: { gt: now, lte: windowEnd },
      deleted_at: null,
      ...(scopeToOrganizerIds ? { host_id: { in: scopeToOrganizerIds } } : {}),
    },
    select: { id: true, name: true, slug: true, start_date: true },
  });

  const notified: string[] = [];

  for (const t of upcoming) {
    if (!remindedSet.has(t.id)) {
      remindedSet.add(t.id);
      await notifyCheckInReminder(t).catch(() => {});

      await prisma.auditLog
        .create({
          data: {
            entity_type: 'Tournament',
            entity_id: t.slug,
            action: 'checkin_reminder_sent',
            actor_id: null,
            new_value: { sent_at: now.toISOString() },
          },
        })
        .catch(() => {});

      notified.push(t.id);
    }
  }

  return notified;
}

/**
 * Find REGISTRATION_CLOSED tournaments whose start_date has passed and
 * transition them to ONGOING (mirrors cron auto-transition branch).
 *
 * scopeToOrganizerIds limits the query to test-owned tournaments to avoid
 * interference from other tests' fixtures in the shared DB.
 */
async function runAutoTransitionPass(now: Date, scopeToOrganizerIds?: string[]): Promise<string[]> {
  const started = await prisma.tournament.findMany({
    where: {
      status: 'REGISTRATION_CLOSED',
      start_date: { lte: now },
      deleted_at: null,
      ...(scopeToOrganizerIds ? { host_id: { in: scopeToOrganizerIds } } : {}),
    },
    select: { id: true, name: true, slug: true },
  });

  const transitioned: string[] = [];

  for (const t of started) {
    await prisma.tournament
      .update({ where: { id: t.id }, data: { status: 'ONGOING' } })
      .catch(() => {});

    await prisma.auditLog
      .create({
        data: {
          entity_type: 'Tournament',
          entity_id: t.slug,
          action: 'auto_status_transition',
          actor_id: null,
          old_value: { status: 'REGISTRATION_CLOSED' },
          new_value: { status: 'ONGOING' },
        },
      })
      .catch(() => {});

    transitioned.push(t.id);
  }

  return transitioned;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cron: check-in reminder pass', () => {
  it('1. Tournament start_date=now+30min triggers notifyCheckInReminder and AuditLog', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() + 30 * 60 * 1000); // now + 30min

    const id = randomUUID();
    const slug = `cron-test-remind-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Reminder',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'REGISTRATION_CLOSED',
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);
    tournamentSlugs.push(slug);

    const remindedSet = new Set<string>();
    const notified = await runCheckinReminderPass(now, 60 * 60 * 1000 /* 1h */, remindedSet, [organizer.id]);

    expect(notified).toContain(id);
    expect(notifyCheckInReminder).toHaveBeenCalledTimes(1);
    expect(remindedSet.has(id)).toBe(true);

    // AuditLog entry should exist
    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'Tournament', entity_id: slug, action: 'checkin_reminder_sent' },
    });
    expect(log).not.toBeNull();
    expect((log!.new_value as Record<string, unknown>)['sent_at']).toBeTruthy();
  });

  it('2. Tournament start_date=now+2h is outside the 1h window → no reminder', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // now + 2h

    const id = randomUUID();
    const slug = `cron-test-far-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Too Far Away',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'REGISTRATION_CLOSED',
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);

    const remindedSet = new Set<string>();
    const notified = await runCheckinReminderPass(now, 60 * 60 * 1000, remindedSet, [organizer.id]);

    // This tournament should NOT be in the notified list
    expect(notified).not.toContain(id);
    expect(notifyCheckInReminder).not.toHaveBeenCalled();
  });

  it('3. Already-reminded tournament is not reminded again (idempotent)', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() + 30 * 60 * 1000);

    const id = randomUUID();
    const slug = `cron-test-idem-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Idempotent',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'REGISTRATION_CLOSED',
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);

    const remindedSet = new Set<string>([id]); // pre-populated → already reminded
    const notified = await runCheckinReminderPass(now, 60 * 60 * 1000, remindedSet, [organizer.id]);

    expect(notified).toHaveLength(0);
    expect(notifyCheckInReminder).not.toHaveBeenCalled();
  });
});

describe('Cron: auto-transition pass (REGISTRATION_CLOSED → ONGOING)', () => {
  it('4. Tournament start_date=now−5s transitions to ONGOING and creates AuditLog', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() - 5000); // started 5s ago

    const id = randomUUID();
    const slug = `cron-test-trans-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Auto-Transition',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'REGISTRATION_CLOSED',
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);
    tournamentSlugs.push(slug);

    const transitioned = await runAutoTransitionPass(now, [organizer.id]);

    expect(transitioned).toContain(id);

    // Status in DB should be ONGOING
    const updated = await prisma.tournament.findUnique({
      where: { id },
      select: { status: true },
    });
    expect(updated?.status).toBe('ONGOING');

    // AuditLog should exist
    const log = await prisma.auditLog.findFirst({
      where: { entity_type: 'Tournament', entity_id: slug, action: 'auto_status_transition' },
    });
    expect(log).not.toBeNull();
    expect((log!.old_value as Record<string, unknown>)['status']).toBe('REGISTRATION_CLOSED');
    expect((log!.new_value as Record<string, unknown>)['status']).toBe('ONGOING');
  });

  it('5. Tournament start_date=now+5min is NOT yet started → stays REGISTRATION_CLOSED', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() + 5 * 60 * 1000); // starts in 5min

    const id = randomUUID();
    const slug = `cron-test-future-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Future',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'REGISTRATION_CLOSED',
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);

    const transitioned = await runAutoTransitionPass(now, [organizer.id]);

    expect(transitioned).not.toContain(id);

    const unchanged = await prisma.tournament.findUnique({
      where: { id },
      select: { status: true },
    });
    expect(unchanged?.status).toBe('REGISTRATION_CLOSED');
  });

  it('6. ONGOING tournament is not double-transitioned', async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() - 5000);

    const id = randomUUID();
    const slug = `cron-test-dbl-${id.slice(0, 8)}`;
    await prisma.tournament.create({
      data: {
        id,
        slug,
        name: 'Cron Test — Already Ongoing',
        host_id: organizer.id,
        format: 'SWISS',
        status: 'ONGOING', // already transitioned
        start_date: startDate,
        timezone: 'UTC',
      },
    });
    tournamentIds.push(id);

    const transitioned = await runAutoTransitionPass(now, [organizer.id]);

    // Should not appear in transitioned list (wrong status filter)
    expect(transitioned).not.toContain(id);
  });
});
