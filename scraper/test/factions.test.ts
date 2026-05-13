import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFactionStatsHtml } from '../src/scrapers/factions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures/factions.html');

describe('parseFactionStatsHtml', () => {
  it('parses faction rows from a typical totaltavern.com HTML structure', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const rows = parseFactionStatsHtml(html);

    expect(rows.length).toBeGreaterThanOrEqual(3);

    const empire = rows.find((r) => r.faction_name === 'The Empire');
    expect(empire).toBeDefined();
    expect(empire!.winrate).toBeCloseTo(0.524, 3);
    expect(empire!.pick_rate).toBeCloseTo(0.152, 3);
    expect(empire!.ban_rate).toBeCloseTo(0.081, 3);
    expect(empire!.matches_played).toBe(1234);
  });

  it('parses all 5 fixture rows', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const rows = parseFactionStatsHtml(html);
    expect(rows).toHaveLength(5);

    const chaos = rows.find((r) => r.faction_name === 'Chaos Warriors');
    expect(chaos).toBeDefined();
    expect(chaos!.winrate).toBeCloseTo(0.558, 3);
    expect(chaos!.matches_played).toBe(1456);
  });

  it('returns empty array for HTML with no matching table', () => {
    expect(parseFactionStatsHtml('<html><body><p>Nothing here.</p></body></html>')).toEqual([]);
  });

  it('skips rows with missing faction_name', () => {
    const html = `
      <table class="faction-stats">
        <tbody>
          <tr><td class="faction"></td><td class="winrate">50%</td></tr>
        </tbody>
      </table>`;
    expect(parseFactionStatsHtml(html)).toEqual([]);
  });

  it('skips rows with non-numeric winrate', () => {
    const html = `
      <table class="faction-stats">
        <tbody>
          <tr><td class="faction">Beastmen</td><td class="winrate">n/a</td></tr>
        </tbody>
      </table>`;
    expect(parseFactionStatsHtml(html)).toEqual([]);
  });

  it('handles rows without optional fields gracefully', () => {
    const html = `
      <table class="faction-stats">
        <tbody>
          <tr><td class="faction">High Elves</td><td class="winrate">50.0%</td></tr>
        </tbody>
      </table>`;
    const rows = parseFactionStatsHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.faction_name).toBe('High Elves');
    expect(rows[0]!.winrate).toBeCloseTo(0.5, 3);
    expect(rows[0]!.pick_rate).toBeUndefined();
    expect(rows[0]!.matches_played).toBeUndefined();
  });
});
