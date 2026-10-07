// ---------------------------------------------------------------------------
// GS history reconstruction (pure core). The timeless General Skill is derive-on-read
// and not stored historically, so we recompute it day-by-day from launch and persist a
// PlayerSkillSnapshot per (user, day, scope). This module holds the PURE, testable pieces; the
// batch wrapper (scripts/reconstruct-gs-history.ts) supplies the fits + DB writes.
// ---------------------------------------------------------------------------
import { skillToBand, type RatingModel } from './rating-model.js';

/** Platform launch (2026-06-27 00:00 UTC) — the first day of reconstructed GS history. */
export const GS_HISTORY_LAUNCH_DATE = new Date(Date.UTC(2026, 5, 27));

/** A PlayerSkillSnapshot row (matches the Prisma createMany input). */
export interface SnapshotRow {
  user_id: string;
  snapshot_date: Date;
  general_skill: number;
  std_error: number;
  band: number;
  games_count: number;
  version_id: string | null;
  battle_type: string; // OVERALL | DOMINATION | CONQUEST | SIEGE
}

/** Inclusive list of UTC midnights from `from`'s day to `to`'s day, one Date per day. */
export function eachUtcDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Exclusive upper bound for a day's fit window: the next UTC midnight (D+1 00:00). */
export function endOfUtcDayExclusive(day: Date): Date {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * PURE (given a fit): one day's snapshot rows from a hierarchical fit — per player an OVERALL row
 * (game-weighted across battle types, NOT the raw base GS) plus one row per battle type the player
 * has played (GS + that type's offset). Only real Users get rows — team competitor-ids (2v2) are
 * filtered out via `validUserIds` (PlayerSkillSnapshot.user_id FKs to User). Band derives from the
 * row's skill, mirroring the boards.
 */
export function buildSnapshotRows(
  model: Pick<RatingModel, 'generalSkills' | 'battleTypeOffsets' | 'getSkillEstimate'>,
  snapshotDate: Date,
  validUserIds: Set<string>,
  versionId: string | null,
): SnapshotRow[] {
  const typesByPlayer = new Map<string, string[]>();
  for (const e of model.battleTypeOffsets) {
    if (e.gamesCount <= 0) continue;
    const arr = typesByPlayer.get(e.playerId) ?? [];
    arr.push(e.battleType);
    typesByPlayer.set(e.playerId, arr);
  }
  const rows: SnapshotRow[] = [];
  for (const e of model.generalSkills) {
    if (!validUserIds.has(e.playerId)) continue;
    for (const scope of ['OVERALL', ...(typesByPlayer.get(e.playerId) ?? []).sort()]) {
      const est = model.getSkillEstimate(e.playerId, scope);
      if (!est) continue;
      rows.push({
        user_id: e.playerId,
        snapshot_date: snapshotDate,
        general_skill: est.skill,
        std_error: est.se,
        band: skillToBand(est.skill),
        games_count: est.gamesCount,
        version_id: versionId,
        battle_type: scope,
      });
    }
  }
  return rows;
}
