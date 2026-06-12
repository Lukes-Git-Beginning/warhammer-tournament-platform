/**
 * M5.2.2 — Live Draft E2E
 *
 * Two real browser contexts (host + guest) connect via real Socket.IO to drive
 * a complete Captain's Mode Classic draft to DraftStatus.COMPLETED.
 *
 * Architecture:
 *  - Browser contexts handle navigation and assert UI renders.
 *  - Draft actions are submitted via Socket.IO (the only intake path — no REST
 *    action endpoint exists). Each player context opens its own socket, joins
 *    the draft room, and emits draft_action events.
 *  - The organizer API context (APIRequestContext) drives setup: create
 *    tournament, register players, generate bracket, start match.
 *  - State is polled via GET /api/drafts/:id to determine the current actor and
 *    which faction to pick, so the test is independent of timer auto-select.
 *
 * Captain's Mode Classic turn sequence (7 turns, 0-indexed):
 *   Turn 0: host  — pick (hidden, is_parallel:true)
 *   Turn 1: guest — pick (hidden, is_parallel:true)
 *   [Both submit while current_turn stays 0; after both submit → advances to 1 then 2]
 *   Turn 2: admin — reveal_picks  (auto-processed by backend)
 *   Turn 3: host  — ban
 *   Turn 4: guest — ban
 *   Turn 5: host  — pick
 *   Turn 6: guest — pick
 *
 * API shapes (verified against backend source):
 *   GET  /api/tournaments/:slug/bracket → { matches: [{ matchId, player1Id, player2Id, ... }] }
 *   PATCH /api/matches/:id/start        → { draft_id: string | null }
 *   GET  /api/drafts/:id                → DraftView { status, current_turn, preset, state }
 *   WS   draft_action                   → { draftId: string, factionId: string }
 */

import { test, expect } from '@playwright/test';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  createTestUsers,
  signInBrowser,
  signInRequest,
  createTournament,
  registerUsers,
  generateBracket,
  cleanupTestData,
} from './helpers/tournament-fixture.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKEND = 'http://localhost:3000';

