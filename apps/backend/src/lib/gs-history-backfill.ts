/**
 * One-time backfill of the timeless General Skill history: for every UTC day from launch to
 * today, fit the hierarchical model over all decisive games up to end-of-day and persist a
 * PlayerSkillSnapshot per user. Idempotent (createMany skipDuplicates) so it is safe to re-run.
 *
 * This is the SAME reconstruction as scripts/reconstruct-gs-history.ts, extracted so the server
 * can run it once automatically on the first boot after deploy (see maybeBackfillGsHistoryOnBoot).
 * It yields briefly between days so a live backend stays responsive during the batch.
 */
import type { PrismaClient } from '@rizzotto/db';
import { getRatingModel } from './rating-model-service.js';
import {
  GS_HISTORY_LAUNCH_DATE,
  eachUtcDay,
  endOfUtcDayExclusive,
  buildSnapshotRows,
} from './gs-history.js';

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function backfillGsHistory(prisma: PrismaClient, log?: Logger): Promise<number> {
  const version = await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });
  const versionId = version?.id ?? null;
  const users = await prisma.user.findMany({ select: { id: true } });
  const validUserIds = new Set(users.map((u) => u.id));

  const days = eachUtcDay(GS_HISTORY_LAUNCH_DATE, new Date());
  let inserted = 0;
  for (const day of days) {
    const model = await getRatingModel(prisma, undefined, {
      versionId: null,
      window: { from: GS_HISTORY_LAUNCH_DATE, to: endOfUtcDayExclusive(day) },
      config: { hierarchical: true },
    });
    const rows = buildSnapshotRows(model.generalSkills, day, validUserIds, versionId);
    if (rows.length > 0) {
      const res = await prisma.playerSkillSnapshot.createMany({ data: rows, skipDuplicates: true });
      inserted += res.count;
    }
    // Yield between days: the per-day fit is CPU-bound, so a small pause keeps the live
    // backend's event loop responsive during this one-time batch.
    await new Promise((r) => setTimeout(r, 25));
  }
  log?.info({ days: days.length, inserted }, '[gs-history] backfill complete');
  return inserted;
}

/**
 * Guarded, fire-and-forget: on the first boot where the snapshot table is empty, kick off the
 * backfill in the background (never blocks boot, never throws). Once rows exist it is a no-op, so
 * it runs exactly once per environment (the daily snapshot cron takes over from there).
 */
export function maybeBackfillGsHistoryOnBoot(prisma: PrismaClient, log: Logger): void {
  void (async () => {
    try {
      const existing = await prisma.playerSkillSnapshot.count();
      if (existing > 0) return; // already populated — never re-run
      log.info({}, '[gs-history] snapshot table empty — starting one-time backfill in the background');
      const inserted = await backfillGsHistory(prisma, log);
      log.info({ inserted }, '[gs-history] one-time backfill finished');
    } catch (err) {
      log.error({ err }, '[gs-history] boot backfill failed (non-fatal) — history will fill forward from the daily cron');
    }
  })();
}
