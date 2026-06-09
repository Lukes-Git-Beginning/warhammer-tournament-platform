// Dev-only script: delete playoff matches only, keeping Swiss rounds intact.
// Use when the old next-round auto-generated playoffs before the deferred flow was in place.
//
// Invoke via:
//   pnpm db:reset-playoffs -- --tournament <slug>
//   pnpm db:reset-playoffs -- --tournament <slug> --dry-run

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');

if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  console.error('seed-reset-playoffs: DATABASE_URL does not look local — refusing to run.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const { values: args } = parseArgs({
  options: {
    tournament: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.tournament) {
  console.error('Usage: pnpm db:reset-playoffs -- --tournament <slug>');
  process.exit(1);
}

const dryRun = args['dry-run'] ?? false;
if (dryRun) console.log('[dry-run] No DB writes will occur.\n');

async function main() {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: args.tournament!, deleted_at: null },
    select: { id: true, name: true },
  });

  if (!tournament) {
    console.error(`Tournament "${args.tournament}" not found.`);
    process.exit(1);
  }

  const playoffMatches = await prisma.match.findMany({
    where: {
      tournament_id: tournament.id,
      deleted_at: null,
      phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL'] },
    },
    select: { id: true, round: true, phase: true, status: true },
  });

  if (playoffMatches.length === 0) {
    console.log(`No playoff matches found for "${tournament.name}". Nothing to do.`);
    return;
  }

  console.log(`Found ${playoffMatches.length} playoff match(es) in "${tournament.name}":`);
  for (const m of playoffMatches) {
    console.log(`  Round ${m.round} [${m.phase}] ${m.id} — ${m.status}`);
  }

  if (!dryRun) {
    const { count } = await prisma.match.deleteMany({
      where: {
        tournament_id: tournament.id,
        phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL'] },
      },
    });
    console.log(`\nDeleted ${count} playoff match(es). Swiss rounds preserved.`);
  } else {
    console.log('\n[dry-run] Would have deleted the above matches.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
