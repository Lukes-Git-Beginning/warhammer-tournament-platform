import type { PrismaClient } from '@rizzotto/db';

export type GameResult = 'P1' | 'P2' | 'D';

/**
 * Test helper: seed the SOURCE data the live `getMatchupMatrix` aggregates.
 *
 * Since the heatmap is computed live from COMPLETED MatchGames (no longer read
 * from the persisted MatchupStats snapshot), matchup tests must seed real games
 * rather than MatchupStats rows.
 */

/** Ensures two deterministic player users exist for matchup seeding. */
export async function ensureMatchupPlayers(
  prisma: PrismaClient,
  u1: string,
  u2: string,
  tag: string,
): Promise<void> {
  await prisma.user.createMany({
    data: [
      { id: u1, discord_id: `${tag}-mu1`, username: `${tag} P1` },
      { id: u2, discord_id: `${tag}-mu2`, username: `${tag} P2` },
    ],
    skipDuplicates: true,
  });
}

let seq = 0;

/**
 * Seeds one OPEN_PLAY match (u1 vs u2) in `seasonId` with one COMPLETED MatchGame
 * per entry in `results`. player1 plays `p1f`, player2 plays `p2f`; each result
 * picks the winner — 'P1' | 'P2' | 'D' (draw → winner_id null).
 */
export async function seedMatchupGames(
  prisma: PrismaClient,
  opts: { seasonId: string; u1: string; u2: string; p1f: string; p2f: string; results: GameResult[] },
): Promise<string> {
  const match = await prisma.match.create({
    data: {
      type: 'OPEN_PLAY',
      round: 0,
      match_number: ++seq,
      player1_id: opts.u1,
      player2_id: opts.u2,
      status: 'COMPLETED',
      season_id: opts.seasonId,
    },
  });
  for (let i = 0; i < opts.results.length; i++) {
    const r = opts.results[i]!;
    await prisma.matchGame.create({
      data: {
        match_id: match.id,
        game_number: i + 1,
        status: 'COMPLETED',
        counts_for_leaderboard: true,
        player1_faction_id: opts.p1f,
        player2_faction_id: opts.p2f,
        winner_id: r === 'P1' ? opts.u1 : r === 'P2' ? opts.u2 : null,
      },
    });
  }
  return match.id;
}

/** Removes all matches + games seeded for a season, plus the given player users. */
export async function cleanupMatchupGames(
  prisma: PrismaClient,
  seasonId: string,
  userIds: string[],
): Promise<void> {
  const matches = await prisma.match.findMany({ where: { season_id: seasonId }, select: { id: true } });
  const ids = matches.map((m) => m.id);
  if (ids.length) await prisma.matchGame.deleteMany({ where: { match_id: { in: ids } } });
  await prisma.match.deleteMany({ where: { season_id: seasonId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
