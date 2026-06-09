// Removes the DummyPlayer001-007 registrations + accounts and re-registers
// using the existing named dummy users (dummy-01 … dummy-07).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');
// Safety guard — mutates dummy data, must never touch a non-local database.
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  console.error('fix-dummy-registrations: DATABASE_URL does not look local — refusing to run.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SLUG = 'test-sft-swiss';

async function main(): Promise<void> {
  const tournament = await prisma.tournament.findFirstOrThrow({
    where: { slug: SLUG, deleted_at: null },
    select: { id: true, mode: true, faction_allowlist: { select: { faction_id: true } } },
  });

  // 1. Remove DummyPlayer001-007 participants
  const genericDiscordIds = Array.from({ length: 7 }, (_, i) =>
    `dummy-player-${String(i + 1).padStart(3, '0')}`,
  );
  const genericUsers = await prisma.user.findMany({
    where: { discord_id: { in: genericDiscordIds } },
    select: { id: true, username: true },
  });
  if (genericUsers.length > 0) {
    await prisma.tournamentParticipant.deleteMany({
      where: { tournament_id: tournament.id, user_id: { in: genericUsers.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: genericUsers.map((u) => u.id) } } });
    console.log(`Removed ${genericUsers.length} generic dummy accounts: ${genericUsers.map((u) => u.username).join(', ')}`);
  }

  // 2. Re-register with named dummies 01–07
  const namedDummies = await prisma.user.findMany({
    where: { discord_id: { in: Array.from({ length: 7 }, (_, i) => `dummy-0${i + 1}`) } },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });

  const allFactions = await prisma.faction.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const allowedIds = tournament.faction_allowlist.map((a) => a.faction_id);
  const factions = allowedIds.length > 0 ? allFactions.filter((f) => allowedIds.includes(f.id)) : allFactions;

  const existing = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournament.id, deleted_at: null },
    select: { user_id: true, faction_id: true },
  });
  const usedFactionIds = new Set(existing.map((p) => p.faction_id).filter(Boolean));

  let factionIndex = 0;
  for (const user of namedDummies) {
    if (existing.some((p) => p.user_id === user.id)) {
      console.log(`  Skipping ${user.username} — already registered`);
      continue;
    }
    const unused = factions.filter((f) => !usedFactionIds.has(f.id));
    const pool = unused.length > 0 ? unused : factions;
    const faction = pool[factionIndex % pool.length]!;
    usedFactionIds.add(faction.id);
    factionIndex++;

    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournament.id, user_id: user.id, faction_id: faction.id, status: 'REGISTERED' },
    });
    console.log(`  + ${user.username} (${faction.name})`);
  }

  const total = await prisma.tournamentParticipant.count({ where: { tournament_id: tournament.id, deleted_at: null } });
  console.log(`\nTotal participants now: ${total}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
