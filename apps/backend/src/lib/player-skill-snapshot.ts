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
import { skillToBand } from './rating-model.js';

/** UTC date-only (midnight) for the snapshot day. */
function utcToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Snapshot every player's timeless (all-time) General Skill for today. Idempotent
 * per day via the (user_id, snapshot_date) unique + skipDuplicates: the first run
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

  const rows = model.generalSkills.map((gs) => ({
    user_id: gs.playerId,
    snapshot_date,
    general_skill: gs.generalSkill,
    std_error: gs.stdError,
    band: skillToBand(gs.generalSkill),
    games_count: gs.gamesCount,
    version_id: active?.id ?? null,
  }));
  if (rows.length === 0) return 0;
  const result = await prisma.playerSkillSnapshot.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}
