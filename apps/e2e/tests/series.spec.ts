/**
 * Tournament Series E2E — Model A full flow
 *
 * Verifies the reusable Series feature end-to-end:
 *   create host + players → create a final tournament → create a Model-A series with
 *   two qualifiers + the final → play both qualifiers to completion → the public series
 *   tracker shows cumulative standings with the Top-N flagged as qualified → the host
 *   seeds the final → the final is populated with the qualified players as seeded,
 *   checked-in participants → re-seeding is rejected (409).
 *
 * Model-C's skip-already-qualified cascade + the BaLi highest-division podium are covered
 * by pure unit tests (series-scoring.test.ts, tournament-podium.test.ts); this spec proves
 * the wired-up runtime path (routes + DB + UI) that unit tests cannot reach.
 *
 * API-driven via the tournament-fixture helper (auth is /auth/test-login, gated to
 * NODE_ENV=test — the same harness the other specs use), with one UI smoke of the tracker.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
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
} from './helpers/tournament-fixture.js';

const BACKEND = 'http://localhost:3000';

/** Play a small single-elimination tournament to completion (organizer reports every match). */
async function playToCompletion(
  orgCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  tournamentId: string,
  slug: string,
  factionA: string,
  factionB: string,
): Promise<void> {
  let round = 1;
  const MAX_ROUNDS = 6;
  while (round <= MAX_ROUNDS) {
    const roundMatches = await prisma.match.findMany({
      where: { tournament_id: tournamentId, round, status: 'PENDING' },
      select: { id: true, player1_id: true, player2_id: true },
      orderBy: { match_number: 'asc' },
    });
    if (roundMatches.length === 0) break;
    const playable = roundMatches.filter((m) => m.player1_id !== null && m.player2_id !== null);
    for (const m of playable) {
      await reportMatchResult(
        orgCtx,
        m.id,
        { winner_id: m.player1_id, p1_score: 2, p2_score: 0, p1_faction_id: factionA, p2_faction_id: factionB },
        BACKEND,
      );
    }
    round++;
  }
  // Finalize → status COMPLETED (required before the series final can be seeded).
  const res = await orgCtx.patch(`${BACKEND}/api/tournaments/${slug}`, { data: { status: 'COMPLETED' } });
  if (!res.ok()) throw new Error(`finalize ${slug} failed: ${res.status()} ${await res.text()}`);
}

