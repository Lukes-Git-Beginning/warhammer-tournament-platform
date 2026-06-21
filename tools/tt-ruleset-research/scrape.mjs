/**
 * Total Tavern Tournament Scraper
 *
 * Scrapes tournament descriptions from totaltavern.com using Playwright
 * (renders JavaScript — WebFetch can't handle this site).
 *
 * Usage:
 *   node scrape.mjs
 *
 * Requires Playwright to be installed. Run from the apps/e2e directory
 * (where @playwright/test is installed) or install globally:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Output: data/totaltavern-rules.json
 *
 * To scrape a different range, adjust START and END below.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const START = 3500;
const END   = 3567;
const BASE  = 'https://totaltavern.com/tournament';
const OUT   = join(__dirname, 'data', 'totaltavern-rules.json');

async function scrapeTournament(page, id) {
  const url = `${BASE}/${id}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });

    const name = await page
      .locator('h1, [class*="tournament-name"], [class*="title"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null);

    const descSelectors = [
      '[class*="description"]', '[class*="rules"]', '[class*="about"]',
      '[class*="Details"]', '[class*="details"]', '[id*="description"]', '[id*="rules"]',
    ];

    let description = null;
    for (const sel of descSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        const text = await el.textContent({ timeout: 3_000 }).catch(() => null);
        if (text && text.trim().length > 20) { description = text.trim(); break; }
      }
    }

    if (!description) {
      const bodyText = await page.locator('body').textContent({ timeout: 5_000 }).catch(() => null);
      description = bodyText ? bodyText.trim().slice(0, 3000) : null;
    }

    console.log(`  [${id}] ${(name ?? '(no name)').trim().slice(0, 70)}`);
    return { id, url, name: name?.trim() ?? null, description };
  } catch (err) {
    console.error(`  [${id}] ERROR: ${err.message.slice(0, 100)}`);
    return { id, url, name: null, description: null, error: err.message };
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
});
const page = await context.newPage();
const results = [];

console.log(`Scraping IDs ${START}–${END} (${END - START + 1} pages)…\n`);
for (let id = START; id <= END; id++) {
  results.push(await scrapeTournament(page, id));
  await page.waitForTimeout(300);
}

await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf-8');

const withDesc = results.filter(r => r.description).length;
const errors   = results.filter(r => r.error).length;
console.log(`\nDone → ${OUT}`);
console.log(`  ${withDesc}/${results.length} pages with content, ${errors} errors`);
