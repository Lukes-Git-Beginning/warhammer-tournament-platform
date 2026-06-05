// Dev-only dummy user seeder — idempotent. Creates N fake players (each with
// a SteamLink so the Steam hard gate does not apply) for local tournament
// testing, and optionally registers them for a tournament by slug.
//
// Invoke via:
//   pnpm db:seed:dummies                                  # 8 users, no registration
//   pnpm db:seed:dummies -- --count 12                    # 12 users
//   pnpm db:seed:dummies -- --tournament my-slug          # 8 users + register
//
// Registration inserts TournamentParticipant rows directly (bypasses the
// OPEN_REGISTRATION guard of POST /api/tournaments/:slug/register) — fine
// for local testing, never run against production.

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

// Safety net: this seeder is for local development databases only.
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  console.error('seed-dummies: DATABASE_URL does not look local — refusing to run.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const { values: args } = parseArgs({
  options: {
    count: { type: 'string', default: '8' },
    tournament: { type: 'string' },
    // Real registrations carry no faction (pre-pick only exists in SFT mode) —
    // default to none so dummies mirror reality; opt in for draft/SFT testing.
    'with-factions': { type: 'boolean', default: false },
  },
});

const COUNT = Math.max(2, Math.min(32, Number(args.count) || 8));

// Old World celebrities, clearly marked as dummies via prefix.
const NAMES = [
  'Grombrindal', 'Settra', 'Sigvald', 'Teclis', 'Tyrion', 'Malekith',
  'Thorgrim', 'Louen', 'Vlad', 'Isabella', 'Azhag', 'Skarsnik',
  'Gotrek', 'Karl-Franz', 'Kroq-Gar', 'Drycha', 'Kairos', 'Skarbrand',
  'Epidemius', 'Ku-Gath', 'Alarielle', 'Morathi', 'Ungrim', 'Wurrzag',
  'Volkmar', 'Repanse', 'Ikit', 'Queek', 'Tretch', 'Snikch', 'Ghorst', 'Kemmler',
];

async function main() {
  console.log(`Seeding ${COUNT} dummy users…`);

  const users = [];
  for (let i = 0; i < COUNT; i++) {
    const discord_id = `dummy-${String(i + 1).padStart(2, '0')}`;
    const username = `Dummy-${NAMES[i % NAMES.length]}`;
    const steam_id = `9000000000000${String(i + 1).padStart(3, '0')}`;

    const avatar_url = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(NAMES[i % NAMES.length])}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

    const user = await prisma.user.upsert({
      where: { discord_id },
      update: { username, avatar_url, deleted_at: null },
      create: {
        discord_id,
        username,
        avatar_url,
        role: 'USER',
        steam_link: {
          create: {
            steam_id,
            persona: username,
            verified_at: new Date(),
          },
        },
      },
      select: { id: true, username: true },
    });
    users.push(user);
  }
  console.log(`  ✓ ${users.length} dummy users ready (${users[0].username} … ${users[users.length - 1].username})`);

  if (args.tournament) {
    const tournament = await prisma.tournament.findFirst({
      where: { slug: args.tournament, deleted_at: null },
      select: { id: true, name: true, status: true, max_participants: true },
    });
    if (!tournament) {
      console.error(`  ✗ Tournament "${args.tournament}" not found`);
      process.exit(1);
    }
    if (tournament.status !== 'OPEN_REGISTRATION') {
      console.log(
        `  ⚠ Tournament "${tournament.name}" has status ${tournament.status} — ` +
          'registering directly via DB anyway (UI registration requires OPEN_REGISTRATION).',
      );
    }

    const withFactions = args['with-factions'] === true;
    const factions = withFactions
      ? await prisma.faction.findMany({ select: { id: true } })
      : [];
    let registered = 0;
    for (const [i, user] of users.entries()) {
      const faction_id = withFactions && factions.length ? factions[i % factions.length].id : null;
      await prisma.tournamentParticipant.upsert({
        where: {
          tournament_id_user_id: { tournament_id: tournament.id, user_id: user.id },
        },
        // update also syncs faction_id so re-runs clean up earlier seeds
        update: { status: 'REGISTERED', deleted_at: null, faction_id },
        create: {
          tournament_id: tournament.id,
          user_id: user.id,
          faction_id,
          status: 'REGISTERED',
        },
      });
      registered++;
    }
    console.log(`  ✓ ${registered} dummies registered for "${tournament.name}" (status: ${tournament.status})`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
