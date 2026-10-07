// ---------------------------------------------------------------------------
// Player skill snapshot — persists the timeless General Skill once per day.
//
// GS is derive-on-read (fit from match facts) and NOT historically
// reconstructable, so we snapshot it daily (design doc §3). Build the cron EARLY:
// every un-snapshotted day is history lost forever. Cheap — a single createMany.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { getRatingModel } from './rating-model-service.js';
import { buildSnapshotRows } from './gs-history.js';
import { siteDayAsDate } from './site-time.js';

/** The snapshot day: today's German calendar date (stored as a Postgres DATE). */
function utcToday(): Date {
  return siteDayAsDate(new Date());
}

/**
 * Snapshot every player's timeless (all-time) General Skill for today. Idempotent
 * per day via the (user_id, snapshot_date, battle_type) unique + skipDuplicates: the first run
 * of the day writes, later runs are no-ops. Returns the number of rows written.
 */
export async function snapshotPlayerSkills(
  prisma: PrismaClient,
  redis: Redis | undefined,
): Promise<number> {
  // Timeless GS = the all-time fit (spans every version), hierarchical (yields generalSkills).
  const model = await getRatingModel(prisma, redis, {
    versionId: null,
    config: { hierarchical: true },
  });
  const active = await prisma.gameVersion.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  const snapshot_date = utcToday();
  if (model.generalSkills.length === 0) return 0;

  // The fit's competitor ids can include Team ids (2v2), but PlayerSkillSnapshot.user_id FKs
  // to User. Filter to real users — teams are not snapshotted in v1 (team GS stays derive-on-
  // read). Without this, the daily cron would hit an FK violation once any 2v2 game exists.
  const realUserIds = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: model.generalSkills.map((g) => g.playerId) } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  // One OVERALL row (game-weighted) + one row per battle type played, per user.
  const userRows = buildSnapshotRows(model, snapshot_date, realUserIds, active?.id ?? null);
  if (userRows.length === 0) return 0;
  const result = await prisma.playerSkillSnapshot.createMany({
    data: userRows,
    skipDuplicates: true,
  });
  return result.count;
}
