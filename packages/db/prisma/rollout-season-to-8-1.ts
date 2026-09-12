// ---------------------------------------------------------------------------
// PROD ROLLOUT — verification / fallback for renaming "Season 2026" → "8.1".
//
// NOTE: the rename normally happens AUTOMATICALLY at deploy time via the migration
// 20260910120001_rename_active_version_to_8_1 (runs during `prisma migrate deploy`).
// This script is a safe way to (a) confirm the current version state, and (b) rename
// as a fallback if that migration didn't match the prod name (it targets the *active*
// version regardless of its exact name). It also reports/consolidates stragglers,
// which the migration does not.
//
// Games FK-reference their version by id (Match.season_id), and so do FactionStats,
// MatchupStats and PlayerSkillSnapshot. Renaming the *row* re-labels every game as
// 8.1 with ZERO row updates and keeps all derived stats valid — no recompute needed.
//
// Safety:
//   • Dry-run by DEFAULT — prints the current state + the plan, changes nothing.
//   • Pass --apply to actually rename.
//   • Idempotent: if the target is already "8.1", it no-ops.
//   • Aborts if it can't unambiguously pick a target (multiple versions, name clash).
//
// Optional straggler consolidation (only if the dry-run shows any):
//   • --consolidate (with --apply) also re-points matches that are NOT on the target
//     version (null version_id, or a different one) onto 8.1, so ALL games sit on 8.1.
//     After consolidating, trigger the admin "Recompute faction stats" so the meta
//     reflects the absorbed games (their stats weren't counted under 8.1 before).
//
// Run (dry-run): pnpm -F @rizzotto/db exec tsx prisma/rollout-season-to-8-1.ts
// Run (apply):   pnpm -F @rizzotto/db exec tsx prisma/rollout-season-to-8-1.ts --apply
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const TARGET_NAME = '8.1';
const APPLY = process.argv.includes('--apply');
const CONSOLIDATE = process.argv.includes('--consolidate');

async function main() {
  console.log(`\n=== Rename game version → "${TARGET_NAME}" ===`);
  console.log(APPLY ? 'MODE: APPLY (will write)\n' : 'MODE: DRY-RUN (no changes — pass --apply to execute)\n');

  const versions = await prisma.gameVersion.findMany({ orderBy: { start_date: 'asc' } });
  if (versions.length === 0) {
    console.log('No game versions exist — nothing to do.');
    return;
  }

  console.log('Current versions:');
  for (const v of versions) {
    const matches = await prisma.match.count({ where: { version_id: v.id, deleted_at: null } });
    console.log(`  • "${v.name}" (${v.id.slice(0, 8)}) active=${v.is_active} dlc=${v.dlc_tag ?? '—'} — ${matches} matches`);
  }

  // Pick the target: the active version, or the only version if there's exactly one.
  const active = versions.find((v) => v.is_active);
  const target = active ?? (versions.length === 1 ? versions[0]! : null);
  const existing8_1 = versions.find((v) => v.name === TARGET_NAME);

  if (existing8_1 && target && existing8_1.id === target.id) {
    console.log(`\n✓ Target is already named "${TARGET_NAME}" — no rename needed.`);
  } else if (existing8_1) {
    console.log(
      `\n! A different version is already named "${TARGET_NAME}" (${existing8_1.id.slice(0, 8)}). ` +
        `Aborting to avoid a name clash — resolve manually.`,
    );
    return;
  } else if (!target) {
    console.log(
      `\n! Multiple versions and none marked active — cannot pick a target automatically. ` +
        `Aborting; rename the intended version by hand.`,
    );
    return;
  } else {
    console.log(
      `\nPlan: rename "${target.name}" (${target.id.slice(0, 8)}) → name="${TARGET_NAME}", dlc_tag="${TARGET_NAME}" ` +
        `(its matches stay attributed — same row id).`,
    );
    if (APPLY) {
      await prisma.gameVersion.update({
        where: { id: target.id },
        data: { name: TARGET_NAME, dlc_tag: TARGET_NAME },
      });
      console.log('✓ Renamed.');
    }
  }

  // Report stragglers: non-deleted matches NOT on the target version.
  if (target) {
    const stragglers = await prisma.match.count({
      where: { deleted_at: null, OR: [{ version_id: null }, { version_id: { not: target.id } }] },
    });
    if (stragglers > 0) {
      console.log(`\nStragglers: ${stragglers} non-deleted matches are NOT on the target version.`);
      if (CONSOLIDATE && APPLY) {
        const res = await prisma.match.updateMany({
          where: { deleted_at: null, OR: [{ version_id: null }, { version_id: { not: target.id } }] },
          data: { version_id: target.id },
        });
        console.log(`✓ Consolidated ${res.count} straggler matches → "${TARGET_NAME}".`);
        console.log('  → Now trigger the admin "Recompute faction stats" so the meta reflects them.');
      } else if (CONSOLIDATE) {
        console.log('  (would consolidate onto 8.1 with --apply)');
      } else {
        console.log('  Leave them as-is, or re-run with --consolidate --apply to absorb them onto 8.1.');
      }
    } else {
      console.log('\n✓ No stragglers — every non-deleted match is on the target version.');
    }
  }

  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
