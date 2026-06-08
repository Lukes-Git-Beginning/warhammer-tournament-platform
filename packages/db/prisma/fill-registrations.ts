// Dev helper: fill a tournament with N dummy registrations.
// Usage: pnpm --filter @rizzotto/db exec tsx prisma/fill-registrations.ts <slug> [count]
// Defaults: slug = test-sft-swiss, count = 7

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

const slug = process.argv[2] ?? 'test-sft-swiss';
const count = parseInt(process.argv[3] ?? '7', 10);

async function main(): Promise<void> {
  // Load tournament
  const tournament = await prisma.tournament.findFirst({
    where: { slug, deleted_at: null },
    select: {
      id: true,
      slug: true,
      mode: true,
      faction_allowlist: { select: { faction_id: true } },
    },
  });
  if (!tournament) throw new Error(`Tournament "${slug}" not found`);

  const isSFT = tournament.mode === 'SFT';
  console.log(`Tournament: ${tournament.slug} (${tournament.mode})`);

  // Determine available factions
  const allFactions = await prisma.faction.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const allowedIds = tournament.faction_allowlist.map((a) => a.faction_id);
  const factions = allowedIds.length > 0
    ? allFactions.filter((f) => allowedIds.includes(f.id))
    : allFactions;

  if (isSFT && factions.length === 0) throw new Error('No factions available for SFT registration');

  // Get existing participants so we don't double-register
  const existing = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournament.id, deleted_at: null },
    select: { user_id: true, faction_id: true },
  });
  const usedFactionIds = new Set(existing.map((p) => p.faction_id).filter(Boolean));
  console.log(`  Existing participants: ${existing.length}`);

  // Prefer existing users who aren't already in this tournament
  const registeredUserIds = new Set(existing.map((p) => p.user_id));
  const availableUsers = await prisma.user.findMany({
    where: { deleted_at: null, id: { notIn: [...registeredUserIds] }, role: 'USER' },
    select: { id: true, username: true },
    orderBy: { created_at: 'asc' },
    take: count,
  });

  let added = 0;
  let factionIndex = 0;

  for (let i = 0; i < count; i++) {
    // Use an existing user if available, otherwise create a generic dummy
    let userId: string;
    let username: string;

    if (i < availableUsers.length) {
      userId = availableUsers[i]!.id;
      username = availableUsers[i]!.username;
    } else {
      const discordId = `dummy-player-${String(i + 1).padStart(3, '0')}`;
      username = `DummyPlayer${String(i + 1).padStart(3, '0')}`;
      const user = await prisma.user.upsert({
        where: { discord_id: discordId },
        create: { discord_id: discordId, username, role: 'USER', onboarded_at: new Date() },
        update: {},
        select: { id: true },
      });
      userId = user.id;
    }

    const user = { id: userId };

    // Skip if already registered (shouldn't happen but guard anyway)
    if (registeredUserIds.has(user.id)) {
      console.log(`  Skipping ${username} — already registered`);
      continue;
    }

    // Pick a faction for SFT (prefer unused ones, cycle if needed)
    let factionId: string | null = null;
    if (isSFT) {
      const unused = factions.filter((f) => !usedFactionIds.has(f.id));
      const pool = unused.length > 0 ? unused : factions;
      const faction = pool[factionIndex % pool.length]!;
      factionId = faction.id;
      usedFactionIds.add(factionId);
      factionIndex++;
    }

    await prisma.tournamentParticipant.create({
      data: {
        tournament_id: tournament.id,
        user_id: userId,
        faction_id: factionId,
        status: 'REGISTERED',
      },
    });

    const factionName = factionId
      ? (factions.find((f) => f.id === factionId)?.name ?? factionId)
      : '—';
    console.log(`  + ${username}${isSFT ? ` (${factionName})` : ''}`);
    added++;
  }

  console.log(`Done. Added ${added} participant(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
