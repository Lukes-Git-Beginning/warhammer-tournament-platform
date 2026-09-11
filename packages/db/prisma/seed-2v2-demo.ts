// Dev-only 2v2 demo seeder — idempotent. Creates 8 dummy players, forms 4 permanent
// ACTIVE teams (captain + accepted teammate), and two ready-to-start 2v2 tournaments
// (one SFT_2V2 with pre-picked factions, one BPT_2V2), each with all 4 teams registered.
//
// Invoke via:
//   pnpm -F @rizzotto/db exec tsx prisma/seed-2v2-demo.ts
//
// Then open the app as an admin, find "2v2 Demo — …" under Tournaments and hit Start to
// watch the real bracket seed with team names + factions. Local databases only.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  console.error('seed-2v2-demo: DATABASE_URL does not look local — refusing to run.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Four duos (captain, teammate) — Old World celebrities, clearly dummy-prefixed.
const TEAMS: { name: string; captain: string; mate: string }[] = [
  { name: 'Dawi Doomstack', captain: 'Grombrindal', mate: 'Thorgrim' },
  { name: 'Aesyr Twins', captain: 'Teclis', mate: 'Tyrion' },
  { name: 'Carrion Court', captain: 'Vlad', mate: 'Isabella' },
  { name: 'Greenskin Krew', captain: 'Azhag', mate: 'Skarsnik' },
];

function rosterKey(ids: string[]): string {
  return [...ids].sort().join(':');
}

