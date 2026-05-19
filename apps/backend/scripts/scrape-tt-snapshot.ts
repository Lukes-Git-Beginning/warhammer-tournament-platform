#!/usr/bin/env tsx
/**
 * scrape-tt-snapshot.ts — CLI-Script für den TT-Faction-Stats-Scraper
 *
 * Ausführen:
 *   pnpm scrape:tt
 *
 * Output:
 *   packages/db/prisma/seed-data/tt-faction-stats-snapshot-2026-05.json
 *
 * Kein DB-Touch — nur JSON-Export für spätere Verwendung in Welle B.3.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeTotalTavernFactionStats } from '../src/lib/tt-scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ziel-Pfad relativ zum Mono-Repo-Root
const OUTPUT_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'seed-data',
  'tt-faction-stats-snapshot-2026-05.json',
);

async function main(): Promise<void> {
  console.log('[scrape-tt-snapshot] Starting TotalTavern faction stats scrape …');
  console.log(`[scrape-tt-snapshot] Output: ${OUTPUT_PATH}`);

  const snapshot = await scrapeTotalTavernFactionStats(30_000);

  const globalCount = snapshot.global.length;
  const matchupKeys = Object.keys(snapshot.matchups);
  const totalMatchups = matchupKeys.reduce(
    (sum, key) => sum + (snapshot.matchups[key]?.length ?? 0),
    0,
  );

  // Output-Verzeichnis sicherstellen
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log('');
  console.log('[scrape-tt-snapshot] ✓ Done!');
  console.log(`  Factions (global): ${globalCount}`);
  console.log(`  Matchup keys:      ${matchupKeys.length}`);
  console.log(
    `  Total matchups:    ${totalMatchups} (expected: ${globalCount} × ${globalCount - 1} = ${globalCount * (globalCount - 1)})`,
  );
  console.log(`  Output written to: ${OUTPUT_PATH}`);

  // Sanity-Check
  if (globalCount === 0) {
    console.error('[scrape-tt-snapshot] WARNING: 0 factions scraped — check selectors!');
    process.exitCode = 1;
  } else if (totalMatchups === 0) {
    console.warn(
      '[scrape-tt-snapshot] WARNING: 0 matchups scraped — faction click may have failed.',
    );
  }
}

main().catch((err) => {
  console.error('[scrape-tt-snapshot] Fatal error:', err);
  process.exit(1);
});
