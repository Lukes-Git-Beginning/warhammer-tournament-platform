// ---------------------------------------------------------------------------
// GS history reconstruction (pure core). The timeless General Skill is derive-on-read
// and not stored historically, so we recompute it day-by-day from launch and persist a
// PlayerSkillSnapshot per (user, day). This module holds the PURE, testable pieces; the
// batch wrapper (scripts/reconstruct-gs-history.ts) supplies the fits + DB writes.
// ---------------------------------------------------------------------------
import { skillToBand } from './rating-model.js';

/** Platform launch (2026-06-27 00:00 UTC) — the first day of reconstructed GS history. */
export const GS_HISTORY_LAUNCH_DATE = new Date(Date.UTC(2026, 5, 27));

/** One general-skill entry from a hierarchical rating-model fit (subset used here). */
export interface GsEntry {
  playerId: string;
  generalSkill: number;
  stdError: number;
  gamesCount: number;
}

/** A PlayerSkillSnapshot row (matches the Prisma createMany input). */
export interface SnapshotRow {
  user_id: string;
  snapshot_date: Date;
  general_skill: number;
  std_error: number;
  band: number;
  games_count: number;
  version_id: string | null;
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
 * PURE: map a hierarchical fit's general-skill entries into snapshot rows for one day.
 * Only real Users get a row — team competitor-ids (2v2) are filtered out via `validUserIds`
 * (PlayerSkillSnapshot.user_id FKs to User). Band is derived from raw GS, mirroring the boards.
 */
export function buildSnapshotRows(
  generalSkills: GsEntry[],
  snapshotDate: Date,
  validUserIds: Set<string>,
  versionId: string | null,
): SnapshotRow[] {
  return generalSkills
    .filter((e) => validUserIds.has(e.playerId))
    .map((e) => ({
      user_id: e.playerId,
      snapshot_date: snapshotDate,
      general_skill: e.generalSkill,
      std_error: e.stdError,
      band: skillToBand(e.generalSkill),
      games_count: e.gamesCount,
      version_id: versionId,
    }));
}
