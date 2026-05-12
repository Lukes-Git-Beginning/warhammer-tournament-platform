import { test, expect } from '@playwright/test';

test('GET /api/factions returns faction list', async ({ request }) => {
  const res = await request.get('http://localhost:3000/api/factions');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  // data array exists and is non-empty
  expect(Array.isArray(json.data)).toBe(true);
  expect(json.data.length).toBeGreaterThan(0);
});

test('meta dashboard page loads with heading', async ({ page }) => {
  await page.goto('/meta');
  // MetaDashboard renders <h1>Meta-Dashboard</h1>
  await expect(page.getByRole('heading', { name: /meta-dashboard/i })).toBeVisible();
});

test('factions list page renders faction cards', async ({ page }) => {
  await page.goto('/factions');
  // FactionListPage renders <h1>Fraktionen</h1>
  await expect(page.getByRole('heading', { name: /fraktionen/i })).toBeVisible();
  // Each faction card is a Link to /factions/$id — wait for at least one to appear
  const cards = page.locator('a[href*="/factions/"]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
});
