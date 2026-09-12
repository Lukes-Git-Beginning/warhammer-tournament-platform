// Demo data for the Tournament Series feature (worktree feat/tournament-series).
// Idempotent: wipes its own demo rows (fixed slugs) then recreates them.
// Run: pnpm --filter @rizzotto/db exec tsx prisma/seed-series-demo.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SERIES_SLUG = 'demo-wednesday-wars';
const QUALI_SLUGS = ['demo-ww-1', 'demo-ww-2'];
const FINAL_SLUG = 'demo-ww-final';
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

async function wipe(): Promise<void> {
  const ts = await prisma.tournament.findMany({
    where: { slug: { in: [...QUALI_SLUGS, FINAL_SLUG] } },
    select: { id: true },
  });
  const tIds = ts.map((t) => t.id);
  if (tIds.length) {
    const matches = await prisma.match.findMany({ where: { tournament_id: { in: tIds } }, select: { id: true } });
    const mIds = matches.map((m) => m.id);
    if (mIds.length) await prisma.matchGame.deleteMany({ where: { match_id: { in: mIds } } });
    await prisma.match.deleteMany({ where: { tournament_id: { in: tIds } } });
    await prisma.tournamentResult.deleteMany({ where: { tournament_id: { in: tIds } } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: { in: tIds } } });
  }
  await prisma.tournamentSeries.deleteMany({ where: { slug: SERIES_SLUG } });
  await prisma.tournament.deleteMany({ where: { slug: { in: [...QUALI_SLUGS, FINAL_SLUG] } } });
}

async function main(): Promise<void> {
  await wipe();

  const admin = await prisma.user.upsert({
    where: { discord_id: 'demo-admin' },
    update: { role: Role.ADMIN, username: 'SeriesAdmin' },
    create: { discord_id: 'demo-admin', username: 'SeriesAdmin', role: Role.ADMIN },
  });

  const players = [];
  for (const n of NAMES) {
    players.push(
      await prisma.user.upsert({
        where: { discord_id: `demo-${n.toLowerCase()}` },
        update: { username: n },
        create: { discord_id: `demo-${n.toLowerCase()}`, username: n },
      }),
    );
  }
  const id = (name: string): string => players[NAMES.indexOf(name)].id;

  // A completed round-robin qualifier: the earlier player in `strength` wins each game.
  async function makeQualifier(slug: string, name: string, strength: string[]): Promise<string> {
    const t = await prisma.tournament.create({
      data: {
        slug,
        name,
        host_id: admin.id,
        format: 'SWISS',
        mode: 'BPT',
        status: 'COMPLETED',
        counts_for_leaderboard: true,
        start_date: new Date('2026-09-01T18:00:00Z'),
        timezone: 'Europe/Berlin',
        rounds_count: 5,
      },
    });
    let matchNo = 1;
    for (let i = 0; i < strength.length; i++) {
      for (let j = i + 1; j < strength.length; j++) {
        const p1 = id(strength[i]);
        const p2 = id(strength[j]);
        const m = await prisma.match.create({
          data: {
            tournament_id: t.id,
            round: 1,
            match_number: matchNo++,
            player1_id: p1,
            player2_id: p2,
            winner_id: p1, // strength[i] is stronger (earlier in list)
            status: 'COMPLETED',
            counts_for_leaderboard: true,
            played_at: new Date(),
          },
        });
        await prisma.matchGame.create({
          data: {
            match_id: m.id,
            game_number: 1,
            status: 'COMPLETED',
            winner_id: p1,
            counts_for_leaderboard: true,
            played_at: new Date(),
          },
        });
      }
    }
    return t.id;
  }

  const series = await prisma.tournamentSeries.create({
    data: {
      slug: SERIES_SLUG,
      name: 'Demo Wednesday Wars',
      description:
        'Demo qualifier series. Scoring: 1 point per game played + 1 per win. Top 4 by points qualify for the Grand Final.',
      owner_id: admin.id,
      visibility: 'PUBLIC',
      scoring_config: {
        model: 'A',
        points_per_game_played: 1,
        points_per_win: 1,
        final_size: 4,
        top_x: 2,
        tiebreakers: ['points', 'wins', 'games', 'random'],
      },
    },
  });

  const t1 = await makeQualifier('demo-ww-1', 'Demo Wednesday Wars — Qualifier 1', ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
  const t2 = await makeQualifier('demo-ww-2', 'Demo Wednesday Wars — Qualifier 2', ['Bravo', 'Alpha', 'Charlie', 'Delta', 'Foxtrot', 'Echo']);
  await prisma.tournament.update({ where: { id: t1 }, data: { series_id: series.id, series_position: 1 } });
  await prisma.tournament.update({ where: { id: t2 }, data: { series_id: series.id, series_position: 2 } });

  const final = await prisma.tournament.create({
    data: {
      slug: FINAL_SLUG,
      name: 'Demo Wednesday Wars — Grand Final',
      host_id: admin.id,
      format: 'SINGLE_ELIMINATION',
      mode: 'BPT',
      status: 'REGISTRATION_CLOSED',
      start_date: new Date('2026-09-24T18:00:00Z'),
      timezone: 'Europe/Berlin',
    },
  });
  await prisma.tournamentSeries.update({ where: { id: series.id }, data: { final_tournament_id: final.id } });
  await prisma.tournament.update({ where: { id: final.id }, data: { is_series_final: true } });

  console.log('✓ Demo series seeded.');
  console.log(`  Series page:   /series/${SERIES_SLUG}`);
  console.log(`  Qualifiers:    ${QUALI_SLUGS.join(', ')}`);
  console.log(`  Admin user id: ${admin.id}  (discord_id=demo-admin, role=ADMIN)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
