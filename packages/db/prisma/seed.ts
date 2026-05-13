// Seed script — idempotent. Runs the canonical TWW3 24-faction reference list
// plus a default "Open Season" so M2 leaderboard work has a parent row.
//
// Invoke via `pnpm db:seed` (which runs `tsx prisma/seed.ts`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, FactionCategory, Role } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

interface FactionSeed {
  id: string;
  name: string;
  race: string;
  category: FactionCategory;
  color_hex: string;
  display_order: number;
  icon_url: string;
}

// 24 factions validated against Steam Community Guide (id=3241235739) and Wargamer.com.
// icon_url points to SVG placeholders in apps/frontend/public/icons/factions/<id>.svg
// TODO: replace placeholder SVGs with actual faction artwork before production launch.
const FACTIONS: FactionSeed[] = [
  // ORDER (7)
  { id: 'empire',           name: 'Empire',            race: 'Human',       category: FactionCategory.ORDER,       color_hex: '#FFCC00', display_order: 1,  icon_url: '/icons/factions/empire.svg' },
  { id: 'bretonnia',        name: 'Bretonnia',         race: 'Human',       category: FactionCategory.ORDER,       color_hex: '#1A4FA0', display_order: 2,  icon_url: '/icons/factions/bretonnia.svg' },
  { id: 'kislev',           name: 'Kislev',            race: 'Human',       category: FactionCategory.ORDER,       color_hex: '#4AA8D8', display_order: 3,  icon_url: '/icons/factions/kislev.svg' },
  { id: 'grand_cathay',     name: 'Grand Cathay',      race: 'Human',       category: FactionCategory.ORDER,       color_hex: '#C8102E', display_order: 4,  icon_url: '/icons/factions/grand_cathay.svg' },
  { id: 'dwarfs',           name: 'Dwarfs',            race: 'Dwarf',       category: FactionCategory.ORDER,       color_hex: '#B8860B', display_order: 5,  icon_url: '/icons/factions/dwarfs.svg' },
  { id: 'high_elves',       name: 'High Elves',        race: 'High Elf',    category: FactionCategory.ORDER,       color_hex: '#4169E1', display_order: 6,  icon_url: '/icons/factions/high_elves.svg' },
  { id: 'lizardmen',        name: 'Lizardmen',         race: 'Lizardman',   category: FactionCategory.ORDER,       color_hex: '#2E8B57', display_order: 7,  icon_url: '/icons/factions/lizardmen.svg' },

  // DESTRUCTION (6)
  { id: 'greenskins',       name: 'Greenskins',        race: 'Orc',         category: FactionCategory.DESTRUCTION, color_hex: '#4A7C2F', display_order: 8,  icon_url: '/icons/factions/greenskins.svg' },
  { id: 'dark_elves',       name: 'Dark Elves',        race: 'Dark Elf',    category: FactionCategory.DESTRUCTION, color_hex: '#6A0DAD', display_order: 9,  icon_url: '/icons/factions/dark_elves.svg' },
  { id: 'skaven',           name: 'Skaven',            race: 'Skaven',      category: FactionCategory.DESTRUCTION, color_hex: '#8B8000', display_order: 10, icon_url: '/icons/factions/skaven.svg' },
  { id: 'norsca',           name: 'Norsca',            race: 'Norscan',     category: FactionCategory.DESTRUCTION, color_hex: '#5F7F9F', display_order: 11, icon_url: '/icons/factions/norsca.svg' },
  { id: 'ogre_kingdoms',    name: 'Ogre Kingdoms',     race: 'Ogre',        category: FactionCategory.DESTRUCTION, color_hex: '#C2956C', display_order: 12, icon_url: '/icons/factions/ogre_kingdoms.svg' },
  { id: 'beastmen',         name: 'Beastmen',          race: 'Beastman',    category: FactionCategory.DESTRUCTION, color_hex: '#5C4A1E', display_order: 13, icon_url: '/icons/factions/beastmen.svg' },

  // CHAOS GODS / CHAOS-ALIGNED (7)
  { id: 'khorne',           name: 'Khorne',            race: 'Daemon',      category: FactionCategory.CHAOS_GODS,  color_hex: '#8B0000', display_order: 14, icon_url: '/icons/factions/khorne.svg' },
  { id: 'nurgle',           name: 'Nurgle',            race: 'Daemon',      category: FactionCategory.CHAOS_GODS,  color_hex: '#4A6741', display_order: 15, icon_url: '/icons/factions/nurgle.svg' },
  { id: 'tzeentch',         name: 'Tzeentch',          race: 'Daemon',      category: FactionCategory.CHAOS_GODS,  color_hex: '#1B6CA8', display_order: 16, icon_url: '/icons/factions/tzeentch.svg' },
  { id: 'slaanesh',         name: 'Slaanesh',          race: 'Daemon',      category: FactionCategory.CHAOS_GODS,  color_hex: '#D4689A', display_order: 17, icon_url: '/icons/factions/slaanesh.svg' },
  { id: 'daemons_of_chaos', name: 'Daemons of Chaos',  race: 'Daemon',      category: FactionCategory.CHAOS_GODS,  color_hex: '#7B2FBE', display_order: 18, icon_url: '/icons/factions/daemons_of_chaos.svg' },
  { id: 'warriors_of_chaos',name: 'Warriors of Chaos', race: 'Human',       category: FactionCategory.CHAOS_GODS,  color_hex: '#3D3D3D', display_order: 19, icon_url: '/icons/factions/warriors_of_chaos.svg' },
  { id: 'chaos_dwarfs',     name: 'Chaos Dwarfs',      race: 'Chaos Dwarf', category: FactionCategory.CHAOS_GODS,  color_hex: '#B03010', display_order: 20, icon_url: '/icons/factions/chaos_dwarfs.svg' },

  // UNDEAD / NEUTRAL (4)
  { id: 'vampire_counts',   name: 'Vampire Counts',    race: 'Undead',      category: FactionCategory.UNDEAD,      color_hex: '#6B0F1A', display_order: 21, icon_url: '/icons/factions/vampire_counts.svg' },
  { id: 'vampire_coast',    name: 'Vampire Coast',     race: 'Undead',      category: FactionCategory.UNDEAD,      color_hex: '#1A5276', display_order: 22, icon_url: '/icons/factions/vampire_coast.svg' },
  { id: 'tomb_kings',       name: 'Tomb Kings',        race: 'Undead',      category: FactionCategory.UNDEAD,      color_hex: '#C8A800', display_order: 23, icon_url: '/icons/factions/tomb_kings.svg' },
  { id: 'wood_elves',       name: 'Wood Elves',        race: 'Wood Elf',    category: FactionCategory.DEFAULT,     color_hex: '#228B22', display_order: 24, icon_url: '/icons/factions/wood_elves.svg' },
];