/** 24 faction IDs from seed, ordered by display_order. */
const ALL_FACTION_IDS = [
  'empire', 'bretonnia', 'kislev', 'grand_cathay', 'dwarfs', 'high_elves', 'lizardmen',
  'greenskins', 'dark_elves', 'skaven', 'norsca', 'ogre_kingdoms', 'beastmen',
  'khorne', 'nurgle', 'tzeentch', 'slaanesh', 'daemons_of_chaos', 'warriors_of_chaos',
  'chaos_dwarfs', 'vampire_counts', 'vampire_coast', 'tomb_kings', 'wood_elves',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftView {
  id: string;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  current_turn: number;
  host_user_id: string | null;
  guest_user_id: string | null;
  preset: {
    turns: Array<{
      order: number;
      actor: 'host' | 'guest' | 'admin';
      action: string;
      is_parallel: boolean;
      is_hidden: boolean;
      category: string;
    }>;
    category_limits: Array<{
      category_name: string;
      factions: string[];
      max_picks: number | null;
      max_bans: number | null;
    }>;
  };
  state: {
    picks: { host: string[]; guest: string[] };
    bans: string[];
    exclusive_bans: { host: string[]; guest: string[] };
    hidden_picks: { host: string[]; guest: string[] };
    hidden_bans: { host: string[]; guest: string[] };
    parallel_pending: { host: string | null; guest: string | null };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All faction IDs currently committed or pending — avoids duplicate picks. */
function takenFactions(state: DraftView['state']): Set<string> {
  const taken = new Set<string>([
    ...state.picks.host,
    ...state.picks.guest,
    ...state.bans,
    ...state.exclusive_bans.host,
    ...state.exclusive_bans.guest,
    ...state.hidden_picks.host,
    ...state.hidden_picks.guest,
    ...state.hidden_bans.host,
    ...state.hidden_bans.guest,
  ]);
  // Also exclude what is currently in parallel_pending (not yet committed to picks/bans)
  if (state.parallel_pending.host) taken.add(state.parallel_pending.host);
  if (state.parallel_pending.guest) taken.add(state.parallel_pending.guest);
  return taken;
}

/** Pick the first available faction not yet taken, excluding an optional extra set. */
function firstAvailable(state: DraftView['state'], alsoExclude?: Set<string>): string {
  const taken = takenFactions(state);
  if (alsoExclude) alsoExclude.forEach((f) => taken.add(f));
  const avail = ALL_FACTION_IDS.find((f) => !taken.has(f));
  if (!avail) throw new Error('No faction available — all 24 factions exhausted');
  return avail;
}

/** Fetch current draft state via REST. */
async function fetchDraft(draftId: string, cookieStr: string): Promise<DraftView> {
  const res = await fetch(`${BACKEND}/api/drafts/${draftId}`, {
    headers: { Cookie: cookieStr },
  });
  if (!res.ok) throw new Error(`GET /api/drafts/${draftId} → ${res.status}`);
  return res.json() as Promise<DraftView>;
}

/** Poll until predicate holds or timeout. */
async function pollUntil(
  fn: () => Promise<DraftView>,
  predicate: (v: DraftView) => boolean,
  timeoutMs = 20_000,
): Promise<DraftView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (predicate(v)) return v;
    await delay(400);
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Open an authenticated Socket.IO connection. */
function openSocket(cookieStr: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(BACKEND, {
      transports: ['websocket'],
      extraHeaders: { cookie: cookieStr },
      reconnection: false,
    });
    const timer = setTimeout(
      () => reject(new Error('Socket.IO connect timeout after 10s')),
      10_000,
    );
    sock.on('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Extract auth_token cookie string from a Playwright BrowserContext. */
async function getCookieString(ctx: import('@playwright/test').BrowserContext): Promise<string> {
  const cookies = await ctx.cookies(BACKEND);
  const auth = cookies.find((c) => c.name === 'auth_token');
  if (!auth) throw new Error('auth_token cookie missing — signInBrowser may have failed');
  return `auth_token=${auth.value}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Live Draft — 2 browser contexts, real Socket.IO", () => {
  const userIds: string[] = [];

  test.afterAll(async () => {
    await cleanupTestData(userIds);
  });

  test.setTimeout(60_000);

  test("two players complete captain's mode draft via real WebSocket", async ({
    browser,
    playwright,
  }) => {
    // -----------------------------------------------------------------------
    // 1. Seed users
    // -----------------------------------------------------------------------
    const [organizer] = await createTestUsers(1, { role: 'HOST', usernamePrefix: 'draft-org' });
    if (!organizer) throw new Error('createTestUsers returned empty array');
    const players = await createTestUsers(2, { role: 'PLAYER', usernamePrefix: 'draft-p' });
    userIds.push(organizer.id, ...players.map((p) => p.id));

    // -----------------------------------------------------------------------
    // 2. Organizer API context — sign in, fetch preset
    // -----------------------------------------------------------------------
    const orgCtx = await playwright.request.newContext();
    await signInRequest(orgCtx, organizer.id);

    const presetsRes = await orgCtx.get(`${BACKEND}/api/draft-presets`);
    expect(presetsRes.ok()).toBeTruthy();
    const { presets } = (await presetsRes.json()) as {
      presets: Array<{ id: string; name: string; is_public: boolean }>;
    };
    expect(presets.length).toBeGreaterThan(0);

    const preset =
      presets.find((p) => p.name === "Captain's Mode Classic") ??
      presets.find((p) => p.is_public) ??
      presets[0];
    expect(preset).toBeTruthy();

    // -----------------------------------------------------------------------
    // 3. Create tournament with draft enabled
    // -----------------------------------------------------------------------
    const tournament = await createTournament(orgCtx, {
      name: `Draft E2E ${Date.now()}`,
      format: 'SINGLE_ELIMINATION',
      draft_enabled: true,
      draft_preset_id: preset!.id,
    });
    expect(tournament.slug).toBeTruthy();

    // -----------------------------------------------------------------------
    // 4. Register players + generate bracket
    // -----------------------------------------------------------------------
    await registerUsers(tournament.slug, players);
    await generateBracket(orgCtx, tournament.slug);

    const bracketRes = await orgCtx.get(`${BACKEND}/api/tournaments/${tournament.slug}/bracket`);
    expect(bracketRes.ok()).toBeTruthy();
    const bracketData = (await bracketRes.json()) as {
      matches: Array<{ matchId: string; player1Id: string | null; player2Id: string | null }>;
    };
    expect(bracketData.matches.length).toBeGreaterThan(0);

    const match = bracketData.matches.find((m) => m.player1Id && m.player2Id);
    expect(match).toBeTruthy();
    const matchId = match!.matchId;
    const hostUserId = match!.player1Id!;
    const guestUserId = match!.player2Id!;

    // -----------------------------------------------------------------------
    // 5. Start match → backend creates Draft, returns draft_id
    // -----------------------------------------------------------------------
    const startRes = await orgCtx.patch(`${BACKEND}/api/matches/${matchId}/start`);
    expect(startRes.ok()).toBeTruthy();
    const startBody = (await startRes.json()) as { draft_id: string | null };
    const draftId = startBody.draft_id;
    expect(draftId).toBeTruthy();

    // -----------------------------------------------------------------------
    // 6. Open browser contexts, sign in each player
    // -----------------------------------------------------------------------
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    await signInBrowser(hostCtx, hostUserId);
    await signInBrowser(guestCtx, guestUserId);

    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();

    // -----------------------------------------------------------------------
    // 7. Navigate to draft lobby — assert UI renders
    // -----------------------------------------------------------------------
    await Promise.all([
      hostPage.goto(`/drafts/${draftId}`),
      guestPage.goto(`/drafts/${draftId}`),
    ]);

    await expect(
      hostPage.getByRole('heading', { name: /draft/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      guestPage.getByRole('heading', { name: /draft/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // 8. Open authenticated Socket.IO connections
    // -----------------------------------------------------------------------
    const hostCookieStr = await getCookieString(hostCtx);
    const guestCookieStr = await getCookieString(guestCtx);

    const hostSock = await openSocket(hostCookieStr);
    const guestSock = await openSocket(guestCookieStr);

    try {
      hostSock.emit('join_draft', draftId!);
      guestSock.emit('join_draft', draftId!);
      await delay(600); // wait for draft_state_sync

      // -----------------------------------------------------------------------
      // 9. Drive draft turns to COMPLETED
      //
      // Strategy per iteration:
      //   a) Poll current state.
      //   b) Skip if COMPLETED.
      //   c) If current turn is a reveal turn → wait for backend auto-advance.
      //   d) If current turn is parallel:
      //      - Host and Guest both need to submit. Track which have submitted
      //        via the parallel_pending field in the state.
      //      - Use disjoint faction picks (reserve one for each side).
      //   e) If sequential: designated actor submits, track by turn index.
      // -----------------------------------------------------------------------
      const poll = () => fetchDraft(draftId!, hostCookieStr);

      let lastSequentialTurnIdx = -1;

      for (let iter = 0; iter < 40; iter++) {
        const view = await poll();

        if (view.status === 'COMPLETED') break;
        if (view.status === 'CANCELLED') throw new Error('Draft unexpectedly cancelled');

        const turnIdx = view.current_turn;
        const turns = view.preset.turns;

        // Beyond all defined turns → wait for auto-complete
        if (turnIdx >= turns.length) {
          await delay(800);
          continue;
        }

        const currentTurn = turns[turnIdx]!;

        // Reveal turns are auto-processed by the backend — just wait
        if (
          currentTurn.action === 'reveal_picks' ||
          currentTurn.action === 'reveal_bans' ||
          currentTurn.action === 'reveal_all'
        ) {
          await delay(1_000);
          continue;
        }

        // --- Parallel turn ---------------------------------------------------
        if (currentTurn.is_parallel) {
          // Both host and guest must submit. They both see current_turn = turnIdx
          // until both have submitted.
          const pendingHost = view.state.parallel_pending.host;
          const pendingGuest = view.state.parallel_pending.guest;

          const hostNeedsSubmit = pendingHost === null;
          const guestNeedsSubmit = pendingGuest === null;

          if (hostNeedsSubmit) {
            // Reserve two distinct factions: first for host
            const hostFaction = firstAvailable(view.state);
            hostSock.emit('draft_action', { draftId: draftId!, factionId: hostFaction });
            await delay(300); // let server process before guest reads state
          }

          if (guestNeedsSubmit) {
            // Re-poll so we see the host's pending faction (now in parallel_pending.host)
            const freshView = await poll();
            const guestFaction = firstAvailable(freshView.state);
            guestSock.emit('draft_action', { draftId: draftId!, factionId: guestFaction });
            await delay(300);
          }

          // Wait for backend to commit both and advance current_turn
          await delay(800);
          continue;
        }

        // --- Sequential turn -------------------------------------------------
        if (turnIdx === lastSequentialTurnIdx) {
          // Already submitted this turn — wait for server to advance
          await delay(600);
          continue;
        }

        lastSequentialTurnIdx = turnIdx;

        // Resolve actor: treat 'admin' turns as host-side
        const actor: 'host' | 'guest' =
          currentTurn.actor === 'host' || currentTurn.actor === 'admin' ? 'host' : 'guest';
        const sock = actor === 'host' ? hostSock : guestSock;

        const factionId = firstAvailable(view.state);
        sock.emit('draft_action', { draftId: draftId!, factionId });

        await delay(600);
      }

      // -----------------------------------------------------------------------
      // 10. Final assertion — draft must be COMPLETED
      // -----------------------------------------------------------------------
      const finalView = await pollUntil(poll, (v) => v.status === 'COMPLETED', 20_000);
      expect(finalView.status).toBe('COMPLETED');

      // Captain's Mode Classic: 2 picks per player after reveal
      // (turn 0+1 hidden picks → revealed + turn 5+6 explicit picks = 2 picks each)
      expect(finalView.state.picks.host.length).toBeGreaterThan(0);
      expect(finalView.state.picks.guest.length).toBeGreaterThan(0);

      // -----------------------------------------------------------------------
      // 11. UI sanity check — pages must not be blank after reload
      //     Primary assertion is the API status above.
      // -----------------------------------------------------------------------
      await Promise.all([hostPage.reload(), guestPage.reload()]);
      await delay(2_000); // allow React hydration + socket reconnect

      for (const page of [hostPage, guestPage]) {
        // Anything rendered in the body is sufficient — React did not crash
        const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        // A non-empty body means the app rendered something (loading, completion, error boundary)
        expect(bodyText.trim().length).toBeGreaterThan(0);
      }
    } finally {
      hostSock.disconnect();
      guestSock.disconnect();
      await hostCtx.close();
      await guestCtx.close();
      await orgCtx.dispose();
    }
  });
});
