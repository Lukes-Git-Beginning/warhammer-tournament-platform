import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { takeFactionsSnapshot } from '../src/lib/faction-snapshot.js';
import {
  createTestVersion,
  cleanupVersion,
  type TestVersion,
} from './helpers/db-fixtures.js';

// ---------------------------------------------------------------------------
// Per-test state — created fresh as needed, cleaned up in afterEach
// ---------------------------------------------------------------------------

let TestVersion: TestVersion | null = null;

beforeEach(async () => {
  TestVersion = null;
});

afterEach(async () => {
  if (TestVersion) await cleanupVersion(TestVersion.id);
  TestVersion = null;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('takeFactionsSnapshot', () => {
  it('1. returns 0 when versionId does not exist (simulates no active version)', async () => {
    // Pass a non-existent versionId → findUnique returns null → return 0
    const nonExistentId = randomUUID();
    const count = await takeFactionsSnapshot(prisma, { versionId: nonExistentId });

    expect(count).toBe(0);
  });

  it('1b. returns 0 when active version has no FactionStats rows', async () => {
    TestVersion = await createTestVersion({ is_active: true });

    // Version exists but has no FactionStats → return 0
    const count = await takeFactionsSnapshot(prisma, { versionId: TestVersion.id });
    expect(count).toBe(0);

    // No snapshots should have been created
    const rows = await prisma.factionStatsSnapshot.count({ where: { version_id: TestVersion.id } });
    expect(rows).toBe(0);
  });

  it('2. returns 3 for 3 FactionStats rows; second call same day returns 0 (skipDuplicates)', async () => {
    TestVersion = await createTestVersion({ is_active: true });

    // Seed 3 FactionStats rows
    await prisma.factionStats.createMany({
      data: [
        {
          faction_id: 'empire',
          version_id: TestVersion.id,
          matches_played: 10,
          wins: 7,
          losses: 3,
          draws: 0,
          pick_count: 10,
          ban_count: 0,
        },
        {
          faction_id: 'dwarfs',
          version_id: TestVersion.id,
          matches_played: 8,
          wins: 5,
          losses: 3,
          draws: 0,
          pick_count: 8,
          ban_count: 1,
        },
        {
          faction_id: 'kislev',
          version_id: TestVersion.id,
          matches_played: 6,
          wins: 4,
          losses: 2,
          draws: 0,
          pick_count: 6,
          ban_count: 0,
        },
      ],
      skipDuplicates: true,
    });

    // First call → should create 3 snapshot rows
    const count1 = await takeFactionsSnapshot(prisma, { versionId: TestVersion.id });
    expect(count1).toBe(3);

    // Verify all 3 rows exist with today's UTC date
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const snapshots = await prisma.factionStatsSnapshot.findMany({
      where: { version_id: TestVersion.id },
      orderBy: { faction_id: 'asc' },
    });

    expect(snapshots).toHaveLength(3);

    // Verify snapshot_date matches today (UTC midnight)
    for (const snap of snapshots) {
      const snapDate = new Date(snap.snapshot_date);
      snapDate.setUTCHours(0, 0, 0, 0);
      expect(snapDate.toISOString()).toBe(today.toISOString());
    }

    // Verify data integrity for one row
    const empireSnap = snapshots.find((s) => s.faction_id === 'empire');
    expect(empireSnap).toBeDefined();
    expect(empireSnap!.matches_played).toBe(10);
    expect(empireSnap!.wins).toBe(7);
    expect(empireSnap!.version_id).toBe(TestVersion.id);

    // Second call same day → skipDuplicates means 0 new rows
    const count2 = await takeFactionsSnapshot(prisma, { versionId: TestVersion.id });
    expect(count2).toBe(0);

    // Total rows in table for this version should still be 3
    const totalRows = await prisma.factionStatsSnapshot.count({ where: { version_id: TestVersion.id } });
    expect(totalRows).toBe(3);
  });
});