async function seedFactions(): Promise<void> {
  const result = await prisma.faction.createMany({
    data: FACTIONS,
    skipDuplicates: true,
  });
  console.log(`  ✓ Factions: ${result.count} created (${FACTIONS.length - result.count} already existed)`);
}

async function seedDefaultSeason(): Promise<void> {
  const existing = await prisma.season.findFirst({ where: { is_active: true } });
  if (existing) {
    console.log(`  ✓ Active season already exists: "${existing.name}" (${existing.id})`);
    return;
  }
  const now = new Date();
  const endOfYear = new Date(now.getFullYear(), 11, 31);
  const season = await prisma.season.create({
    data: {
      name: `Season ${now.getFullYear()}`,
      start_date: now,
      end_date: endOfYear,
      is_active: true,
    },
  });
  console.log(`  ✓ Default season created: "${season.name}" (${season.id})`);
}

const SYSTEM_DISCORD_ID = 'system-tww3';

async function seedSystemUser(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { discord_id: SYSTEM_DISCORD_ID } });
  if (existing) {
    console.log(`  ✓ System user already exists (${existing.id})`);
    return existing.id;
  }
  const sys = await prisma.user.create({
    data: {
      discord_id: SYSTEM_DISCORD_ID,
      username: 'system',
      role: Role.ADMIN,
    },
  });
  console.log(`  ✓ System user created (${sys.id})`);
  return sys.id;
}

