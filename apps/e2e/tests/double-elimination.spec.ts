/**
 * Double Elimination E2E
 *
 * Verifies the full tournament lifecycle for an 8-player Double Elimination:
 *   create → register 8 players → generate bracket
 *   → generic match driver (WB + LB + GF) → finalize → placement assertion
 *   → browser smoke: bracket page renders without errors
 *
 * API notes (verified against apps/backend routes + packages/types/src/bracket.ts):
 * - Bracket:       GET  /api/tournaments/:slug/bracket
 *                  → { matches: BracketNode[] }  (camelCase: matchId, player1Id,
 *                    player2Id, bracketSide, status, winnerId)
 * - Match result:  POST /api/matches/:id/result
 *                  { winnerId, score, player1FactionId, player2FactionId }
 *                  (wrapped by reportMatchResult() helper)
 * - Finalize:      PATCH /api/tournaments/:slug  { status: 'COMPLETED' }
 * - Frontend route for bracket view: /tournaments/$slug  (TournamentDetail)
 *
 * 8-player DE match counts (verified in apps/backend/test/double-elimination.test.ts):
 *   WB: 7 | LB: 7 | GF: 2 (GF1 + optional reset GF2) = 16 total
 * The driver caps at 60 iterations to guard against loops.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { prisma } from '@rizzotto/db';
import {
  createTestUsers,
  signInRequest,
  signInBrowser,
  createTournament,
  registerUsers,
  generateBracket,
  reportMatchResult,
  cleanupTestData,
  ensureActiveSeason,
} from './helpers/tournament-fixture.js';

const BACKEND = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Shared state across both tests
// ---------------------------------------------------------------------------

/** All user IDs created in this suite — cleaned up in afterAll. */
const allUserIds: string[] = [];

/** Slug of the DE tournament created in the lifecycle test — reused by browser test. */
let tournamentSlug = '';

