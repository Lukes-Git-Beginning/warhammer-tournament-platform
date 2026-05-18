import type { FactionStats, PrismaClient } from '@rizzotto/db';

/**
 * Takes a daily snapshot of all FactionStats for the currently active season.
 * Idempotent: duplicate rows (same faction_id + season_id + snapshot_date) are
 * silently skipped via skipDuplicates.
 *
 * @param prisma  Prisma client instance.
 * @param opts    Optional overrides — pass `seasonId` to target a specific season
 *                (used in tests to avoid relying on the global active-season lookup).
 * @returns Number of newly created snapshot rows (0 if no active season or all dupes).
 */
export async function takeFactionsSnapshot(
  prisma: PrismaClient,
  opts?: { seasonId?: string },
): Promise<number> {
  // 1. Load active season
  const season = opts?.seasonId
    ? await prisma.season.findUnique({ where: { id: opts.seasonId }, select: { id: true } })
    : await prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });

  // 2. No active season → nothing to snapshot
  if (!season) {
    return 0;
  }

  // 3. Load all FactionStats for the active season
  const stats = await prisma.factionStats.findMany({
    where: { season_id: season.id },
  });

  if (stats.length === 0) {
    return 0;
  }

  // 4. Today's date (UTC, midnight — Postgres DATE type)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 5. Create snapshot rows, skipping duplicates (idempotent)
  const result = await prisma.factionStatsSnapshot.createMany({
    data: stats.map((s: FactionStats) => ({
      faction_id: s.faction_id,
      season_id: s.season_id,
      snapshot_date: today,
      matches_played: s.matches_played,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      pick_count: s.pick_count,
      ban_count: s.ban_count,
    })),
    skipDuplicates: true,
  });

  // 6. Return count of actually inserted rows
  return result.count;
}
