import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTournamentHtml } from '../src/scrapers/tournament.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures/tournament.html');

describe('parseTournamentHtml', () => {
  it('extracts tournament metadata and matches from a typical totaltavern.com page', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const t = parseTournamentHtml(html, '42');

    expect(t.source_id).toBe('42');
    expect(t.name).toBe('Spring Cup 2026');
    expect(t.format).toBe('SINGLE_ELIMINATION');
    expect(t.start_date).toBe('2026-03-15T10:00:00.000Z');
    expect(t.participants).toEqual(['Alice', 'Bob', 'Charlie', 'Dana']);

    expect(t.matches).toHaveLength(3);
    expect(t.matches[0]).toMatchObject({
      round: 1,
      player1_name: 'Alice',
      player2_name: 'Bob',
      player1_faction: 'The Empire',
      player2_faction: 'Greenskins',
      winner_name: 'Alice',
      score: '2-0',
    });
  });

  it('returns empty matches array for unparseable HTML', () => {
    const t = parseTournamentHtml('<html><body></body></html>', '99');
    expect(t.matches).toEqual([]);
    expect(t.name).toBe('Tournament 99'); // fallback when no h1
  });

  it('sets winner_name to null for draw markers', () => {
    const html = `
      <html><body>
        <h1 class="tournament-name">Draw Test Cup</h1>
        <table class="matches"><tbody>
          <tr class="match" data-round="1">
            <td class="player1"><span class="name">Alice</span></td>
            <td class="player2"><span class="name">Bob</span></td>
            <td class="score">1-1</td>
            <td class="winner">-</td>
          </tr>
        </tbody></table>
      </body></html>
    `;
    const t = parseTournamentHtml(html, '7');
    expect(t.matches[0]?.winner_name).toBeNull();
  });

  it('handles second match in final round correctly', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const t = parseTournamentHtml(html, '42');
    const final = t.matches[2];
    expect(final).toMatchObject({
      round: 2,
      player1_name: 'Alice',
      player2_name: 'Dana',
      winner_name: 'Alice',
    });
  });
});
