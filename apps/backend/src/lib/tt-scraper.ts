/**
 * tt-scraper.ts — Playwright-Headless-Crawler für totaltavern.com/factionstatistics
 *
 * Erzeugt einen JSON-Snapshot (TTSnapshot) mit:
 *   - global: globale Faction-Win-Rate-Tabelle (17 Factions)
 *   - matchups: Per-Faction-Matchup-Matrix (17×16 Einträge)
 *
 * Output wird in packages/db/prisma/seed-data/ geschrieben (via scrape-tt-snapshot.ts).
 * Kein DB-Touch in dieser Datei — nur Scraping + Parsing.
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';

export interface TTGlobalRow {
  faction: string;
  wins: number;
  losses: number;
  win_rate: number; // 0.0–1.0
}

export interface TTMatchupRow {
  vs_faction: string;
  wins: number;
  losses: number;
  win_rate: number; // 0.0–1.0
}

export interface TTSnapshot {
  scraped_at: string; // ISO 8601
  source_url: string;
  global: TTGlobalRow[];
  matchups: Record<string, TTMatchupRow[]>;
}

const SOURCE_URL = 'https://totaltavern.com/factionstatistics';

/** Wartet bis mindestens eine <table> mit tbody-Zeilen sichtbar ist. */
async function waitForTable(page: Page, timeout = 30_000): Promise<void> {
  // Browser-side callback — document is available in the browser context.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  await page.waitForFunction(
    /* istanbul ignore next */
    // @ts-expect-error – executes in browser context where `document` is defined
    () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const tables = (globalThis as any).document.querySelectorAll('table');
      for (const t of tables) {
        if ((t as any).querySelectorAll('tbody tr').length > 0) return true;
      }
      return false;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    { timeout },
  );
}

/**
 * Liest alle Zeilen aus der n-ten sichtbaren Tabelle.
 * Gibt pro Zeile ein Objekt { cells: string[] } zurück.
 */
async function extractTableRows(page: Page, tableIndex: number): Promise<{ cells: string[] }[]> {
  return page.evaluate(
    /* istanbul ignore next */
    // @ts-expect-error – executes in browser context where `document` is defined
    ([idx]: [number]) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const tables = (globalThis as any).document.querySelectorAll('table');
      let current = 0;
      for (const t of tables) {
        const rows = Array.from((t as any).querySelectorAll('tbody tr'));
        if ((rows as any[]).length === 0) continue;
        if (current === idx) {
          return (rows as any[]).map((row: any) => ({
            cells: Array.from((row as any).querySelectorAll('td')).map((td: any) =>
              (td as any).innerText.trim(),
            ),
          }));
        }
        current++;
      }
      return [];
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    [tableIndex] as [number],
  ) as Promise<{ cells: string[] }[]>;
}

/** Parsed Win-Rate-String ("57%", "0.57", "57.3 %") zu einer Dezimalzahl 0–1. */
function parseWinRate(raw: string): number {
  const cleaned = raw.replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;
  return num > 1 ? num / 100 : num;
}

