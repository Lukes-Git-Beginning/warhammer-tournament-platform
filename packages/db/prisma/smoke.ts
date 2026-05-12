// Quick smoke: verify schema + seed + adapter wiring end-to-end.
// Throwaway file — used once after M1.2 migration; safe to delete.

import { prisma } from '../src/index.js';

async function main(): Promise<void> {
  const [factionCount, factions, season] = await Promise.all([
    prisma.faction.count(),
    prisma.faction.findMany({ orderBy: { display_order: 'asc' }, select: { id: true, name: true, display_order: true } }),
    prisma.season.findFirst({ where: { is_active: true }, select: { id: true, name: true } }),
  ]);
  console.log(`Factions in DB: ${factionCount}`);
  console.log(`First 3:        ${factions.slice(0, 3).map((f) => `${f.display_order}:${f.id}`).join(', ')}`);
  console.log(`Last 3:         ${factions.slice(-3).map((f) => `${f.display_order}:${f.id}`).join(', ')}`);
  console.log(`Active season:  ${season?.name ?? '(none)'} (${season?.id ?? 'null'})`);
  if (factionCount !== 24) throw new Error(`Expected 24 factions, got ${factionCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