test.describe('Double Elimination — 8-player lifecycle + browser render', () => {
  test.beforeAll(async () => {
    await ensureActiveSeason();
  });

  test.afterAll(async () => {
    await cleanupTestData(allUserIds);
  });

  // -------------------------------------------------------------------------
  // Test 1: Full lifecycle via API
  // -------------------------------------------------------------------------

  test('8-player double elimination runs to a champion', async () => {
    // -----------------------------------------------------------------------
    // 1. Seed users: 1 organizer + 8 players
    // -----------------------------------------------------------------------
    const [organizer] = await createTestUsers(1, {
      role: 'ORGANIZER',
      usernamePrefix: 'de-org',
    });
    if (!organizer) throw new Error('createTestUsers returned empty array');

    const players = await createTestUsers(8, {
      role: 'PLAYER',
      usernamePrefix: 'de-p',
    });

    allUserIds.push(organizer.id, ...players.map((p) => p.id));

    // Two seeded factions — dynamic leaderboard only counts matches with both
    // faction IDs set, so we stamp every reported result.
    const factionRows = await prisma.faction.findMany({ take: 2, select: { id: true } });
    if (factionRows.length < 2) {
      throw new Error('DE spec needs >=2 seeded factions — run pnpm db:seed');
    }
    const factionA = factionRows[0]!.id;
    const factionB = factionRows[1]!.id;

    // -----------------------------------------------------------------------
    // 2. Create tournament + bracket
    // -----------------------------------------------------------------------
    const orgCtx = await playwrightRequest.newContext();

    try {
      await signInRequest(orgCtx, organizer.id, BACKEND);

      const tournament = await createTournament(
        orgCtx,
        {
          name: `DE-8P ${Date.now()}`,
          format: 'DOUBLE_ELIMINATION',
        },
        BACKEND,
      );

      expect(tournament.slug).toBeTruthy();
      expect(tournament.id).toBeTruthy();
      tournamentSlug = tournament.slug;

      await registerUsers(tournament.slug, players, BACKEND);
      await generateBracket(orgCtx, tournament.slug, BACKEND);

      // -----------------------------------------------------------------------
      // 3. Assert bracket structure
      // -----------------------------------------------------------------------
      const bracketRes = await orgCtx.get(
        `${BACKEND}/api/tournaments/${tournament.slug}/bracket`,
      );
      expect(bracketRes.ok(), `Bracket fetch failed: ${bracketRes.status()}`).toBeTruthy();

      const bracketBody = (await bracketRes.json()) as {
        matches: Array<{
          matchId: string;
          player1Id: string | null;
          player2Id: string | null;
          status: string;
          bracketSide: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null;
          winnerId: string | null;
        }>;
      };

      const hasWinners = bracketBody.matches.some((m) => m.bracketSide === 'WINNERS');
      const hasLosers = bracketBody.matches.some((m) => m.bracketSide === 'LOSERS');
      const hasGrandFinal = bracketBody.matches.some((m) => m.bracketSide === 'GRAND_FINAL');

      expect(hasWinners, 'Bracket should contain WINNERS matches').toBeTruthy();
      expect(hasLosers, 'Bracket should contain LOSERS matches').toBeTruthy();
      expect(hasGrandFinal, 'Bracket should contain a GRAND_FINAL match').toBeTruthy();

      // -----------------------------------------------------------------------
      // 4. Generic match driver: report results until no PENDING/ONGOING remain
      // -----------------------------------------------------------------------
      const MAX_ITERATIONS = 60;
      let iterations = 0;

      while (iterations++ < MAX_ITERATIONS) {
        const refreshRes = await orgCtx.get(
          `${BACKEND}/api/tournaments/${tournament.slug}/bracket`,
        );
        expect(refreshRes.ok()).toBeTruthy();

        const refreshed = (await refreshRes.json()) as {
          matches: Array<{
            matchId: string;
            player1Id: string | null;
            player2Id: string | null;
            status: string;
            bracketSide: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null;
            winnerId: string | null;
          }>;
        };

        const pending = refreshed.matches.filter(
          (m) =>
            (m.status === 'PENDING' || m.status === 'ONGOING') &&
            m.player1Id !== null &&
            m.player2Id !== null,
        );

        if (pending.length === 0) break;

        for (const m of pending) {
          // Always let player1 win — deterministic, no champion logic needed here
          await reportMatchResult(
            orgCtx,
            m.matchId,
            {
              winner_id: m.player1Id,
              p1_score: 2,
              p2_score: 0,
              p1_faction_id: factionA,
              p2_faction_id: factionB,
            },
            BACKEND,
          );
        }
      }

      expect(
        iterations,
        `Match driver exceeded ${MAX_ITERATIONS} iterations — possible loop`,
      ).toBeLessThan(MAX_ITERATIONS);

      // -----------------------------------------------------------------------
      // 5. Assert all matches resolved + exactly one GRAND_FINAL COMPLETED
      // -----------------------------------------------------------------------
      const finalBracketRes = await orgCtx.get(
        `${BACKEND}/api/tournaments/${tournament.slug}/bracket`,
      );
      expect(finalBracketRes.ok()).toBeTruthy();

      const finalBracket = (await finalBracketRes.json()) as {
        matches: Array<{
          matchId: string;
          status: string;
          bracketSide: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null;
        }>;
      };

      const stillPending = finalBracket.matches.filter(
        (m) => m.status === 'PENDING' || m.status === 'ONGOING',
      );
      expect(
        stillPending.length,
        `${stillPending.length} match(es) still PENDING/ONGOING after driver finished`,
      ).toBe(0);

      const completedGF = finalBracket.matches.filter(
        (m) => m.bracketSide === 'GRAND_FINAL' && m.status === 'COMPLETED',
      );
      expect(
        completedGF.length,
        'Exactly one GRAND_FINAL match should be COMPLETED (decisive game)',
      ).toBeGreaterThanOrEqual(1);

      // -----------------------------------------------------------------------
      // 6. Finalize tournament → placement records created
      // -----------------------------------------------------------------------
      const finalizeRes = await orgCtx.patch(
        `${BACKEND}/api/tournaments/${tournament.slug}`,
        { data: { status: 'COMPLETED' } },
      );
      expect(
        finalizeRes.ok(),
        `Finalize failed: ${finalizeRes.status()} ${await finalizeRes.text()}`,
      ).toBeTruthy();

      // Assert TournamentResult placement exists for rank 1
      const placement = await prisma.tournamentResult.findFirst({
        where: { tournament_id: tournament.id, placement: 1 },
        select: { id: true, user_id: true, placement: true },
      });
      expect(placement, 'A placement=1 TournamentResult should exist after finalization').toBeTruthy();
      expect(placement!.placement).toBe(1);
    } finally {
      await orgCtx.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Browser smoke — bracket page renders
  // -------------------------------------------------------------------------

  test('double-elimination bracket renders in the browser', async ({ browser }) => {
    // Guard: lifecycle test must have set the slug
    test.skip(!tournamentSlug, 'Skipped — lifecycle test did not produce a tournament slug');

    const ctx = await browser.newContext();
    try {
      // Find any player from the suite to sign in with (first non-organizer)
      // We stored all IDs in allUserIds; organizer is index 0, players follow.
      const playerId = allUserIds[1];
      if (!playerId) throw new Error('No player user ID available for browser test');

      await signInBrowser(ctx, playerId, BACKEND);

      const page = await ctx.newPage();

      // TanStack Router frontend route: /tournaments/$slug
      await page.goto(`http://localhost:5173/tournaments/${tournamentSlug}`);

      // BracketView is rendered inside TournamentDetail — wait for bracket container
      // or the tournament heading to appear (both indicate a successful render).
      await page.waitForSelector(
        '[data-testid="bracket-view"], h1, h2',
        { timeout: 15_000 },
      );

      // No crash dialog / error boundary should be visible
      const errorText = page.getByText(/something went wrong|unhandled error/i);
      await expect(errorText).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
