/**
 * M5.2.4 — Leaderboard Correctness E2E Spec
 *
 * Runs three SINGLE_ELIMINATION tournaments with 4 players each.
 * Player[0] wins tournaments 1+2; player[1] wins tournament 3.
 * Verifies that on the dynamic weighted leaderboard (derive-on-read):
 *   - player[0].totalFinalPoints > player[1].totalFinalPoints
 *   - player[0].rank < player[1].rank  (p0 ranks above p1)
 *   - player[0].wins >= 4  (2 tournaments × ~2 match wins each in 4-player SE)
 *
 * The dynamic leaderboard only counts matches where BOTH factions are known,
 * so every match result is reported with faction IDs.
 *
 * API notes (verified against apps/backend/src/routes/):
 * - Bracket listing:  GET  /api/tournaments/:slug/bracket  → camelCase fields
 *   (matchId, player1Id, player2Id, status)
 * - Match result:     POST /api/matches/:id/result  { winnerId, player1FactionId, player2FactionId }
 * - Leaderboard:      GET  /api/leaderboard          → { entries: LBEntry[] }
 *   LBEntry: { rank, playerId, displayName, totalFinalPoints, totalRawPoints, totalMatches, wins, losses }
 * - Finalization:     PATCH /api/tournaments/:slug { status: 'COMPLETED' }
 * - Registration closes + bracket: handled by generateBracket() helper.
 *
 * PLAYER role does not exist in the DB enum (Role: USER|ORGANIZER|MODERATOR|ADMIN).
 * Test users are created with role 'USER'.
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { prisma } from '@rizzotto/db';
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
  factionAId: string,
  factionBId: string,
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
          p1_faction_id: factionAId,
          p2_faction_id: factionBId,
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

test.describe('Leaderboard Correctness — 3 tournaments, dynamic FinalPoints ranking', () => {
  const userIds: string[] = [];

  test.beforeAll(async () => {
    // Other test files in this suite (or backend tests) may leave all seasons
    // inactive. Restore one so /api/leaderboard does not return 404.
    await ensureActiveSeason();
  });

  test.afterAll(async () => {
    await cleanupTestData(userIds);
  });

  test('three tournaments produce expected dynamic leaderboard ranking', async ({
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

    // Dynamic leaderboard only counts matches where both factions are known.
    // Grab two seeded factions to stamp on every reported match.
    const factions = await prisma.faction.findMany({ take: 2, select: { id: true } });
    if (factions.length < 2) {
      throw new Error('Leaderboard correctness needs >=2 seeded factions — run pnpm db:seed');
    }
    const factionA = factions[0]!.id;
    const factionB = factions[1]!.id;

    // -----------------------------------------------------------------------
    // 2. Run three tournaments
    // -----------------------------------------------------------------------
    // Tournament 1: player[0] wins
    await runTournament(playwright, organizer.id, players, players[0]!, factionA, factionB);
    // Tournament 2: player[0] wins again
    await runTournament(playwright, organizer.id, players, players[0]!, factionA, factionB);
    // Tournament 3: player[1] wins
    await runTournament(playwright, organizer.id, players, players[1]!, factionA, factionB);

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
        playerId: string;
        displayName: string;
        totalFinalPoints: number;
        totalRawPoints: number;
        totalMatches: number;
        wins: number;
        losses: number;
      }> = lb.entries ?? [];

      const p0Entry = entries.find((e) => e.playerId === players[0]!.id);
      const p1Entry = entries.find((e) => e.playerId === players[1]!.id);

      expect(p0Entry, 'player[0] should appear in leaderboard').toBeTruthy();
      expect(p1Entry, 'player[1] should appear in leaderboard').toBeTruthy();

      // player[0] won 2 tournaments, player[1] won 1 — p0 accumulates more
      // FinalPoints and therefore ranks above p1 on the dynamic leaderboard.
      expect(
        p0Entry!.totalFinalPoints,
        `p0 points (${p0Entry!.totalFinalPoints}) should be greater than p1 points (${p1Entry!.totalFinalPoints})`,
      ).toBeGreaterThan(p1Entry!.totalFinalPoints);

      expect(
        p0Entry!.rank,
        `p0 rank (${p0Entry!.rank}) should be above p1 rank (${p1Entry!.rank})`,
      ).toBeLessThan(p1Entry!.rank);

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
