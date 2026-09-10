import type { FactionStats, PrismaClient } from '@rizzotto/db';

/**
 * Takes a daily snapshot of all FactionStats for the currently active version.
 * Idempotent: duplicate rows (same faction_id + version_id + snapshot_date) are
 * silently skipped via skipDuplicates.
 *
 * @param prisma  Prisma client instance.
 * @param opts    Optional overrides — pass `versionId` to target a specific version
 *                (used in tests to avoid relying on the global active-version lookup).
 * @returns Number of newly created snapshot rows (0 if no active version or all dupes).
 */
export async function takeFactionsSnapshot(
  prisma: PrismaClient,
  opts?: { versionId?: string },
): Promise<number> {
  // 1. Load active version
  const version = opts?.versionId
    ? await prisma.gameVersion.findUnique({ where: { id: opts.versionId }, select: { id: true } })
    : await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });

  // 2. No active version → nothing to snapshot
  if (!version) {
    return 0;
  }

  // 3. Load all FactionStats for the active version
  const stats = await prisma.factionStats.findMany({
    where: { version_id: version.id },
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
      version_id: s.version_id,
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
