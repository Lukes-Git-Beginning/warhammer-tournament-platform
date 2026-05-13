/**
 * M5.2.4 — Leaderboard Correctness E2E Spec
 *
 * Runs three SINGLE_ELIMINATION tournaments with 4 players each.
 * Player[0] wins tournaments 1+2; player[1] wins tournament 3.
 * Verifies that after finalization:
 *   - player[0].elo_rating > player[1].elo_rating
 *   - player[0].total_points > player[1].total_points
 *   - player[0].wins >= 4  (2 tournaments × ~2 match wins each in 4-player SE)
 *
 * API notes (verified against apps/backend/src/routes/):
 * - Bracket listing:  GET  /api/tournaments/:slug/bracket  → camelCase fields
 *   (matchId, player1Id, player2Id, status)
 * - Match result:     POST /api/matches/:id/result  { winnerId }
 * - Leaderboard:      GET  /api/leaderboard          → { entries: LBEntry[] }
 *   LBEntry: { rank, user: { id, username }, total_points, elo_rating, wins, ... }
 * - Finalization:     PATCH /api/tournaments/:slug { status: 'COMPLETED' }
 *   triggers finalizeTournament() which updates LeaderboardEntry rows.
 * - Registration closes + bracket: handled by generateBracket() helper.
 *
 * PLAYER role does not exist in the DB enum (Role: USER|ORGANIZER|MODERATOR|ADMIN).
 * Test users are created with role 'USER'.
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  createTestUsers,
  signInRequest,
  createTournament,
  registerUsers,
  generateBracket,
  reportMatchResult,
  cleanupTestData,
  ensureActiveSeason,
  type TestUser,
} from './helpers/tournament-fixture.js';

// ---------------------------------------------------------------------------
// Helper: run a full single-elimination tournament where `champion` always wins
// ---------------------------------------------------------------------------

async function runTournament(
  playwright: { request: { newContext: () => Promise<APIRequestContext> } },
  organizerId: string,
  players: TestUser[],
  champion: TestUser,
): Promise<void> {
  const ctx = await playwright.request.newContext();
  try {
    await signInRequest(ctx, organizerId);
    const t = await createTournament(ctx, {
      name: `LB-Correctness ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      format: 'SINGLE_ELIMINATION',
    });
    await registerUsers(t.slug, players);
    await generateBracket(ctx, t.slug);

    // Play all pending/ongoing matches; champion beats everyone
    let safety = 0;
    while (safety++ < 20) {
      const bracketRes = await ctx.get(
        `http://localhost:3000/api/tournaments/${t.slug}/bracket`,
      );
      const bracketBody = await bracketRes.json();
      const matches: Array<{
        matchId: string;
        player1Id: string | null;
        player2Id: string | null;
        status: string;
      }> = bracketBody.matches ?? [];

      const pending = matches.filter(
        (m) => m.status === 'PENDING' || m.status === 'ONGOING',
      );
      if (pending.length === 0) break;

      for (const m of pending) {
        // BYE matches have one null player — winner is the present player
        const isChampionP1 = m.player1Id === champion.id;
        const isChampionP2 = m.player2Id === champion.id;
        const winnerId =
          isChampionP1 || isChampionP2
            ? champion.id
            : (m.player1Id ?? m.player2Id);

        if (!winnerId) continue; // both null — skip (shouldn't happen)

        await reportMatchResult(ctx, m.matchId, {
          winner_id: winnerId,
          p1_score: winnerId === m.player1Id ? 2 : 0,
          p2_score: winnerId === m.player2Id ? 2 : 0,
        });
      }
    }

    // Finalize the tournament so leaderboard entries are written
    const finalizeRes = await ctx.patch(
      `http://localhost:3000/api/tournaments/${t.slug}`,
      { data: { status: 'COMPLETED' } },
    );
    expect(
      finalizeRes.ok(),
      `Finalize failed: ${finalizeRes.status()} ${await finalizeRes.text()}`,
    ).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe('Leaderboard Correctness — 3 tournaments, ELO delta verification', () => {
  const userIds: string[] = [];

  test.beforeAll(async () => {
    // Other test files in this suite (or backend tests) may leave all seasons
    // inactive. Restore one so /api/leaderboard does not return 404.
    await ensureActiveSeason();
  });

  test.afterAll(async () => {
    await cleanupTestData(userIds);
  });

  test('three tournaments produce expected leaderboard ranking and ELO movement', async ({
    playwright,
  }) => {
    // -----------------------------------------------------------------------
    // 1. Create users
    // -----------------------------------------------------------------------
    const [organizer] = await createTestUsers(1, {
      role: 'ORGANIZER',
      usernamePrefix: 'lb-org',
    });
    if (!organizer) throw new Error('Failed to create organizer user');
    const players = await createTestUsers(4, {
      role: 'USER',
      usernamePrefix: 'lb-p',
    });
    userIds.push(organizer.id, ...players.map((p: TestUser) => p.id));

    // -----------------------------------------------------------------------
    // 2. Run three tournaments
    // -----------------------------------------------------------------------
    // Tournament 1: player[0] wins
    await runTournament(playwright, organizer.id, players, players[0]!);
    // Tournament 2: player[0] wins again
    await runTournament(playwright, organizer.id, players, players[0]!);
    // Tournament 3: player[1] wins
    await runTournament(playwright, organizer.id, players, players[1]!);

    // -----------------------------------------------------------------------
    // 3. Read leaderboard
    // -----------------------------------------------------------------------
    const orgCtx = await playwright.request.newContext();
    try {
      await signInRequest(orgCtx, organizer.id);
      const lbRes = await orgCtx.get('http://localhost:3000/api/leaderboard');
      expect(lbRes.ok(), `Leaderboard request failed: ${lbRes.status()}`).toBeTruthy();
      const lb = await lbRes.json();

      // -----------------------------------------------------------------------
      // 4. Assertions
      // -----------------------------------------------------------------------
      const entries: Array<{
        rank: number;
        user: { id: string; username: string };
        total_points: number;
        elo_rating: number;
        wins: number;
        losses: number;
        matches_played: number;
      }> = lb.entries ?? [];

      const p0Entry = entries.find((e) => e.user.id === players[0]!.id);
      const p1Entry = entries.find((e) => e.user.id === players[1]!.id);

      expect(p0Entry, 'player[0] should appear in leaderboard').toBeTruthy();
      expect(p1Entry, 'player[1] should appear in leaderboard').toBeTruthy();

      // player[0] won 2 tournaments, player[1] won 1 — p0 should rank higher
      expect(
        p0Entry!.elo_rating,
        `p0 elo (${p0Entry!.elo_rating}) should be greater than p1 elo (${p1Entry!.elo_rating})`,
      ).toBeGreaterThan(p1Entry!.elo_rating);

      expect(
        p0Entry!.total_points,
        `p0 points (${p0Entry!.total_points}) should be greater than p1 points (${p1Entry!.total_points})`,
      ).toBeGreaterThan(p1Entry!.total_points);

      // 4-player SE has 3 matches total (semis + final). Champion wins all they play.
      // With 4 players: round 1 has 2 matches, final has 1 → champion plays 2 matches per tournament.
      // 2 tournament wins × 2 match wins each = 4 minimum wins.
      expect(
        p0Entry!.wins,
        `p0 should have at least 4 wins, got ${p0Entry!.wins}`,
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await orgCtx.dispose();
    }
  });
});
