/**
 * M5.2.3 — Swiss Rematch-Avoidance E2E Spec
 *
 * 8 players, 4 Swiss rounds. Asserts that no pair of players is matched
 * against each other more than once across all rounds.
 *
 * API notes (verified against apps/backend/src/routes/bracket.ts):
 * - Bracket listing:  GET  /api/tournaments/:slug/bracket  → { matches: BracketMatch[] }
 *   BracketMatch uses camelCase: matchId, player1Id, player2Id, status, round
 *   No ?round= query param — filter client-side.
 * - Next round:       POST /api/tournaments/:id/next-round  (id = UUID, not slug)
 *   Returns 400 when all recommended rounds are exhausted.
 * - Match result:     POST /api/matches/:id/result  { winnerId }
 */

import { test, expect } from '@playwright/test';
import { prisma } from '@rizzotto/db';
import {
  createTestUsers,
  signInRequest,
  createTournament,
  registerUsers,
  generateBracket,
  reportMatchResult,
  cleanupTestData,
} from './helpers/tournament-fixture.js';

test.describe('Swiss Rematch Avoidance — 8 players, 3 rounds (ceil(log2(8)))', () => {
  const userIds: string[] = [];

  test.afterAll(async () => {
    await cleanupTestData(userIds);
  });

  test('no pair plays each other twice across all swiss rounds', async ({ playwright }) => {
    // -----------------------------------------------------------------------
    // 1. Create users
    // -----------------------------------------------------------------------
    const [organizer] = await createTestUsers(1, {
      role: 'ORGANIZER',
      usernamePrefix: 'swiss-org',
    });
    if (!organizer) throw new Error('createTestUsers returned empty array');
    const players = await createTestUsers(8, {
      role: 'USER',
      usernamePrefix: 'swiss-p',
    });
    userIds.push(organizer.id, ...players.map((p) => p.id));

    // -----------------------------------------------------------------------
    // 2. Organizer context
    // -----------------------------------------------------------------------
    const orgCtx = await playwright.request.newContext();
    await signInRequest(orgCtx, organizer.id);

    // -----------------------------------------------------------------------
    // 3. Create tournament + register + generate bracket
    // -----------------------------------------------------------------------
    const tournament = await createTournament(orgCtx, {
      name: `Swiss E2E ${Date.now()}`,
      format: 'SWISS',
    });
    await registerUsers(tournament.slug, players);
    await generateBracket(orgCtx, tournament.slug);

    // Resolve tournament UUID needed for /next-round endpoint
    const dbTournament = await prisma.tournament.findFirst({
      where: { slug: tournament.slug },
      select: { id: true },
    });
    expect(dbTournament).not.toBeNull();
    const tournamentId = dbTournament!.id;

    // -----------------------------------------------------------------------
    // 4. Play 4 rounds, tracking all pairings
    // -----------------------------------------------------------------------
    const pairings = new Set<string>(); // "smallerId|largerId" — sorted UUIDs

    // Swiss recommended round count = ceil(log2(participantCount)), clamped to [3, 7].
    // For 8 players this resolves to 3 — see apps/backend/src/lib/swiss.ts:188.
    const TOTAL_ROUNDS = 3;

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      // Fetch all matches and filter by current round (no server-side filter)
      const bracketRes = await orgCtx.get(
        `http://localhost:3000/api/tournaments/${tournament.slug}/bracket`,
      );
      expect(bracketRes.ok()).toBeTruthy();
      const bracketBody = await bracketRes.json();
      const allMatches: Array<{
        matchId: string;
        round: number;
        player1Id: string | null;
        player2Id: string | null;
        status: string;
      }> = bracketBody.matches;

      const roundMatches = allMatches.filter((m) => m.round === round);
      expect(roundMatches.length).toBeGreaterThan(0);

      for (const m of roundMatches) {
        // BYE matches (one player null) — skip rematch check, but still report
        if (m.player1Id && m.player2Id) {
          const pair = [m.player1Id, m.player2Id].sort().join('|');
          expect(
            pairings.has(pair),
            `Rematch detected in round ${round}: ${m.player1Id} vs ${m.player2Id}`,
          ).toBe(false);
          pairings.add(pair);
        }

        // Report result: player1 wins (or sole player wins BYE)
        const winnerId = m.player1Id ?? m.player2Id;
        if (winnerId) {
          await reportMatchResult(orgCtx, m.matchId, {
            winner_id: winnerId,
            p1_score: m.player1Id ? 2 : 0,
            p2_score: m.player2Id ? 2 : 0,
          });
        }
      }

      // Advance to next round (skip after final round)
      if (round < TOTAL_ROUNDS) {
        const advanceRes = await orgCtx.post(
          `http://localhost:3000/api/tournaments/${tournamentId}/next-round`,
        );
        expect(
          advanceRes.ok(),
          `next-round failed after round ${round}: ${advanceRes.status()} ${await advanceRes.text()}`,
        ).toBeTruthy();
      }
    }

    await orgCtx.dispose();
  });
});
