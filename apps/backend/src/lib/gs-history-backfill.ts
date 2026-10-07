/**
 * One-time backfill of the timeless General Skill history: for every UTC day from the FIRST
 * eligible game to today, fit the hierarchical model over all decisive games up to end-of-day
 * and persist a PlayerSkillSnapshot per user. Idempotent (createMany skipDuplicates).
 *
 * The start is the earliest eligible game (NOT a fixed launch date) on purpose: the live all-time
 * GS counts every game with no lower bound — pre-launch/beta games included — so the reconstructed
 * history must span the SAME set, or a chart's latest point wouldn't equal the player's current GS.
 *
 * Same reconstruction as scripts/reconstruct-gs-history.ts, extracted so the server can run it once
 * automatically on the first boot after deploy (see maybeBackfillGsHistoryOnBoot). Yields briefly
 * between days so a live backend stays responsive during the batch.
 */
import type { PrismaClient } from '@rizzotto/db';
import { getRatingModel } from './rating-model-service.js';
import { eligibleStatGameWhere } from './stat-eligibility.js';
import { eachUtcDay, endOfUtcDayExclusive, buildSnapshotRows } from './gs-history.js';

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function backfillGsHistory(prisma: PrismaClient, log?: Logger): Promise<number> {
  const version = await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });
  const versionId = version?.id ?? null;
  const users = await prisma.user.findMany({ select: { id: true } });
  const validUserIds = new Set(users.map((u) => u.id));

  // First eligible game = the same all-time set the live GS fits over (no launch floor).
  const first = await prisma.matchGame.findFirst({
    where: eligibleStatGameWhere(null),
    orderBy: { played_at: 'asc' },
    select: { played_at: true },
  });
  if (!first?.played_at) {
    log?.info({ inserted: 0 }, '[gs-history] no eligible games — nothing to reconstruct');
    return 0;
  }

  const days = eachUtcDay(first.played_at, new Date());
  const startDay = days[0]!; // UTC midnight of the earliest eligible game
  let inserted = 0;
  for (const day of days) {
    const model = await getRatingModel(prisma, undefined, {
      versionId: null,
      window: { from: startDay, to: endOfUtcDayExclusive(day) },
      config: { hierarchical: true },
    });
    const rows = buildSnapshotRows(model, day, validUserIds, versionId);
    if (rows.length > 0) {
      const res = await prisma.playerSkillSnapshot.createMany({ data: rows, skipDuplicates: true });
      inserted += res.count;
    }
    // The per-day fit is CPU-bound; a small pause keeps the live backend's event loop responsive.
    await new Promise((r) => setTimeout(r, 25));
  }
  log?.info({ days: days.length, from: startDay.toISOString().slice(0, 10), inserted }, '[gs-history] backfill complete');
  return inserted;
}

/** How often a deferred backfill re-checks for ongoing tournaments. */
const ONGOING_RECHECK_MS = 10 * 60 * 1000;

/**
 * True when the snapshot history doesn't reach back to the first eligible game — empty table, or
 * only the daily cron's recent rows (e.g. the cron ran while a deferred backfill was still waiting).
 */
async function historyIncomplete(prisma: PrismaClient): Promise<boolean> {
  const [earliest, first] = await Promise.all([
    prisma.playerSkillSnapshot.findFirst({ orderBy: { snapshot_date: 'asc' }, select: { snapshot_date: true } }),
    prisma.matchGame.findFirst({
      where: eligibleStatGameWhere(null),
      orderBy: { played_at: 'asc' },
      select: { played_at: true },
    }),
  ]);
  if (!first?.played_at) return false; // no games → nothing to reconstruct
  if (!earliest) return true;
  // Allow one day of slack (UTC vs site-day boundaries).
  return earliest.snapshot_date.getTime() > first.played_at.getTime() + 24 * 60 * 60 * 1000;
}

/**
 * Guarded, fire-and-forget: on boot, if the snapshot history is missing (empty table — e.g. after
 * the per-battle-type migration cleared it), rebuild it in the background (never blocks boot,
 * never throws). Each day's fit is CPU-bound and stalls the event loop for a moment, so while any
 * tournament is ONGOING the rebuild WAITS (re-checked every 10 min) — a live tournament must not
 * lag. Once the history is complete it is a no-op; the daily snapshot cron takes over.
 */
export function maybeBackfillGsHistoryOnBoot(prisma: PrismaClient, log: Logger): void {
  void (async () => {
    try {
      if (!(await historyIncomplete(prisma))) return; // already populated — never re-run
      for (;;) {
        const ongoing = await prisma.tournament.count({ where: { status: 'ONGOING', deleted_at: null } });
        if (ongoing === 0) break;
        log.info({ ongoing }, '[gs-history] history missing — backfill deferred while tournaments are ONGOING');
        await new Promise((r) => setTimeout(r, ONGOING_RECHECK_MS).unref?.());
      }
      if (!(await historyIncomplete(prisma))) return; // another instance filled it meanwhile
      log.info({}, '[gs-history] snapshot history missing — starting one-time backfill in the background');
      const inserted = await backfillGsHistory(prisma, log);
      log.info({ inserted }, '[gs-history] one-time backfill finished');
    } catch (err) {
      log.error({ err }, '[gs-history] boot backfill failed (non-fatal) — history will fill forward from the daily cron');
    }
  })();
}
