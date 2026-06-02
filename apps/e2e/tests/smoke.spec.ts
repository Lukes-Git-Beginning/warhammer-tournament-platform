import { test, expect } from '@playwright/test';

test('health endpoint returns ok', async ({ request }) => {
  const response = await request.get('http://localhost:3000/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
});

test('frontend loads with Rizzotto branding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/where lists are forged/i).first()).toBeVisible();
});

test('login page shows Discord button', async ({ page }) => {
  await page.goto('/login');
  // DiscordLoginButton renders a <button type="button"> with text "Mit Discord anmelden".
  // The button navigates via window.location.href (onClick), not an href attribute.
  // We verify the button is visible; the OAuth redirect itself is not testable in E2E
  // without a real Discord session.
  const discordButton = page.getByRole('button', { name: /discord/i });
  await expect(discordButton.first()).toBeVisible();
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

// PARKED — bracket smoke test
// Reason: Verifying an actual bracket requires a full tournament lifecycle
// (create → register N players → generate bracket) with an authenticated
// organizer session. That exact flow is already covered end-to-end by
// tournament-happy-path.spec.ts and swiss-rematch-avoidance.spec.ts.
// A thin duplicate here adds no signal; re-evaluate if a lightweight
// "bracket API shape" assertion (e.g. GET /api/tournaments/:slug/matches)
// is wanted without the full browser flow.
// Tracking: consolidate with tournament-happy-path.spec.ts if a targeted
// matches-endpoint shape check is added (no ROADMAP item currently).
test.skip('bracket smoke test', async () => {});

// PARKED — live update smoke test
// Reason: Live-update (Socket.IO bracket push on match result) requires two
// authenticated browser contexts plus a running Socket.IO server. This is
// already covered in live-draft.spec.ts and reconnect-recovery.spec.ts.
// A stand-alone "smoke" variant here is superseded by those dedicated specs.
// Re-enable only if a minimal single-context "bracket update arrives" check
// is needed separately from the draft/reconnect suites.
// Tracking: no ROADMAP item; revisit alongside any Socket.IO health-check work.
test.skip('live update smoke test', async () => {});
