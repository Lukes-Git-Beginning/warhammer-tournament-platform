import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const API_URL = process.env.PLAYWRIGHT_API_URL ?? BASE_URL.replace(':5173', ':3000');

test.describe('Production Smoke — public pages only, no auth', () => {
  test('homepage loads with Rizzotto tagline', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByText(/where lists are forged/i)).toBeVisible();
  });

  test('GET /api/leaderboard returns 200 (or 404 if no active season)', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/leaderboard`);
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/factions returns 200', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/factions`);
    expect(res.ok()).toBeTruthy();
  });

  test('/leaderboard page renders heading', async ({ page }) => {
    await page.goto(`${BASE_URL}/leaderboard`);
    await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();
  });

  test('/meta page renders', async ({ page }) => {
    await page.goto(`${BASE_URL}/meta`);
    // Either heading visible or page loads without crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('/factions page renders', async ({ page }) => {
    await page.goto(`${BASE_URL}/factions`);
    await expect(page.locator('body')).toBeVisible();
  });

  test('robots.txt is served', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/robots.txt`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('Sitemap');
  });

  test('sitemap.xml is served', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('<urlset');
  });
});
