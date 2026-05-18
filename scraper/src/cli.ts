#!/usr/bin/env node
/**
 * tww3-scraper — totaltavern.com Scraper-CLI
 *
 * RECHTLICHER STATUS: Der Scraper ist aktuell in CI deaktiviert (CI-Guard).
 * Die rechtliche Klärung für automatisiertes Scraping ist ausstehend.
 * Manuell ausführen nur für lokale Analyse.
 */
import { Command } from 'commander';
import cliProgress from 'cli-progress';
import { prisma } from '@rizzotto/db';
import { createHttpClient, logger } from './lib/http.js';
import { fetchFactions } from './scrapers/factions.js';
import { fetchTournamentRange } from './scrapers/tournament.js';

// CI-Guard: bauen ist OK, ausführen nicht.
if (process.env.CI) {
  console.error('tww3-scraper is disabled in CI. Manual execution only.');
  process.exit(0);
}

const program = new Command();
program
  .name('tww3-scraper')
  .description('totaltavern.com scraper for TWW3 tournament platform')
  .version('0.1.0');

program
  .command('factions')
  .description('Scrape faction statistics from totaltavern.com/factionstatistics')
  .option('--dry-run', 'Parse HTML but do not write to database', false)
  .option('--delay <ms>', 'Delay between requests in milliseconds (default: 2000)', '2000')
  .option('--verbose', 'Enable debug logging', false)
  .action(async (opts) => {
    if (opts.verbose) logger.level = 'debug';
    const delayMs = parseInt(opts.delay, 10);

    const importLog = await prisma.importLog.create({
      data: { source: 'totaltavern_factions', status: 'success', records_imported: 0 },
    });
    logger.info(`ImportLog ${importLog.id} started (factions)`);

    try {
      const http = createHttpClient({ delayMs });
      const rows = await fetchFactions(http);

      if (opts.dryRun) {
        logger.info(`Dry-run: parsed ${rows.length} factions, not writing to DB`);
        for (const r of rows.slice(0, 5)) logger.info(JSON.stringify(r));
        await prisma.importLog.update({
          where: { id: importLog.id },
          data: { status: 'success', records_imported: rows.length, finished_at: new Date() },
        });
        return;
      }

      // Real write path: upsert FactionStats rows into the active season.
      const activeSeason = await prisma.season.findFirst({ where: { is_active: true } });
      if (!activeSeason) {
        throw new Error('No active season — cannot import faction stats');
      }

      // Match by faction name (lookup id from Faction table)
      let written = 0;
      const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      bar.start(rows.length, 0);
      for (const row of rows) {
        const faction = await prisma.faction.findFirst({ where: { name: row.faction_name } });
        if (!faction) {
          logger.warn(`Faction not found: ${row.faction_name} — skipping`);
          bar.increment();
          continue;
        }
        await prisma.factionStats.upsert({
          where: { faction_id_season_id: { faction_id: faction.id, season_id: activeSeason.id } },
          create: {
            faction_id: faction.id,
            season_id: activeSeason.id,
            matches_played: row.matches_played ?? 0,
            wins: Math.round((row.matches_played ?? 0) * row.winrate),
            losses: (row.matches_played ?? 0) - Math.round((row.matches_played ?? 0) * row.winrate),
            draws: 0,
            pick_count: 0,
            ban_count: 0,
          },
          update: {
            matches_played: row.matches_played ?? undefined,
          },
        });
        written++;
        bar.increment();
      }
      bar.stop();

      await prisma.importLog.update({
        where: { id: importLog.id },
        data: { status: 'success', records_imported: written, finished_at: new Date() },
      });
      logger.info(`Factions import complete: ${written}/${rows.length} written`);
    } catch (err) {
      const msg = (err as Error).message;
      await prisma.importLog.update({
        where: { id: importLog.id },
        data: { status: 'error', error_message: msg, finished_at: new Date() },
      });
      logger.error(`Factions scrape failed: ${msg}`);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('tournaments')
  .description('Scrape a range of tournament pages from totaltavern.com/tournament/{id}')
  .requiredOption('--start-id <n>', 'First tournament ID', (v) => parseInt(v, 10))
  .requiredOption('--end-id <n>', 'Last tournament ID (inclusive)', (v) => parseInt(v, 10))
  .option('--dry-run', 'Parse HTML but do not write to database', false)
  .option('--delay <ms>', 'Delay between requests in milliseconds (default: 2000)', '2000')
  .option('--verbose', 'Enable debug logging', false)
  .action(async (opts) => {
    if (opts.verbose) logger.level = 'debug';
    const delayMs = parseInt(opts.delay, 10);

    const importLog = await prisma.importLog.create({
      data: { source: 'totaltavern_tournament', status: 'success', records_imported: 0 },
    });
    logger.info(`ImportLog ${importLog.id} started (tournaments ${opts.startId}..${opts.endId})`);

    try {
      const http = createHttpClient({ delayMs });
      const tournaments = await fetchTournamentRange(http, opts.startId, opts.endId);
      logger.info(`Fetched ${tournaments.length} tournaments`);

      if (opts.dryRun) {
        for (const t of tournaments) {
          logger.info(`  ${t.source_id}: "${t.name}" (${t.matches.length} matches)`);
        }
        await prisma.importLog.update({
          where: { id: importLog.id },
          data: { status: 'success', records_imported: tournaments.length, finished_at: new Date() },
        });
        return;
      }

      // Real-write path is deferred — would need a target schema (ExternalTournament-Model
      // doesn't exist). For now, dry-run is the supported mode.
      logger.warn('Tournament write-path not implemented — use --dry-run for now');
      await prisma.importLog.update({
        where: { id: importLog.id },
        data: {
          status: 'partial',
          records_imported: tournaments.length,
          finished_at: new Date(),
          error_message: 'write-path not implemented',
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      await prisma.importLog.update({
        where: { id: importLog.id },
        data: { status: 'error', error_message: msg, finished_at: new Date() },
      });
      logger.error(`Tournaments scrape failed: ${msg}`);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });

program.parseAsync();
