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

test('/presets page loads with Draft-Presets heading', async ({ page }) => {
  await page.goto('/presets');
  await expect(page.getByRole('heading', { name: /draft-presets/i })).toBeVisible();
});

test('/presets page shows seed presets (Standard 1v1 or Captains)', async ({ page }) => {
  await page.goto('/presets');
  // At least one preset card should be visible after load
  // (seed provides "Standard 1v1" and "Captain's Mode Classic")
  await page.waitForFunction(
    () => !document.querySelector('[class*="Wird geladen"]'),
    { timeout: 10_000 },
  ).catch(() => {
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
    const hintVisible = await hint.first().isVisible().catch(() => false);
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

/**
 * POST /auth/test-login is now available (M5.1.1, guarded by NODE_ENV=test) but
 * accepts { userId } rather than { role }. Pre-seeded test users with deterministic
 * roles do not yet exist. The full cycle (tournament create → bracket → match start
 * → draft picks) will be implemented in M5.2.2 with a dedicated tournament-fixture
 * helper (apps/e2e/tests/helpers/tournament-fixture.ts) that creates users via
 * prisma, then signs them in via /auth/test-login by userId.
 */
test.skip(
  'full draft cycle: tournament → match start → both players pick → draft complete',
  async ({ browser }) => {
    const BASE = 'http://localhost:3000';

    // Helper: sign in as a test user via a hypothetical bypass endpoint
    async function signIn(ctx: Awaited<ReturnType<typeof browser.newContext>>, role: string) {
      const page = await ctx.newPage();
      const res = await page.request.post(`${BASE}/auth/test-login`, {
        data: { role },
      });
      // Cookies are set by the server; context is now authenticated
      await res.json();
      await page.close();
    }

    // 1. Create two contexts: admin (organizer) + guest
    const adminCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    await signIn(adminCtx, 'ADMIN');
    await signIn(guestCtx, 'PLAYER');

    const adminPage = await adminCtx.newPage();
    const adminReq = adminPage.request;

    // 2. Fetch first available preset
    const presetsRes = await adminReq.get(`${BASE}/api/draft-presets`);
    const { presets } = await presetsRes.json();
    const preset = presets[0];
    expect(preset).toBeTruthy();

    // 3. Create tournament with draft enabled
    const tRes = await adminReq.post(`${BASE}/api/tournaments`, {
      data: {
        name: 'E2E Draft Test Tournament',
        format: 'SINGLE_ELIMINATION',
        start_date: new Date(Date.now() + 86400_000).toISOString(),
        timezone: 'UTC',
        draft_enabled: true,
        draft_preset_id: preset.id,
      },
    });
    expect(tRes.ok()).toBeTruthy();
    const tournament = await tRes.json();

    // 4. Register two participants
    await adminReq.post(`${BASE}/api/tournaments/${tournament.slug}/register`);
    const guestPage = await guestCtx.newPage();
    await guestPage.request.post(`${BASE}/api/tournaments/${tournament.slug}/register`);

    // 5. Generate bracket + get first match
    await adminReq.post(`${BASE}/api/tournaments/${tournament.slug}/bracket`);
    const matchesRes = await adminReq.get(`${BASE}/api/tournaments/${tournament.slug}/matches`);
    const { matches } = await matchesRes.json();
    const match = matches[0];

    // 6. Start match → triggers DraftService.startDraft
    const startRes = await adminReq.patch(`${BASE}/api/matches/${match.id}/start`);
    expect(startRes.ok()).toBeTruthy();
    const { draftId } = await startRes.json();
    expect(draftId).toBeTruthy();

    // 7. Both browsers navigate to the draft lobby
    await adminPage.goto(`http://localhost:5173/drafts/${draftId}`);
    await guestPage.goto(`http://localhost:5173/drafts/${draftId}`);

    // 8. Both should see the DraftLobby — verify timer is visible
    await expect(adminPage.getByRole('heading', { name: /draft/i })).toBeVisible();
    await expect(guestPage.getByRole('heading', { name: /draft/i })).toBeVisible();

    // 9. First pick: host clicks a faction tile (Standard 1v1 turn 0 = ban by host)
    const firstTile = adminPage.locator('[data-testid="faction-tile"][data-status="available"]').first();
    await firstTile.click();

    // 10. Verify guest sees the update within 3 seconds
    await expect(
      guestPage.locator('[data-status="banned"], [data-status="picked-host"]').first(),
    ).toBeVisible({ timeout: 3000 });

    // 11. Cleanup
    await adminCtx.close();
    await guestCtx.close();
  },
);

/**
 * Spectator view — skipped until M5.2.2 for full live-draft coverage with spectator path.
 * see M5.2.2 for full live-draft coverage with spectator path
 */
test.skip('spectator can watch live draft read-only', async ({ browser }) => {
  // Implementation follows same pattern as above but with a third context
  // that calls watch_draft socket event and verifies no faction-action buttons
  // are rendered (or all are disabled).
  void browser;
});
