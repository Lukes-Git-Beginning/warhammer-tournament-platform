/**
 * Single Elimination — Semis / Grand Final formats E2E
 *
 * Regression for ladder-grand-finals-september-2026: an SE tournament set to Bo3 semis + Bo3
 * final played every match Bo1. SE matches carry no phase, so the phase-derived format always
 * fell back to the regular match format. The start route now stamps the Semis / Grand Final
 * formats onto those matches (Match.match_format) and the bracket DTO honours the override.
 *
 * 8 players, third-place match on: QF (4) → SF (2) → Final + Small Final.
 *   Match format BO1, Semis BO3, Grand Final BO5.
 *   Expected: QF BO1, SF BO3, Final BO5, Small Final BO3 (Semis format via its phase).
 */
import { test, expect } from '@playwright/test';
import { prisma } from '@rizzotto/db';
import {
  createTestUsers,
  signInRequest,
  createTournament,
  registerUsers,
  generateBracket,
  cleanupTestData,
  ensureActiveVersion,
} from './helpers/tournament-fixture.js';

const BACKEND = 'http://localhost:3000';
const allUserIds: string[] = [];

interface Node {
  matchId: string;
  round: number;
  nextMatchId: string | null;
  phase?: string | null;
  matchFormat: string | null;
}

test.describe('Single Elimination — semis/final formats', () => {
  test.beforeAll(async () => {
    await ensureActiveVersion();
  });

  test.afterAll(async () => {
    await cleanupTestData(allUserIds);
  });

  test('8 players: QF Bo1, semis Bo3, final Bo5, small final Bo3', async ({ request }) => {
    const [organizer] = await createTestUsers(1, { role: 'HOST', usernamePrefix: 'se-fmt-host' });
    const players = await createTestUsers(8, { usernamePrefix: 'se-fmt-player' });
    allUserIds.push(organizer!.id, ...players.map((p) => p.id));

    await signInRequest(request, organizer!.id, BACKEND);
    const { slug } = await createTournament(request, {
      name: `E2E SE Formats ${Date.now()}`,
      format: 'SINGLE_ELIMINATION',
    });

    const patchRes = await request.patch(`${BACKEND}/api/tournaments/${slug}`, {
      data: {
        swiss_match_format: 'BO1',
        playoff_match_format: 'BO3',
        finale_match_format: 'BO5',
        has_third_place_match: true,
      },
    });
    expect(patchRes.ok(), await patchRes.text()).toBe(true);

    await registerUsers(slug, players, BACKEND);
    await generateBracket(request, slug, BACKEND);

    const bracketRes = await request.get(`${BACKEND}/api/tournaments/${slug}/bracket`);
    expect(bracketRes.ok()).toBe(true);
    const { matches } = (await bracketRes.json()) as { matches: Node[] };
    expect(matches).toHaveLength(8);

    const smallFinal = matches.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE')!;
    const final = matches.find((m) => m.nextMatchId === null && m !== smallFinal)!;
    const semis = matches.filter((m) => m.nextMatchId === final.matchId);
    const quarters = matches.filter((m) => m.round === 1);

    expect(final.matchFormat).toBe('BO5');
    expect(semis).toHaveLength(2);
    for (const sf of semis) expect(sf.matchFormat).toBe('BO3');
    expect(quarters).toHaveLength(4);
    for (const qf of quarters) expect(qf.matchFormat).toBe('BO1');
    expect(smallFinal.matchFormat).toBe('BO3');

    // The override is persisted on the Match rows (what the series-completion logic reads),
    // and SE matches stay phase-less apart from the small final.
    const rows = await prisma.match.findMany({
      where: { tournament: { slug }, deleted_at: null },
      select: { id: true, phase: true, match_format: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(final.matchId)!.match_format).toBe('BO5');
    for (const sf of semis) expect(byId.get(sf.matchId)!.match_format).toBe('BO3');
    expect(rows.filter((r) => r.phase !== null).map((r) => r.phase)).toEqual(['PLAYOFF_THIRD_PLACE']);
  });
});
