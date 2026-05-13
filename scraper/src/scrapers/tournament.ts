/**
 * scraper/src/scrapers/tournament.ts — M5.3.4
 *
 * Cheerio-based parser for totaltavern.com/tournament/{id}.
 *
 * NOTE: Selectors are best-effort based on the expected HTML structure.
 * They MUST be verified and re-tuned on the first live run against the
 * real totaltavern.com site, as the actual markup may differ.
 *
 * Expected HTML structure (approximate):
 *   <h1 class="tournament-name">...</h1>
 *   <span class="tournament-format">...</span>
 *   <time class="tournament-start" datetime="...">...</time>
 *   <ul class="participants">
 *     <li class="participant">Player Name</li>...
 *   </ul>
 *   <table class="matches">
 *     <tbody>
 *       <tr class="match" data-round="1">
 *         <td class="player1"><span class="name">...</span><span class="faction">...</span></td>
 *         <td class="player2"><span class="name">...</span><span class="faction">...</span></td>
 *         <td class="score">2-0</td>
 *         <td class="winner">...</td>
 *       </tr>
 *     </tbody>
 *   </table>
 */

import * as cheerio from 'cheerio';
import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { logger } from '../lib/http.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const TournamentMatchSchema = z.object({
  round: z.number().int().positive(),
  player1_name: z.string(),
  player2_name: z.string(),
  player1_faction: z.string().optional(),
  player2_faction: z.string().optional(),
  winner_name: z.string().nullable(), // null on draw
  score: z.string().optional(),       // e.g. "2-0"
});
export type TournamentMatchRow = z.infer<typeof TournamentMatchSchema>;

export const TournamentScrapeSchema = z.object({
  source_id: z.string(),              // totaltavern tournament ID
  name: z.string().min(1),
  format: z.string().optional(),
  start_date: z.string().optional(),  // ISO-string, parsed best-effort
  participants: z.array(z.string()),  // player names
  matches: z.array(TournamentMatchSchema),
});
export type TournamentScrape = z.infer<typeof TournamentScrapeSchema>;

// ---------------------------------------------------------------------------
// HTML parser
// ---------------------------------------------------------------------------

/**
 * Parse a tournament-detail HTML page from totaltavern.com into structured data.
 *
 * @param html     Raw HTML string of the tournament page.
 * @param sourceId The totaltavern tournament ID (used as source_id).
 */
export function parseTournamentHtml(html: string, sourceId: string): TournamentScrape {
  const $ = cheerio.load(html);

  // --- Metadata ---
  const name = $('h1.tournament-name, .tournament-title h1, h1').first().text().trim();

  const format =
    $('.tournament-format, span.format, .format').first().text().trim() || undefined;

  // Prefer datetime attribute; fall back to text content for date strings
  const $time = $('time.tournament-start, time.start, time').first();
  const startDateRaw = $time.attr('datetime') ?? $time.text().trim();
  let start_date: string | undefined;
  if (startDateRaw) {
    const d = new Date(startDateRaw);
    start_date = isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  // --- Participants ---
  const participants: string[] = [];
  $(
    '.participants .participant, ul.participants li, ol.participants li, .player-list .player, .participant-list li',
  ).each((_, el) => {
    const text = $(el).text().trim();
    if (text) participants.push(text);
  });

  // --- Matches ---
  const matches: TournamentMatchRow[] = [];

  $('table.matches tbody tr, .matches-table tbody tr, tr.match, .match-row').each((_, el) => {
    const $row = $(el);

    // Round: prefer data-round attribute, then a dedicated .round cell
    const roundAttr = $row.attr('data-round');
    const roundText = roundAttr ?? $row.find('.round, td.round').first().text().trim();
    const round = parseInt(roundText || '1', 10);
    const safeRound = isNaN(round) || round < 1 ? 1 : round;

    // Player names: first try nested .name span, then the whole cell text
    const player1_name = (
      $row.find('.player1 .name, td.player1 .name').first().text().trim() ||
      $row.find('td.player1').first().text().trim()
    );
    const player2_name = (
      $row.find('.player2 .name, td.player2 .name').first().text().trim() ||
      $row.find('td.player2').first().text().trim()
    );

    // Skip rows without both players (e.g. header rows)
    if (!player1_name || !player2_name) return;

    const player1_faction =
      $row.find('.player1 .faction, td.player1 .faction').first().text().trim() || undefined;
    const player2_faction =
      $row.find('.player2 .faction, td.player2 .faction').first().text().trim() || undefined;

    const score =
      $row.find('.score, td.score').first().text().trim() || undefined;

    const winner_name_raw = $row.find('.winner, td.winner').first().text().trim();
    // Treat empty string, "-", "Draw", "draw", "TIE" as no winner (null)
    const winner_name =
      winner_name_raw && !/^(-|draw|tie)$/i.test(winner_name_raw) ? winner_name_raw : null;

    const parsed = TournamentMatchSchema.safeParse({
      round: safeRound,
      player1_name,
      player2_name,
      player1_faction,
      player2_faction,
      winner_name,
      score,
    });

    if (parsed.success) {
      matches.push(parsed.data);
    } else {
      logger.warn(`parseTournamentHtml: skipping match row — ${parsed.error.message}`);
    }
  });

  const result = TournamentScrapeSchema.parse({
    source_id: sourceId,
    name: name || `Tournament ${sourceId}`,
    format,
    start_date,
    participants,
    matches,
  });

  logger.debug(
    `parseTournamentHtml: id=${sourceId} name="${result.name}" ` +
    `participants=${result.participants.length} matches=${result.matches.length}`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a single tournament page by id and returns parsed data.
 */
export async function fetchTournament(
  http: AxiosInstance,
  tournamentId: number | string,
): Promise<TournamentScrape> {
  logger.info(`Fetching totaltavern.com/tournament/${tournamentId}`);
  const resp = await http.get(`https://totaltavern.com/tournament/${tournamentId}`);
  if (resp.status !== 200) {
    throw new Error(`fetchTournament: HTTP ${resp.status} for id=${tournamentId}`);
  }
  const parsed = parseTournamentHtml(resp.data as string, String(tournamentId));
  logger.info(
    `fetchTournament: ${tournamentId} → "${parsed.name}", ` +
    `${parsed.participants.length} participants, ${parsed.matches.length} matches`,
  );
  return parsed;
}

/**
 * Fetches tournaments for IDs in [startId, endId] (inclusive).
 * Successful results are collected; per-ID errors are logged and skipped.
 */
export async function fetchTournamentRange(
  http: AxiosInstance,
  startId: number,
  endId: number,
): Promise<TournamentScrape[]> {
  const results: TournamentScrape[] = [];
  for (let id = startId; id <= endId; id++) {
    try {
      const t = await fetchTournament(http, id);
      results.push(t);
    } catch (err) {
      logger.error(`fetchTournamentRange: failed for id=${id} — ${(err as Error).message}`);
    }
  }
  return results;
}
