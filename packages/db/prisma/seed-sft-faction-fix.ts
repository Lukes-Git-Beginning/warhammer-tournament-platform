// One-time fix script for Generalprobe SFT tournaments where TournamentParticipant.faction_id
// is null because participants registered without faction selection.
//
// Derives each participant's SFT faction from their completed MatchGame records
// (most frequently played faction wins; ties broken by recency).
//
// Invoke via:
//   pnpm db:seed:sft-fix -- --tournament <slug>
//   pnpm db:seed:sft-fix -- --tournament <slug> --dry-run

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
  console.error('seed-sft-faction-fix: DATABASE_URL does not look local — refusing to run.');
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
  console.error('Usage: pnpm db:seed:sft-fix -- --tournament <slug>');
  process.exit(1);
}

const dryRun = args['dry-run'] ?? false;
if (dryRun) console.log('[dry-run] No DB writes will occur.\n');

async function main() {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: args.tournament!, deleted_at: null },
    select: { id: true, name: true, mode: true },
  });

  if (!tournament) {
    console.error(`Tournament "${args.tournament}" not found.`);
    process.exit(1);
  }

  if (tournament.mode !== 'SFT') {
    console.warn(`Warning: tournament mode is "${tournament.mode}", not SFT. Continuing anyway.`);
  }

  console.log(`Tournament: ${tournament.name} (${tournament.id}), mode: ${tournament.mode}\n`);

  // Load participants without a faction
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournament.id, deleted_at: null },
    select: { id: true, user_id: true, faction_id: true, user: { select: { username: true } } },
  });

  // Load all completed matches for this tournament
  const matches = await prisma.match.findMany({
    where: { tournament_id: tournament.id, deleted_at: null },
    select: {
      id: true,
      player1_id: true,
      player2_id: true,
      games: {
        where: { status: 'COMPLETED' },
        select: { player1_faction_id: true, player2_faction_id: true },
        orderBy: { game_number: 'asc' },
      },
    },
  });

  // Build userId → faction frequency map from completed games
  const factionFreq = new Map<string, Map<string, number>>();

  for (const match of matches) {
    for (const game of match.games) {
      if (match.player1_id && game.player1_faction_id) {
        const m = factionFreq.get(match.player1_id) ?? new Map<string, number>();
        m.set(game.player1_faction_id, (m.get(game.player1_faction_id) ?? 0) + 1);
        factionFreq.set(match.player1_id, m);
      }
      if (match.player2_id && game.player2_faction_id) {
        const m = factionFreq.get(match.player2_id) ?? new Map<string, number>();
        m.set(game.player2_faction_id, (m.get(game.player2_faction_id) ?? 0) + 1);
        factionFreq.set(match.player2_id, m);
      }
    }
  }

  // Load faction names for display
  const allFactionIds = new Set<string>();
  for (const freqMap of factionFreq.values()) {
    for (const id of freqMap.keys()) allFactionIds.add(id);
  }
  const factions = await prisma.faction.findMany({
    where: { id: { in: [...allFactionIds] } },
    select: { id: true, name: true },
  });
  const factionNames = new Map(factions.map((f) => [f.id, f.name]));

  let updated = 0;
  let skipped = 0;

  for (const participant of participants) {
    const name = participant.user.username ?? participant.user_id;

    if (participant.faction_id) {
      console.log(`  SKIP  ${name} — already has faction ${factionNames.get(participant.faction_id) ?? participant.faction_id}`);
      skipped++;
      continue;
    }

    const freqMap = factionFreq.get(participant.user_id);
    if (!freqMap || freqMap.size === 0) {
      console.log(`  WARN  ${name} — no completed games found, cannot derive faction`);
      skipped++;
      continue;
    }

    // Most frequently played faction
    let bestFactionId = '';
    let bestCount = 0;
    for (const [fId, count] of freqMap.entries()) {
      if (count > bestCount) { bestFactionId = fId; bestCount = count; }
    }

    const factionName = factionNames.get(bestFactionId) ?? bestFactionId;
    const inconsistent = freqMap.size > 1
      ? ` (⚠ played ${freqMap.size} different factions)`
      : '';

    console.log(`  SET   ${name} → ${factionName} (${bestCount} game(s))${inconsistent}`);

    if (!dryRun) {
      await prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { faction_id: bestFactionId },
      });
    }
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.${dryRun ? ' (dry-run — no writes)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