test.describe('Tournament Series — Model A end-to-end', () => {
  const userIds: string[] = [];
  const seriesIds: string[] = [];

  test.beforeAll(async () => {
    await ensureActiveSeason();
  });

  test.afterAll(async () => {
    // Series must go before the user/tournament cleanup: it references owner_id (User) and
    // final_tournament_id (Tournament). Detach qualifiers/final first so no FK dangles.
    if (seriesIds.length > 0) {
      await prisma.tournament.updateMany({
        where: { series_id: { in: seriesIds } },
        data: { series_id: null, series_position: null, is_series_final: false },
      });
      await prisma.tournamentSeries.deleteMany({ where: { id: { in: seriesIds } } });
    }
    await cleanupTestData(userIds);
  });

  test('create → play qualifiers → standings → seed final', async ({ page }) => {
    // 1. Seed: 1 host + 4 players + 2 factions (games only count with both factions known).
    const [host] = await createTestUsers(1, { role: 'HOST', usernamePrefix: 'series-host' });
    if (!host) throw new Error('createTestUsers returned empty array');
    const players = await createTestUsers(4, { role: 'PLAYER', usernamePrefix: 'series-p' });
    userIds.push(host.id, ...players.map((p) => p.id));

    const factionRows = await prisma.faction.findMany({ take: 2, select: { id: true } });
    if (factionRows.length < 2) throw new Error('Series E2E needs >=2 seeded factions — run pnpm db:seed');
    const factionA = factionRows[0]!.id;
    const factionB = factionRows[1]!.id;

    const orgCtx = await playwrightRequest.newContext();
    try {
      await signInRequest(orgCtx, host.id, BACKEND);

      // 2. Create the FINAL tournament + two QUALIFIERS (all single-elim, host-managed).
      const stamp = Date.now();
      const final = await createTournament(orgCtx, { name: `Series Final ${stamp}`, format: 'SINGLE_ELIMINATION' }, BACKEND);
      const q1 = await createTournament(orgCtx, { name: `Series Q1 ${stamp}`, format: 'SINGLE_ELIMINATION' }, BACKEND);
      const q2 = await createTournament(orgCtx, { name: `Series Q2 ${stamp}`, format: 'SINGLE_ELIMINATION' }, BACKEND);

      // 3. Create the Model-A series (1 pt/game + 1 pt/win, Top 2 qualify) with both qualifiers + the final.
      const createRes = await orgCtx.post(`${BACKEND}/api/series`, {
        data: {
          name: `Test Series ${stamp}`,
          description: 'E2E Model-A series',
          scoring_config: {
            model: 'A',
            points_per_game_played: 1,
            points_per_win: 1,
            final_size: 2,
            tiebreakers: ['points', 'wins', 'games', 'random'],
          },
          qualifier_ids: [q1.id, q2.id],
          final_tournament_id: final.id,
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      const series = (await createRes.json()) as { id: string; slug: string };
      seriesIds.push(series.id);
      expect(series.slug).toBeTruthy();

      // The final must have been flagged + locked so nobody self-registers into it.
      const lockedFinal = await prisma.tournament.findUnique({
        where: { id: final.id },
        select: { is_series_final: true, status: true, series_id: true },
      });
      expect(lockedFinal?.is_series_final).toBe(true);
      expect(lockedFinal?.status).toBe('REGISTRATION_CLOSED');

      // 4. Play both qualifiers to completion.
      for (const q of [q1, q2]) {
        await registerUsers(q.slug, players, BACKEND);
        await generateBracket(orgCtx, q.slug, BACKEND);
        await playToCompletion(orgCtx, q.id, q.slug, factionA, factionB);
      }

      // 5. Public tracker shows cumulative standings; exactly final_size players are qualified.
      const detailRes = await orgCtx.get(`${BACKEND}/api/series/${series.slug}`);
      expect(detailRes.ok()).toBeTruthy();
      const detail = (await detailRes.json()) as {
        standings: { competitorId: string; points: number; qualified: boolean; rank: number }[];
        ready_to_seed: boolean;
        standings_provisional: boolean;
      };
      expect(detail.standings.length).toBeGreaterThanOrEqual(2);
      expect(detail.standings.every((s) => s.points > 0)).toBe(true);
      // Ranks are sequential from 1.
      expect(detail.standings.map((s) => s.rank)).toEqual(detail.standings.map((_, i) => i + 1));
      const qualified = detail.standings.filter((s) => s.qualified);
      expect(qualified.length).toBe(2);
      // All qualifiers complete → provisional flag clears and the series is ready to seed.
      expect(detail.standings_provisional).toBe(false);
      expect(detail.ready_to_seed).toBe(true);

      // 6. UI smoke: the public tracker page renders the series + a standings table.
      await page.goto(`/series/${series.slug}`, { waitUntil: 'networkidle' });
      await expect(page.getByText(`Test Series ${stamp}`, { exact: false }).first()).toBeVisible();

      // 7. Host seeds the final → qualified players become seeded, checked-in participants.
      const seedRes = await orgCtx.post(`${BACKEND}/api/series/${series.slug}/seed-final`);
      expect(seedRes.status(), await seedRes.text()).toBe(200);
      const seedBody = (await seedRes.json()) as { ok: boolean; seeded: number; finalSlug: string };
      expect(seedBody.ok).toBe(true);
      expect(seedBody.seeded).toBe(2);
      expect(seedBody.finalSlug).toBe(final.slug);

      const finalParticipants = await prisma.tournamentParticipant.findMany({
        where: { tournament_id: final.id, deleted_at: null },
        select: { user_id: true, seed: true, status: true },
        orderBy: { seed: 'asc' },
      });
      expect(finalParticipants.length).toBe(2);
      expect(finalParticipants.map((p) => p.seed)).toEqual([1, 2]);
      expect(finalParticipants.every((p) => p.status === 'CHECKED_IN')).toBe(true);
      // The seeded players are exactly the qualified ones, in rank order.
      expect(finalParticipants.map((p) => p.user_id)).toEqual(qualified.map((q) => q.competitorId));

      // 8. Seeding is idempotent-guarded — a second attempt is a 409.
      const reseedRes = await orgCtx.post(`${BACKEND}/api/series/${series.slug}/seed-final`);
      expect(reseedRes.status()).toBe(409);
    } finally {
      await orgCtx.dispose();
    }
  });
});
