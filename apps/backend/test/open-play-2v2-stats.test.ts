/**
 * Regression: faction statistics assumed Open Play is always 1v1 (they only checked the TOURNAMENT's
 * competitor_format). Open Play 2v2 games (competitor_format on the match, team-as-actor) leaked into
 * the 1v1 faction stats / heatmap with the captains' factions and were missing from the duo meta.
 *
 * Requires real PostgreSQL. Uses its own GameVersion so the assertions are isolated from dev data.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { recomputeFactionStats } from '../src/lib/recompute-faction-stats.js';
import { getMatchupMatrix } from '../src/lib/heatmap.js';
import { computeDuoMeta } from '../src/lib/duo-meta.js';

let versionId = '';
let factions: string[] = [];

beforeAll(async () => {
  const v = await prisma.gameVersion.create({
    data: { name: `stats-2v2-test-${randomUUID().slice(0, 8)}`, start_date: new Date('2099-01-01'), end_date: new Date('2099-12-31') },
  });
  versionId = v.id;
  const f = await prisma.faction.findMany({ take: 4, select: { id: true }, orderBy: { id: 'asc' } });
  factions = f.map((x) => x.id);
  expect(factions.length).toBe(4);
});

afterEach(async () => {
  await prisma.matchupStats.deleteMany({ where: { version_id: versionId } });
  await prisma.factionStats.deleteMany({ where: { version_id: versionId } });
  await prisma.match.deleteMany({ where: { version_id: versionId } });
});

afterAll(async () => {
  await prisma.gameVersion.deleteMany({ where: { id: versionId } });
  await prisma.$disconnect();
});

/** One completed Open Play game in the test version; side 1 wins. */
async function openPlayGame(format: 'ONE_V_ONE' | 'TWO_V_TWO') {
  const [f0, f1, f2, f3] = factions as [string, string, string, string];
  const p1 = randomUUID();
  const p2 = randomUUID();
  const match = await prisma.match.create({
    data: {
      type: 'OPEN_PLAY',
      round: 1,
      match_number: 0,
      player1_id: p1,
      player2_id: p2,
      status: 'COMPLETED',
      winner_id: p1,
      competitor_format: format,
      version_id: versionId,
    },
  });
  await prisma.matchGame.create({
    data: {
      match_id: match.id,
      game_number: 1,
      status: 'COMPLETED',
      counts_for_leaderboard: true,
      battle_type: 'DOMINATION',
      winner_id: p1,
      player1_faction_id: f0,
      player2_faction_id: f2,
      ...(format === 'TWO_V_TWO' ? { player1_faction_id_2: f1, player2_faction_id_2: f3 } : {}),
    },
  });
}

describe('Open Play 2v2 in faction statistics', () => {
  it('recomputeFactionStats counts only the 1v1 game, not the Open Play 2v2 one', async () => {
    await openPlayGame('ONE_V_ONE');
    await openPlayGame('TWO_V_TWO');
    const result = await recomputeFactionStats(prisma, versionId);
    expect(result.gamesProcessed).toBe(1);
    const played = await prisma.factionStats.aggregate({
      where: { version_id: versionId },
      _sum: { matches_played: true },
    });
    expect(played._sum.matches_played).toBe(2); // one game = two faction sides
  });

  it('the 1v1 matchup heatmap ignores Open Play 2v2 games', async () => {
    await openPlayGame('TWO_V_TWO');
    expect(await getMatchupMatrix(prisma, versionId)).toEqual([]);
    await openPlayGame('ONE_V_ONE');
    expect((await getMatchupMatrix(prisma, versionId)).length).toBeGreaterThan(0);
  });

  it('the duo meta includes Open Play 2v2 games (and not 1v1 ones)', async () => {
    await openPlayGame('ONE_V_ONE');
    expect(await computeDuoMeta(prisma, versionId)).toEqual([]);
    await openPlayGame('TWO_V_TWO');
    const duos = await computeDuoMeta(prisma, versionId);
    expect(duos).toHaveLength(2); // one duo per side
    expect(duos.reduce((n, d) => n + d.wins, 0)).toBe(1);
  });
});
