import { test, expect } from '@playwright/test';

test('health endpoint returns ok', async ({ request }) => {
  const response = await request.get('http://localhost:3000/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
});

test('frontend loads with TWW3 heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /TWW3/i })).toBeVisible();
});

test('login page shows Discord button', async ({ page }) => {
  await page.goto('/login');
  const discordButton = page
    .getByRole('button', { name: /discord/i })
    .or(page.locator('[data-testid*="discord"]'))
    .or(page.getByText(/discord/i));
  await expect(discordButton.first()).toBeVisible();

  // Verify the button links to the Discord auth route
  const href =
    (await discordButton.first().getAttribute('href')) ??
    (await page.locator('a', { hasText: /discord/i }).first().getAttribute('href'));
  expect(href).toMatch(/\/auth\/discord/);
});

test('auth guard redirects unauthenticated user away from /tournaments/create', async ({
  page,
}) => {
  await page.goto('/tournaments/create');
  // Accept either a redirect to /login or a visible auth-required hint
  const isOnLogin = page.url().includes('/login');
  if (!isOnLogin) {
    const hint = page
      .getByText(/login erforderlich/i)
      .or(page.getByText(/sign in/i))
      .or(page.getByText(/anmelden/i));
    await expect(hint.first()).toBeVisible();
  } else {
    expect(page.url()).toContain('/login');
  }
});

// M2 — needs seeded fixtures and authenticated session
test.skip('bracket smoke test', async () => {});

// M2 — needs seeded fixtures and authenticated session
test.skip('live update smoke test', async () => {});
