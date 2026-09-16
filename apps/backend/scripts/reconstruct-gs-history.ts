/**
 * Reconstruct the timeless General Skill day-by-day and persist a PlayerSkillSnapshot per
 * (user, UTC day). "GS on day D" = the hierarchical fit over every decisive game up to end-of-D,
 * from the FIRST eligible game (the same all-time set as the live GS — no launch floor). Idempotent.
 *
 *   SANITY=1 → just print the all-time GS top-10 (no writes), to eyeball against prod.
 *   (default) → the full first-game→today batch (shared with the on-boot auto-backfill).
 *
 * Run: DATABASE_URL=<db> pnpm -F @rizzotto/backend exec tsx scripts/reconstruct-gs-history.ts
 */
import { prisma } from '@rizzotto/db';
import { getRatingModel } from '../src/lib/rating-model-service.js';
import { buildSnapshotRows } from '../src/lib/gs-history.js';
import { backfillGsHistory } from '../src/lib/gs-history-backfill.js';

const SANITY = process.env.SANITY === '1';

async function main(): Promise<void> {
  if (SANITY) {
    const version = await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });
    const users = await prisma.user.findMany({ select: { id: true, username: true } });
    const validUserIds = new Set(users.map((u) => u.id));
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    const model = await getRatingModel(prisma, undefined, { versionId: null, config: { hierarchical: true } });
    const rows = buildSnapshotRows(model.generalSkills, new Date(), validUserIds, version?.id ?? null)
      .sort((a, b) => b.general_skill - a.general_skill)
      .slice(0, 10);
    console.log(`=== ALL-TIME GS top 10 (${model.generalSkills.length} players, ${model.totalMatches} obs) ===`);
    for (const r of rows) {
      console.log(
        `GS ${r.general_skill.toFixed(3).padStart(7)}  band ${r.band}  games ${String(r.games_count).padStart(3)}  ${nameById.get(r.user_id)}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  console.log('Reconstructing GS from the first eligible game → today…');
  const inserted = await backfillGsHistory(prisma, {
    info: (o, m) => console.log(m ?? '', o),
    error: (o, m) => console.error(m ?? '', o),
  });
  const snapCount = await prisma.playerSkillSnapshot.count();
  console.log(`\nDONE: ${inserted} rows inserted this run · ${snapCount} snapshots total.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
