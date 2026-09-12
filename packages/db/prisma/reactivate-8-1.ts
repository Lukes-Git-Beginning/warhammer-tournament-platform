// Dev-only helper: the backend test suite toggles Season.is_active off (shared dev DB),
// leaving no active version. Re-activate 8.1 for local QA, prune leftover test versions
// that have no games, and report the 2v2 game distribution.
//
// Run: pnpm -F @rizzotto/db tsx prisma/reactivate-8-1.ts

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

const VERSION_8_1 = 'be1442d0-40a2-42ad-a131-64796a821490';

async function main() {
  await prisma.gameVersion.updateMany({ data: { is_active: false } });
  await prisma.gameVersion.update({ where: { id: VERSION_8_1 }, data: { is_active: true } });
  console.log('✓ 8.1 active, all others deactivated');

  // Prune leftover test versions (created by the suite) that have no matches attached.
  const versions = await prisma.gameVersion.findMany({ orderBy: { start_date: 'desc' } });
  for (const v of versions) {
    if (v.id === VERSION_8_1) continue;
    const games = await prisma.match.count({ where: { version_id: v.id } });
    if (games === 0) {
      await prisma.factionStats.deleteMany({ where: { version_id: v.id } });
      await prisma.matchupStats.deleteMany({ where: { version_id: v.id } });
      await prisma.playerSkillSnapshot.deleteMany({ where: { version_id: v.id } });
      await prisma.gameVersion.delete({ where: { id: v.id } });
      console.log(`✗ pruned empty test version "${v.name}" (${v.id.slice(0, 8)})`);
    } else {
      console.log(`• kept "${v.name}" — ${games} matches`);
    }
  }

  // Report 2v2 game distribution by battle type + season.
  const rows = await prisma.matchGame.findMany({
    where: { status: 'COMPLETED', match: { tournament: { competitor_format: 'TWO_V_TWO' } } },
    select: { battle_type: true, match: { select: { version_id: true } } },
  });
  const byType = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.battle_type} / ${r.match.version_id?.slice(0, 8) ?? 'null'}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  console.log('\n2v2 completed games (battle_type / season):');
  for (const [k, n] of byType) console.log(`  ${k}: ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
