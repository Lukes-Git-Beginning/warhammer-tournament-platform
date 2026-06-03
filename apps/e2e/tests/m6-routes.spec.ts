import { test, expect } from '@playwright/test';
import { createTestUsers, signInBrowser, cleanupTestData } from './helpers/tournament-fixture.js';

// M6 added two routes that share a prefix with existing param routes. This spec
// guards the route-matching order so they resolve to the new pages rather than
// being swallowed by /tournaments/$slug or /users/$id. Assertions are based on
// the page's own API call firing (copy-independent, robust to UI tweaks).
test.describe('M6 route resolution', () => {
  test('/tournaments/calendar resolves to the calendar page (not tournament-detail $slug)', async ({
    page,
  }) => {
    const calendarReq = page.waitForResponse(
      (r) => r.url().includes('/api/tournaments/calendar') && !r.url().includes('.ics'),
      { timeout: 15_000 },
    );
    await page.goto('/tournaments/calendar');
    const res = await calendarReq;
    // If the route had matched /tournaments/$slug, this JSON call would never fire.
    expect(res.status()).toBe(200);
    // The iCal subscribe anchor is unique to the calendar page.
    await expect(page.locator('a[href*="calendar.ics"]').first()).toBeVisible();
  });

  test('/users/$a/vs/$b resolves to the head-to-head page', async ({ page, context }) => {
    const users = await createTestUsers(2, { usernamePrefix: 'm6-h2h' });
    try {
      await signInBrowser(context, users[0].id);
      const h2hReq = page.waitForResponse(
        (r) => r.url().includes(`/api/users/${users[0].id}/vs/${users[1].id}`),
        { timeout: 15_000 },
      );
      await page.goto(`/users/${users[0].id}/vs/${users[1].id}`);
      const res = await h2hReq;
      // If the route had matched /users/$id, the H2H endpoint would never be hit.
      expect(res.status()).toBe(200);
    } finally {
      await cleanupTestData(users.map((u) => u.id));
    }
  });
});