/** Parsed eine Zahl aus einem String — gibt 0 zurück bei Fehler. */
function parseCount(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Inferiert Wins/Losses aus Win-Rate + Total wenn keine separaten Spalten vorhanden.
 */
function inferWinsLosses(
  winRate: number,
  total: number,
): { wins: number; losses: number } {
  const wins = Math.round(total * winRate);
  return { wins, losses: total - wins };
}

/**
 * Parsed eine Tabellenzeile.
 *
 * TotalTavern-Layout-Varianten (aus Vor-Recherche):
 *   Variante A (4 Spalten): faction | wins | losses | win%
 *   Variante B (3 Spalten): faction | total | win%
 *   Variante C (2 Spalten): faction | win%
 */
function parseGlobalRow(cells: string[]): TTGlobalRow | null {
  if (cells.length < 2) return null;

  const faction = (cells[0] ?? '').trim();
  if (!faction) return null;

  let wins: number;
  let losses: number;
  let win_rate: number;

  if (cells.length >= 4) {
    wins = parseCount(cells[1] ?? '');
    losses = parseCount(cells[2] ?? '');
    const rawRate = parseWinRate(cells[3] ?? '');
    win_rate = rawRate === 0 && wins + losses > 0 ? wins / (wins + losses) : rawRate;
  } else if (cells.length === 3) {
    const total = parseCount(cells[1] ?? '');
    win_rate = parseWinRate(cells[2] ?? '');
    const inferred = inferWinsLosses(win_rate, total);
    wins = inferred.wins;
    losses = inferred.losses;
  } else {
    wins = 0;
    losses = 0;
    win_rate = parseWinRate(cells[1] ?? '');
  }

  return { faction, wins, losses, win_rate };
}

function parseMatchupRow(cells: string[]): TTMatchupRow | null {
  const globalRow = parseGlobalRow(cells);
  if (!globalRow) return null;
  return {
    vs_faction: globalRow.faction,
    wins: globalRow.wins,
    losses: globalRow.losses,
    win_rate: globalRow.win_rate,
  };
}

/**
 * Versucht, ein Faction-Element in der ersten Tabelle anzuklicken.
 * Gibt true zurück, wenn ein klickbares Element gefunden wurde.
 */
async function clickFaction(page: Page, factionName: string): Promise<boolean> {
  return page.evaluate(
    /* istanbul ignore next */
    // @ts-expect-error – executes in browser context where `document` is defined
    ([name]: [string]) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // Versuche <a>, <button>, <td> mit exaktem Text in Tabellen
      const selectors = ['table a', 'table button', 'table td', 'a', 'button', '[role="button"]'];
      for (const sel of selectors) {
        const els = (globalThis as any).document.querySelectorAll(sel);
        for (const el of els) {
          if ((el as any).textContent?.trim() === name) {
            (el as any).click();
            return true;
          }
        }
      }
      return false;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    [factionName] as [string],
  ) as Promise<boolean>;
}

/**
 * Hauptfunktion: Scrapet totaltavern.com/factionstatistics mit Playwright Chromium.
 *
 * Ablauf:
 * 1. Seite laden, auf globale Tabelle warten
 * 2. Alle Faction-Zeilen extrahieren → global[]
 * 3. Für jede Faction: auf Link klicken, Matchup-Tabelle auslesen → matchups[faction]
 */
export async function scrapeTotalTavernFactionStats(timeoutMs = 30_000): Promise<TTSnapshot> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`[tt-scraper] Navigating to ${SOURCE_URL} …`);
    await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 60_000 });

    // Auf erste Tabelle warten
    await waitForTable(page, timeoutMs);

    // Globale Tabelle extrahieren (tableIndex 0 = erste Tabelle)
    const rawGlobalRows = await extractTableRows(page, 0);
    const global: TTGlobalRow[] = rawGlobalRows
      .map((r) => parseGlobalRow(r.cells))
      .filter((r): r is TTGlobalRow => r !== null);

    console.log(`[tt-scraper] Global table: ${global.length} factions parsed`);

    const matchups: Record<string, TTMatchupRow[]> = {};

    // Für jede Faction den Matchup-Table laden
    for (const factionRow of global) {
      const factionName = factionRow.faction;

      try {
        console.log(`[tt-scraper] Clicking faction: ${factionName}`);

        const clicked = await clickFaction(page, factionName);

        if (!clicked) {
          console.warn(
            `[tt-scraper] Could not find clickable element for "${factionName}" — skipping matchups`,
          );
          matchups[factionName] = [];
          continue;
        }

        // Warten bis zweite Tabelle existiert und Zeilen hat
        await page
          .waitForFunction(
            /* istanbul ignore next */
            // @ts-expect-error – executes in browser context where `document` is defined
            () => {
              /* eslint-disable @typescript-eslint/no-explicit-any */
              const tables = (globalThis as any).document.querySelectorAll('table');
              let idx = 0;
              for (const t of tables) {
                const rows = (t as any).querySelectorAll('tbody tr');
                if ((rows as any).length === 0) continue;
                if (idx === 1) return (rows as any).length > 0;
                idx++;
              }
              return false;
              /* eslint-enable @typescript-eslint/no-explicit-any */
            },
            { timeout: timeoutMs },
          )
          .catch(() => {
            // Timeout ist OK — Seite hat vielleicht nur eine Tabelle
          });

        // Kurze Pause für React-State-Rendering
        await page.waitForTimeout(500);

        // Matchup-Tabelle = zweite sichtbare Tabelle (tableIndex 1)
        const rawMatchupRows = await extractTableRows(page, 1);
        const factionMatchups: TTMatchupRow[] = rawMatchupRows
          .map((r) => parseMatchupRow(r.cells))
          .filter((r): r is TTMatchupRow => r !== null);

        matchups[factionName] = factionMatchups;
        console.log(`[tt-scraper]   → ${factionMatchups.length} matchups`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[tt-scraper] Error for faction "${factionName}": ${msg}`);
        matchups[factionName] = [];
      }
    }

    const snapshot: TTSnapshot = {
      scraped_at: new Date().toISOString(),
      source_url: SOURCE_URL,
      global,
      matchups,
    };

    return snapshot;
  } finally {
    await browser.close();
  }
}
