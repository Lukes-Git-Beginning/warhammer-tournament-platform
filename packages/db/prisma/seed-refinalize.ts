/**
 * Re-runs finalizeTournament for a given tournament slug.
 * Usage: tsx prisma/seed-refinalize.ts --tournament <slug>
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '../generated/prisma/index.js';
import { finalizeTournament } from '../../apps/backend/src/lib/finalize-tournament.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { tournament: { type: 'string' } },
});

if (!values.tournament) {
  console.error('Usage: tsx prisma/seed-refinalize.ts --tournament <slug>');
  process.exit(1);
}

const prisma = new PrismaClient();

const tournament = await prisma.tournament.findFirst({
  where: { slug: values.tournament, deleted_at: null },
  select: { id: true, slug: true, status: true },
});

if (!tournament) {
  console.error(`Tournament "${values.tournament}" not found.`);
  process.exit(1);
}

if (tournament.status !== 'COMPLETED') {
  console.error(`Tournament "${values.tournament}" is ${tournament.status}, not COMPLETED.`);
  process.exit(1);
}

console.log(`Re-finalizing "${values.tournament}" (${tournament.id})…`);
const result = await finalizeTournament(prisma, tournament.id, 'system');
console.log(`Done. ${result.resultCount} placements written, seasonId=${result.seasonId}`);

await prisma.$disconnect();
