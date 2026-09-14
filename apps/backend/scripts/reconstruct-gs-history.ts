/**
 * Reconstruct the timeless General Skill day-by-day from launch and persist a PlayerSkillSnapshot
 * per (user, UTC day). "GS on day D" = the hierarchical fit over every decisive game with played_at
 * up to end-of-D. Idempotent (createMany skipDuplicates). Runs against the LOCAL gs-history DB only.
 *
 *   SANITY=1 → just print the all-time GS top-10 (no writes), to eyeball against prod.
 *   (default) → the full launch→today batch.
 *
 * Run: DATABASE_URL=<gshistory> pnpm -F @rizzotto/backend exec tsx scripts/reconstruct-gs-history.ts
 */
import { prisma } from '@rizzotto/db';
import { getRatingModel } from '../src/lib/rating-model-service.js';
import {
  GS_HISTORY_LAUNCH_DATE,
  eachUtcDay,
  endOfUtcDayExclusive,
  buildSnapshotRows,
} from '../src/lib/gs-history.js';

const SANITY = process.env.SANITY === '1';

async function main(): Promise<void> {
  const version = await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });
  const versionId = version?.id ?? null;
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const validUserIds = new Set(users.map((u) => u.id));
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  if (SANITY) {
    const model = await getRatingModel(prisma, undefined, { versionId: null, config: { hierarchical: true } });
    const rows = buildSnapshotRows(model.generalSkills, new Date(), validUserIds, versionId)
      .sort((a, b) => b.general_skill - a.general_skill)
      .slice(0, 10);
    console.log(`=== ALL-TIME GS top 10 (local, ${model.generalSkills.length} players, ${model.totalMatches} obs) ===`);
    for (const r of rows) {
      console.log(
        `GS ${r.general_skill.toFixed(3).padStart(7)}  band ${r.band}  games ${String(r.games_count).padStart(3)}  ${nameById.get(r.user_id)}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  const days = eachUtcDay(GS_HISTORY_LAUNCH_DATE, new Date());
  console.log(`Reconstructing GS for ${days.length} UTC days (launch 2026-06-27 → today)…`);
  let totalInserted = 0;
  for (const day of days) {
    const t0 = Date.now();
    const model = await getRatingModel(prisma, undefined, {
      versionId: null,
      window: { from: GS_HISTORY_LAUNCH_DATE, to: endOfUtcDayExclusive(day) },
      config: { hierarchical: true },
    });
    const rows = buildSnapshotRows(model.generalSkills, day, validUserIds, versionId);
    if (rows.length > 0) {
      const res = await prisma.playerSkillSnapshot.createMany({ data: rows, skipDuplicates: true });
      totalInserted += res.count;
    }
    console.log(
      `${day.toISOString().slice(0, 10)}: ${String(rows.length).padStart(3)} players · ${String(model.totalMatches).padStart(4)} obs · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
  const snapCount = await prisma.playerSkillSnapshot.count();
  console.log(`\nDONE: ${days.length} days · ${totalInserted} rows inserted this run · ${snapCount} snapshots total.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
