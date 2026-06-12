import type { PrismaClient } from '@rizzotto/db';

/**
 * Creates an Open Play match with:
 * - A random map drawn from the global map pool
 * - A MatchGame ready for blind faction pick
 * - A MatchBlindPick (both factions null — awaiting player input)
 */
export async function createOpenPlayMatch(
  prisma: PrismaClient,
  player1Id: string,
  player2Id: string,
): Promise<{ matchId: string; mapId: string | null; mapName: string | null }> {
  const maps = await prisma.map.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true },
  });
  const randomMap = maps.length > 0 ? maps[Math.floor(Math.random() * maps.length)] : null;

  const activeSeason = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });

  const newMatch = await prisma.$transaction(async (tx) => {
    const match = await tx.match.create({
      data: {
        type: 'OPEN_PLAY',
        round: 0,
        match_number: 0,
        player1_id: player1Id,
        player2_id: player2Id,
        status: 'ONGOING',
        season_id: activeSeason?.id ?? null,
      },
    });

    const game = await tx.matchGame.create({
      data: {
        match_id: match.id,
        game_number: 1,
        status: 'PENDING',
        counts_for_leaderboard: true,
      },
    });

    if (randomMap) {
      await tx.matchMapDecision.create({
        data: {
          game_id: game.id,
          mode: 'RANDOM',
          coin_flip_seed: `open_play_${match.id}`,
          top_player_id: player1Id,
          bottom_player_id: player2Id,
          bans_top: [],
          bans_bottom: [],
          active_pool: [],
          picked_map_id: randomMap.id,
          decided_at: new Date(),
        },
      });
    }

    await tx.matchBlindPick.create({ data: { game_id: game.id } });

    return match;
  });

  return {
    matchId: newMatch.id,
    mapId: randomMap?.id ?? null,
    mapName: randomMap?.name ?? null,
  };
}