async function ensureUser(name: string) {
  const discord_id = `dummy2v2-${name.toLowerCase()}`;
  const steam_id = `95000000000${Buffer.from(name).reduce((a, c) => a + c, 0).toString().padStart(6, '0')}`;
  const avatar_url = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(name)}`;
  return prisma.user.upsert({
    where: { discord_id },
    update: { username: `Dummy-${name}`, deleted_at: null },
    create: {
      discord_id,
      username: `Dummy-${name}`,
      avatar_url,
      role: 'USER',
      steam_link: { create: { steam_id, persona: `Dummy-${name}`, verified_at: new Date() } },
    },
    select: { id: true, username: true },
  });
}

async function ensureTeam(name: string, captainId: string, mateId: string): Promise<string> {
  const key = rosterKey([captainId, mateId]);
  const existing = await prisma.team.findUnique({ where: { roster_key: key }, select: { id: true } });
  const now = new Date();
  if (existing) {
    await prisma.team.update({
      where: { id: existing.id },
      data: {
        name,
        captain_id: captainId,
        status: 'ACTIVE',
        archived_at: null,
        members: {
          deleteMany: {},
          create: [
            { user_id: captainId, role: 'captain', accepted_at: now },
            { user_id: mateId, role: 'core', accepted_at: now },
          ],
        },
      },
    });
    return existing.id;
  }
  const team = await prisma.team.create({
    data: {
      name,
      roster_key: key,
      size: 2,
      captain_id: captainId,
      status: 'ACTIVE',
      members: {
        create: [
          { user_id: captainId, role: 'captain', accepted_at: now },
          { user_id: mateId, role: 'core', accepted_at: now },
        ],
      },
    },
    select: { id: true },
  });
  return team.id;
}

async function ensureTournament(opts: {
  slug: string;
  name: string;
  mode: 'SFT_2V2' | 'BPT_2V2' | 'BPT';
  hostId: string;
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO';
  battleType?: 'DOMINATION' | 'CONQUEST' | 'SIEGE';
}): Promise<string> {
  const existing = await prisma.tournament.findFirst({ where: { slug: opts.slug }, select: { id: true } });
  const data = {
    name: opts.name,
    host_id: opts.hostId,
    format: 'SINGLE_ELIMINATION' as const,
    mode: opts.mode,
    competitor_format: opts.competitorFormat ?? 'TWO_V_TWO',
    battle_type: opts.battleType ?? 'DOMINATION',
    status: 'REGISTRATION_CLOSED' as const,
    start_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    timezone: 'Europe/Berlin',
    has_third_place_match: true,
  };
  if (existing) {
    await prisma.tournament.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const t = await prisma.tournament.create({ data: { slug: opts.slug, ...data }, select: { id: true } });
  return t.id;
}

async function main() {
  console.log('Seeding 2v2 demo…');

  // Users + teams.
  const teamIds: { id: string; name: string; captainId: string }[] = [];
  for (const spec of TEAMS) {
    const captain = await ensureUser(spec.captain);
    const mate = await ensureUser(spec.mate);
    const id = await ensureTeam(spec.name, captain.id, mate.id);
    teamIds.push({ id, name: spec.name, captainId: captain.id });
  }
  console.log(`  ✓ ${teamIds.length} ACTIVE teams ready`);

  const factions = await prisma.faction.findMany({ take: 8, select: { id: true }, orderBy: { id: 'asc' } });
  const hostId = teamIds[0].captainId;

  // Two tournaments — one SFT_2V2 (factions pre-picked), one BPT_2V2 (blind in-match).
  const sftId = await ensureTournament({ slug: '2v2-demo-sft', name: '2v2 Demo — SFT', mode: 'SFT_2V2', hostId });
  const bptId = await ensureTournament({ slug: '2v2-demo-bpt', name: '2v2 Demo — BPT', mode: 'BPT_2V2', hostId });

  for (const [tid, isSft] of [[sftId, true], [bptId, false]] as const) {
    for (const [i, tm] of teamIds.entries()) {
      const faction_ids = isSft && factions.length >= 8 ? [factions[i * 2].id, factions[i * 2 + 1].id] : [];
      await prisma.tournamentParticipant.upsert({
        where: { tournament_id_user_id: { tournament_id: tid, user_id: tm.captainId } },
        update: { team_id: tm.id, participant_type: 'TEAM', status: 'REGISTERED', deleted_at: null, faction_ids },
        create: {
          tournament_id: tid,
          user_id: tm.captainId,
          team_id: tm.id,
          participant_type: 'TEAM',
          status: 'REGISTERED',
          faction_ids,
        },
      });
    }
  }
  console.log('  ✓ 4 teams registered in each of "2v2-demo-sft" and "2v2-demo-bpt"');

  // Battle-type tile showcase: 1v1 Conquest + 1v1 Siege (no participants needed — they just
  // demonstrate the tile accents) and a combined 2v2 Siege (both markers on one tile).
  await ensureTournament({ slug: 'battle-demo-conquest', name: 'Battle Demo — Conquest', mode: 'BPT', hostId, competitorFormat: 'ONE_V_ONE', battleType: 'CONQUEST' });
  await ensureTournament({ slug: 'battle-demo-siege', name: 'Battle Demo — Siege', mode: 'BPT', hostId, competitorFormat: 'ONE_V_ONE', battleType: 'SIEGE' });
  const siege2v2 = await ensureTournament({ slug: '2v2-demo-siege', name: '2v2 Demo — Siege', mode: 'SFT_2V2', hostId, competitorFormat: 'TWO_V_TWO', battleType: 'SIEGE' });
  for (const [i, tm] of teamIds.entries()) {
    const faction_ids = factions.length >= 8 ? [factions[i * 2].id, factions[i * 2 + 1].id] : [];
    await prisma.tournamentParticipant.upsert({
      where: { tournament_id_user_id: { tournament_id: siege2v2, user_id: tm.captainId } },
      update: { team_id: tm.id, participant_type: 'TEAM', status: 'REGISTERED', deleted_at: null, faction_ids },
      create: { tournament_id: siege2v2, user_id: tm.captainId, team_id: tm.id, participant_type: 'TEAM', status: 'REGISTERED', faction_ids },
    });
  }
  console.log('  ✓ battle-type tiles: "Battle Demo — Conquest" / "— Siege" (1v1) + "2v2 Demo — Siege"');
  console.log('Done. Open the app; the tiles under Tournaments now show the type/2v2 markers.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
