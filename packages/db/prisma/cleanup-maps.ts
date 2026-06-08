// One-time script: reverts the map pool from 86 back to the original 36 maps,
// fixes wrong names/slugs, and soft-deletes everything outside the canonical pool.
//
// Run: pnpm -F @rizzotto/db tsx prisma/cleanup-maps.ts

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

// Final 36 canonical slugs after corrections.
const KEEP_SLUGS = [
  'altar-of-the-champion',
  'aracknarock-lair',
  'battle-for-itza',
  'blazing-ramparts',
  'bleakspire-labor-camp',
  'bordeleaux-landing',
  'bray-valley',
  'celestial-lake',
  'chateau-de-roquefort',
  'creeping-swamp',
  'crystal-lake',
  'decrepit-moor',
  'dried-floodplain',
  'dunes-of-khaine',
  'dustbowl',
  'eastern-isle-colony',
  'edge-of-the-darkwood',
  'glade-of-the-everqueen',
  'glinty-toofs-crag',
  'hashuts-oilfields',
  'haunted-vale',
  'imperial-ambush',
  'imperial-road',
  'jade-tomb',
  'khsars-cursed-oasis',
  'lost-temple-of-sotek',
  'norscan-rise',
  'proving-grounds',
  'putrefying-carcass',
  'rapturous-expanse',
  'rifts-at-worlds-edge',
  'road-to-talabheim',
  'skjalandirs-cave',
  'the-changers-madhouse',
  'the-blood-grove',
  'whirling-maelstrom',
];

async function main(): Promise<void> {
  console.log('Map cleanup starting…');

  // Step 1: Copy the imgur image from expansion records that have a different slug
  // to the original records that have the correct slug (but may lack an image).

  const bleakspireExpansion = await prisma.map.findUnique({ where: { slug: 'bleakspire-labour-camp' } });
  if (bleakspireExpansion?.image_url) {
    await prisma.map.update({
      where: { slug: 'bleakspire-labor-camp' },
      data: { image_url: bleakspireExpansion.image_url },
    });
    console.log('  ✓ Copied image to bleakspire-labor-camp');
  }

  const blazingExpansion = await prisma.map.findUnique({ where: { slug: 'the-blazing-ramparts' } });
  if (blazingExpansion?.image_url) {
    await prisma.map.update({
      where: { slug: 'blazing-ramparts' },
      data: { image_url: blazingExpansion.image_url },
    });
    console.log('  ✓ Copied image to blazing-ramparts');
  }

  // Step 2: Rename rift-at-worlds-edge → rifts-at-worlds-edge and copy its image.
  // Must happen before the soft-delete pass so the old slug isn't caught by NOT IN.

  const riftsExpansion = await prisma.map.findUnique({ where: { slug: 'rift-at-the-worlds-edge' } });
  const riftsOriginal = await prisma.map.findUnique({ where: { slug: 'rift-at-worlds-edge' } });
  if (riftsOriginal) {
    await prisma.map.update({
      where: { slug: 'rift-at-worlds-edge' },
      data: {
        slug: 'rifts-at-worlds-edge',
        name: "Rifts at World's Edge",
        image_url: riftsExpansion?.image_url ?? riftsOriginal.image_url,
      },
    });
    console.log("  ✓ Renamed rift-at-worlds-edge → rifts-at-worlds-edge");
  }

  // Step 3: Soft-delete all active maps not in the canonical 36.
  // This catches: old wrong-slug records (glades-of-the-everqueen, skjlanadirs-cave,
  // itza, bleakspire-labour-camp, rift-at-the-worlds-edge, the-blazing-ramparts)
  // plus all 50 expansion-only maps.

  const result = await prisma.map.updateMany({
    where: { slug: { notIn: KEEP_SLUGS }, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  console.log(`  ✓ Soft-deleted ${result.count} maps outside the canonical pool`);

  const active = await prisma.map.count({ where: { deleted_at: null } });
  console.log(`  ✓ Active maps remaining: ${active} (expected 35 — battle-for-itza created by seed)`);
  console.log('Done. Run pnpm db:seed next to upsert the corrected 36-map set.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
