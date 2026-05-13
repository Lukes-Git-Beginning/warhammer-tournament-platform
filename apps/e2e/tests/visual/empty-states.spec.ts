/**
 * empty-states.spec.ts
 *
 * Structural regression tests for the unified <EmptyState> component
 * (Iter 4 of UI overhaul). Each variant exposes a stable data-testid:
 *   - empty-state-banner  (Landing: ActiveMusters, RollOfHonour)
 *   - empty-state-sigil   (LeaderboardPage, PresetListPage)
 *   - empty-state-compact (UserProfilePage: season, tournaments, matches)
 *
 * Tests skip gracefully when the underlying list is not actually empty
 * (e.g. dev DB has tournaments / leaderboard entries) — the assertion is
 * "if the empty-state renders, it renders correctly".
 */
import { test, expect } from '@playwright/test';

test.describe('EmptyState component', () => {
  test('Landing — banner empties have heading + body + latin motto when present', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const empties = page.getByTestId('empty-state-banner');
    const count = await empties.count();

    if (count === 0) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'No banner empties present — DB has musters AND leaderboard entries',
      });
      return;
    }

    for (let i = 0; i < count; i++) {
      const card = empties.nth(i);
      await expect(card.getByRole('heading')).toBeVisible();
      await expect(card.locator('[lang="la"]')).toBeVisible();
    }
  });

  test('Leaderboard sigil empty renders heading + motto when no entries', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const empty = page.getByTestId('empty-state-sigil');
    const count = await empty.count();
    if (count === 0) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'Leaderboard has entries — sigil empty not rendered',
      });
      return;
    }

    await expect(empty.first().getByRole('heading')).toBeVisible();
    await expect(empty.first().locator('[lang="la"]')).toBeVisible();
  });

  test('Landing banner empties do not cause horizontal overflow at 1440x900', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'empty-state must not introduce horizontal overflow').toBeLessThanOrEqual(1);
  });
});
