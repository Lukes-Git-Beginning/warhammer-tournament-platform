import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@tww3/db';
import { takeFactionsSnapshot } from '../src/lib/faction-snapshot.js';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const S1 = 'a2000000-0000-0000-0000-000000000001'; // season for snapshot tests

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

async function cleanup() {
  await prisma.factionStatsSnapshot.deleteMany({ where: { season_id: S1 } });
  await prisma.factionStats.deleteMany({ where: { season_id: S1 } });
  await prisma.season.deleteMany({ where: { id: S1 } });
  // Deactivate any other active seasons that may interfere
  await prisma.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('takeFactionsSnapshot', () => {
  it('1. returns 0 and creates no rows when there is no active season', async () => {
    // No season seeded → no active season
    const count = await takeFactionsSnapshot(prisma);

    expect(count).toBe(0);

    const rows = await prisma.factionStatsSnapshot.count();
    expect(rows).toBe(0);
  });

  it('2. returns 3 for 3 FactionStats rows; second call same day returns 0 (skipDuplicates)', async () => {
    // Seed active season
    await prisma.season.create({
      data: {
        id: S1,
        name: 'Snapshot Test Season',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_active: true,
      },
    });

    // Seed 3 FactionStats rows
    await prisma.factionStats.createMany({
      data: [
        {
          faction_id: 'empire',
          season_id: S1,
          matches_played: 10,
          wins: 7,
          losses: 3,
          draws: 0,
          pick_count: 10,
          ban_count: 0,
        },
        {
          faction_id: 'dwarfs',
          season_id: S1,
          matches_played: 8,
          wins: 5,
          losses: 3,
          draws: 0,
          pick_count: 8,
          ban_count: 1,
        },
        {
          faction_id: 'kislev',
          season_id: S1,
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
    const count1 = await takeFactionsSnapshot(prisma);
    expect(count1).toBe(3);

    // Verify all 3 rows exist with today's UTC date
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const snapshots = await prisma.factionStatsSnapshot.findMany({
      where: { season_id: S1 },
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
    expect(empireSnap!.season_id).toBe(S1);

    // Second call same day → skipDuplicates means 0 new rows
    const count2 = await takeFactionsSnapshot(prisma);
    expect(count2).toBe(0);

    // Total rows in table should still be 3
    const totalRows = await prisma.factionStatsSnapshot.count({ where: { season_id: S1 } });
    expect(totalRows).toBe(3);
  });
});