const ALL_DEFAULT_CATEGORY = { category_name: 'default', factions: [] as string[], max_picks: null, max_bans: null };

interface SeedPreset {
  slug: string; // synthetic identifier — we match by name for idempotency
  name: string;
  description: string;
  turn_seconds: number;
  category_limits: typeof ALL_DEFAULT_CATEGORY[];
  turns: Array<{
    order: number;
    actor: 'host' | 'guest' | 'admin';
    action: 'pick' | 'ban' | 'snipe' | 'steal' | 'reveal_picks' | 'reveal_bans' | 'reveal_all';
    variant: 'global' | 'exclusive' | 'nonexclusive' | null;
    is_hidden: boolean;
    is_parallel: boolean;
    as_opponent: boolean;
    category: string;
  }>;
}

const SEED_PRESETS: SeedPreset[] = [
  {
    slug: 'standard_1v1',
    name: 'Standard 1v1',
    description: 'Klassische Ban-Ban-Pick-Pick-Sequenz. Host bannt zuerst, dann Picks im Wechsel.',
    turn_seconds: 30,
    category_limits: [],
    turns: [
      { order: 1, actor: 'host',  action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 2, actor: 'guest', action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 3, actor: 'host',  action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 4, actor: 'guest', action: 'pick', variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    ],
  },
  {
    slug: 'captains_mode_classic',
    name: "Captain's Mode Classic",
    description: 'Versteckte Anfangs-Picks, dann Reveal, dann Bans basierend auf Gegner-Pick, final ein zweiter Pick. Spannungsbogen wie aoe2cm.net.',
    turn_seconds: 30,
    category_limits: [],
    turns: [
      { order: 1, actor: 'host',  action: 'pick', variant: 'exclusive', is_hidden: true,  is_parallel: true,  as_opponent: false, category: 'default' },
      { order: 2, actor: 'guest', action: 'pick', variant: 'exclusive', is_hidden: true,  is_parallel: true,  as_opponent: false, category: 'default' },
      { order: 3, actor: 'admin', action: 'reveal_picks', variant: null, is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 4, actor: 'host',  action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 5, actor: 'guest', action: 'ban',  variant: 'global', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 6, actor: 'host',  action: 'pick', variant: 'exclusive', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
      { order: 7, actor: 'guest', action: 'pick', variant: 'exclusive', is_hidden: false, is_parallel: false, as_opponent: false, category: 'default' },
    ],
  },
];

async function seedDraftPresets(systemUserId: string): Promise<void> {
  let created = 0;
  let existed = 0;
  for (const preset of SEED_PRESETS) {
    const existing = await prisma.draftPreset.findFirst({
      where: { name: preset.name, created_by: systemUserId },
      select: { id: true },
    });
    if (existing) {
      existed += 1;
      continue;
    }
    await prisma.draftPreset.create({
      data: {
        name: preset.name,
        description: preset.description,
        created_by: systemUserId,
        is_public: true,
        category_limits: preset.category_limits,
        turns: preset.turns,
        turn_seconds: preset.turn_seconds,
      },
    });
    created += 1;
  }
  console.log(`  ✓ DraftPresets: ${created} created, ${existed} already existed`);
}

async function main(): Promise<void> {
  console.log('Seeding database…');
  await seedFactions();
  await seedDefaultSeason();
  const systemUserId = await seedSystemUser();
  await seedDraftPresets(systemUserId);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
