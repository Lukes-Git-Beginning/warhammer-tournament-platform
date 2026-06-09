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
// Frontend routing smoke — draft/preset UI is DISABLED for v1
// ---------------------------------------------------------------------------
// The draft system is out of scope for the v1 launch. Every draft/preset route
// is stubbed in router.tsx with `window.location.replace('/')`, so visiting any
// of them hard-redirects to the landing page. The backend endpoints above stay
// live (hence the API smoke tests still pass); only the frontend UI is gated.
// These tests assert that intended redirect rather than the removed page UI.

const DISABLED_DRAFT_ROUTES = [
  '/presets',
  '/presets/new',
  '/presets/00000000-0000-0000-0000-000000000000/edit',
  '/drafts/00000000-0000-0000-0000-000000000000',
  '/drafts/00000000-0000-0000-0000-000000000000/spectate',
];

for (const route of DISABLED_DRAFT_ROUTES) {
  test(`${route} redirects to the landing page (draft UI disabled for v1)`, async ({ page }) => {
    await page.goto(route);
    // window.location.replace('/') lands the user on the landing page.
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('img', { name: /rizzotto's arena/i }).first()).toBeVisible();
  });
}

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
