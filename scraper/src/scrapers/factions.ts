import * as cheerio from 'cheerio';
import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { logger } from '../lib/http.js';

export const FactionStatsSchema = z.object({
  faction_name: z.string().min(1),
  winrate: z.number().min(0).max(1),
  pick_rate: z.number().min(0).max(1).optional(),
  ban_rate: z.number().min(0).max(1).optional(),
  matches_played: z.number().int().nonnegative().optional(),
});
export type FactionStatsRow = z.infer<typeof FactionStatsSchema>;

/**
 * Parse HTML from totaltavern.com/factionstatistics into structured rows.
 *
 * Selectors are best-effort based on a plausible table layout:
 *   - table.faction-stats tbody tr  (primary)
 *   - tbody tr.faction-row          (alternate class variant)
 *   - .faction-stat-row             (card-style variant)
 *
 * Cell selectors tried in order: .faction-name / td.faction / td:nth-child(1)
 * for the name; .winrate / td.winrate for win-rate; etc.
 *
 * NOTE: Selector tuning will be required on the first real run against the live
 * site. Inspect the actual DOM and adjust selectors accordingly.
 *
 * Exported separately from `fetchFactions` so it can be unit-tested against
 * static HTML fixtures without any HTTP calls.
 */
export function parseFactionStatsHtml(html: string): FactionStatsRow[] {
  const $ = cheerio.load(html);
  const rows: FactionStatsRow[] = [];

  const tableRows = $(
    'table.faction-stats tbody tr, table tbody tr.faction-row, .faction-stat-row',
  );

  tableRows.each((_, el) => {
    const $row = $(el);

    const faction_name = $row
      .find('.faction-name, td.faction-name, td.faction')
      .first()
      .text()
      .trim();
    if (!faction_name) return;

    const winrateText = $row
      .find('.winrate, td.winrate, td.win-rate')
      .first()
      .text()
      .trim();
    const winrateNum = parseFloat(winrateText.replace('%', '')) / 100;
    if (!Number.isFinite(winrateNum)) return;

    const pickRateText = $row
      .find('.pick-rate, td.pick-rate, td.pickrate')
      .first()
      .text()
      .trim();
    const pickRateNum = pickRateText
      ? parseFloat(pickRateText.replace('%', '')) / 100
      : undefined;

    const banRateText = $row
      .find('.ban-rate, td.ban-rate, td.banrate')
      .first()
      .text()
      .trim();
    const banRateNum = banRateText
      ? parseFloat(banRateText.replace('%', '')) / 100
      : undefined;

    const matchesText = $row
      .find('.matches, td.matches, td.match-count')
      .first()
      .text()
      .trim();
    const matches = matchesText
      ? parseInt(matchesText.replace(/[,\s]/g, ''), 10)
      : undefined;

    const parsed = FactionStatsSchema.safeParse({
      faction_name,
      winrate: winrateNum,
      pick_rate: Number.isFinite(pickRateNum) ? pickRateNum : undefined,
      ban_rate: Number.isFinite(banRateNum) ? banRateNum : undefined,
      matches_played: matches !== undefined && !Number.isNaN(matches) ? matches : undefined,
    });

    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      logger.warn(
        `parseFactionStatsHtml: skipping row "${faction_name}" — ${parsed.error.message}`,
      );
    }
  });

  return rows;
}

/**
 * Fetches the factionstatistics page and parses it.
 * Returns the parsed rows.
 */
export async function fetchFactions(http: AxiosInstance): Promise<FactionStatsRow[]> {
  logger.info('Fetching totaltavern.com/factionstatistics');
  const resp = await http.get<string>('https://totaltavern.com/factionstatistics');
  if (resp.status !== 200) {
    throw new Error(`fetchFactions: HTTP ${resp.status}`);
  }
  const rows = parseFactionStatsHtml(resp.data);
  logger.info(`fetchFactions: parsed ${rows.length} factions`);
  return rows;
}
