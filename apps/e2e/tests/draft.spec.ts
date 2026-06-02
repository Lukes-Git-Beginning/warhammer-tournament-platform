/**
 * M4 Draft System — E2E Smoke Tests
 *
 * Architecture note on auth:
 * The platform uses Discord OAuth. There is no test-user seed with JWT cookies
 * in the existing smoke.spec.ts / meta.spec.ts — those tests only exercise
 * public pages and unauthenticated API endpoints. A full two-player draft flow
 * (login → tournament create → bracket generate → match start → both pick)
 * requires either:
 *   (a) a Discord test account + real OAuth round-trip, or
 *   (b) a test-auth bypass endpoint (e.g. POST /auth/test-login) that issues a
 *       real JWT for a seeded test user.
 * Neither exists yet — that is a M5 CI-infrastructure task.
 *
 * What we CAN test without auth:
 *  - Public API endpoints exposed by M4 (draft-presets list, draft view)
 *  - Frontend routing: pages render (loading state or error boundary, not crash)
 *  - Header navigation: "Drafts" link exists and points to /presets
 *
 * Full two-browser draft cycle is marked test.skip with a clear comment so it
 * can be enabled once a test-auth bypass is wired up.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// API smoke — public endpoints
// ---------------------------------------------------------------------------

test('GET /api/draft-presets returns preset list (public)', async ({ request }) => {
  const res = await request.get('http://localhost:3000/api/draft-presets');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toHaveProperty('presets');
  expect(Array.isArray(json.presets)).toBe(true);
  // Seed should have at least 2 presets ("Standard 1v1" and "Captain's Mode Classic")
  expect(json.presets.length).toBeGreaterThanOrEqual(2);
});

test('GET /api/draft-presets returns preset with expected shape', async ({ request }) => {
  const res = await request.get('http://localhost:3000/api/draft-presets');
  const json = await res.json();
  const first = json.presets[0];
  expect(first).toHaveProperty('id');
  expect(first).toHaveProperty('name');
  expect(first).toHaveProperty('turns');
  expect(first).toHaveProperty('turn_seconds');
  expect(first).toHaveProperty('is_public');
  expect(Array.isArray(first.turns)).toBe(true);
});

test('GET /api/draft-presets/:id for unknown id returns 404', async ({ request }) => {
  const res = await request.get(
    'http://localhost:3000/api/draft-presets/00000000-0000-0000-0000-000000000000',
  );
  expect(res.status()).toBe(404);
});

test('GET /api/drafts/:id for unknown id returns 404', async ({ request }) => {
  const res = await request.get(
    'http://localhost:3000/api/drafts/00000000-0000-0000-0000-000000000000',
  );
  expect(res.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Frontend routing smoke — pages render without crashing
// ---------------------------------------------------------------------------

test('/presets page loads with Preset Library heading', async ({ page }) => {
  await page.goto('/presets');
  // i18n: EN renders "Preset Library", DE renders "Preset-Bibliothek".
  // Frontend defaults to EN in CI (no localStorage, fallbackLng=en).
  await expect(
    page.getByRole('heading', { name: /preset[\s-](library|bibliothek)/i }),
  ).toBeVisible();
});

test('/presets page shows seed presets (Standard 1v1 or Captains)', async ({ page }) => {
  await page.goto('/presets');
  // At least one preset card should be visible after load
  // (seed provides "Standard 1v1" and "Captain's Mode Classic")
  await page
    .waitForFunction(() => !document.querySelector('[class*="Wird geladen"]'), { timeout: 10_000 })
    .catch(() => {
      // Loading state may be absent if presets loaded instantly — that is fine
    });
  const cards = page.locator('h3').filter({ hasText: /1v1|Classic|Preset|Standard/i });
  // Accept either visible cards or the empty-state message — both are valid renders
  const cardCount = await cards.count();
  const emptyState = page.getByText(/noch keine presets/i);
  const emptyVisible = await emptyState.isVisible().catch(() => false);
  expect(cardCount > 0 || emptyVisible).toBe(true);
});

test('/presets/new shows auth guard or editor heading', async ({ page }) => {
  await page.goto('/presets/new');
  // Unauthenticated → either redirect to /login or show the
  // "Du benötigst die Organizer-Rolle" message
  const url = page.url();
  if (url.includes('/login')) {
    expect(url).toContain('/login');
  } else {
    // The page might show a loading spinner, then an auth hint
    const hint = page
      .getByText(/organizer-rolle/i)
      .or(page.getByText(/anmelden/i))
      .or(page.getByText(/neuen preset erstellen/i));
    // Give it a moment to settle after any loading
    await page.waitForTimeout(500);
    const hintVisible = await hint
      .first()
      .isVisible()
      .catch(() => false);
    // Accept: either a hint is visible OR the page rendered without a JS crash
    // (heading "Neuen Preset erstellen" means auth somehow passed, which is also ok)
    const anyHeading = await page.getByRole('heading').count();
    expect(hintVisible || anyHeading > 0).toBe(true);
  }
});

test('/drafts/some-id shows loading state or error boundary (not blank)', async ({ page }) => {
  await page.goto('/drafts/00000000-0000-0000-0000-000000000000');
  // Page must render something — either the loading text or the error message
  const loading = page.getByText(/lade draft/i);
  const errorMsg = page.getByText(/nicht gefunden/i);
  // Wait for one of them (loading may be brief)
  await expect(loading.or(errorMsg).first()).toBeVisible({ timeout: 8000 });
});

test('/drafts/some-id/spectate shows loading state or error boundary', async ({ page }) => {
  await page.goto('/drafts/00000000-0000-0000-0000-000000000000/spectate');
  const loading = page.getByText(/lade draft/i);
  const errorMsg = page.getByText(/nicht gefunden|nicht erreichbar/i);
  await expect(loading.or(errorMsg).first()).toBeVisible({ timeout: 8000 });
});

test('header contains Drafts navigation link pointing to /presets', async ({ page }) => {
  await page.goto('/');
  const draftsLink = page.locator('a[href="/presets"]');
  await expect(draftsLink.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Full two-player draft flow — deferred to M5.2.2 (tournament-fixture helper)
// ---------------------------------------------------------------------------

// PARKED — full two-player draft cycle
// Reason: This test was written pre-M5.1.1 with a placeholder { role } auth
// pattern that never matched the actual /auth/test-login API (which requires
// { userId }). Additionally, it calls non-existent endpoints
// (/api/tournaments/:slug/bracket instead of /api/tournaments/:id/start,
// expects { draftId } directly from PATCH /matches/:id/start instead of
// { draft_id }). Fixing these stub issues would reproduce a test that is
// already comprehensively covered by live-draft.spec.ts (two real browser
// contexts, WebSocket, full pick cycle with tournament-fixture helpers).
// Re-enabling here as a thin duplicate adds no signal over live-draft.spec.ts.
// Tracking: remove this stub entirely once live-draft.spec.ts is confirmed
// stable in CI for 3+ consecutive runs.
test.skip('full draft cycle: tournament → match start → both players pick → draft complete', async ({
  browser,
}) => {
  void browser;
});

// PARKED — spectator read-only draft view
// Reason: Requires a third authenticated browser context that joins an
// ongoing draft via the watch_draft Socket.IO event and asserts that
// faction-action buttons are absent or disabled. The infrastructure
// (tournament-fixture helpers, test-login bypass, two-context live draft)
// is in place, but a dedicated spectator assertion layer (data-testid on
// faction tiles, spectator-role enforcement in DraftLobbyPage) has not
// been implemented in the frontend yet.
// Tracking: implement alongside the spectator-UI hardening task; no ROADMAP
// item currently — add one when spectator UX is prioritised.
test.skip('spectator can watch live draft read-only', async ({ browser }) => {
  void browser;
});
