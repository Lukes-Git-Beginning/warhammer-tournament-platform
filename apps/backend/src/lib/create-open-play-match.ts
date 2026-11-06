import type { PrismaClient, $Enums } from '@rizzotto/db';
import { snapshotWeeklyBans } from './weekly-ban.js';

/** Battle types whose 1v1 Bo3 picks factions with the 3×3 matrix instead of the blind pick (VL picking). */
export const OPEN_PLAY_MATRIX_BATTLE_TYPES: readonly $Enums.BattleType[] = ['LAND_BATTLE', 'CONQUEST'];

/** Open Play's faction step for a new match: MATRIX for a 1v1 Bo3 in Land Battle or Conquest, else the blind pick (null). */
export function openPlayPickMode(
  battleType: $Enums.BattleType,
  competitorFormat: $Enums.CompetitorFormat,
  matchFormat: $Enums.MatchFormat | null,
): 'MATRIX' | null {
  return competitorFormat === 'ONE_V_ONE' && matchFormat === 'BO3' && OPEN_PLAY_MATRIX_BATTLE_TYPES.includes(battleType)
    ? 'MATRIX'
    : null;
}

/**
 * Creates an Open Play match with:
 * - A random map drawn from the AVAILABLE pool for the given battle type
 * - A MatchGame (stamped with the battle type) ready for the faction step
 * - A MatchBlindPick (both factions null — awaiting player input); none for the matrix, whose row comes with the
 *   first lock
 * - The players' weekly bans as they stand now (2v2: all four members)
 */
export async function createOpenPlayMatch(
  prisma: PrismaClient,
  player1Id: string,
  player2Id: string,
  source: 'QUEUE' | 'CHALLENGE' | 'AVAILABILITY' = 'QUEUE',
  battleType: $Enums.BattleType = 'DOMINATION',
  // 1v1 → player ids are Users; 2v2 → they are Team ids (team-as-actor). Stamped on the match so
  // the shared play/report flow treats an Open-Play match as 2v2 without any tournament.
  competitorFormat: $Enums.CompetitorFormat = 'ONE_V_ONE',
  // Series length of a queue match (Bo1/Bo3, Siege always Bo2). Stored on Match.match_format, which
  // finalizeGameResult reads first; null/omitted keeps the legacy default (Bo1 unless a challenge says otherwise).
  matchFormat: $Enums.MatchFormat | null = null,
): Promise<{ matchId: string; mapId: string | null; mapName: string | null }> {
  const maps = await prisma.map.findMany({
    where: { deleted_at: null, available: true, battle_type: battleType },
    select: { id: true, name: true },
  });
  const randomMap = maps.length > 0 ? maps[Math.floor(Math.random() * maps.length)] : null;

  const activeVersion = await prisma.gameVersion.findFirst({
    where: { is_active: true },
    select: { id: true },
  });

  const pickMode = openPlayPickMode(battleType, competitorFormat, matchFormat);
  const banUserIds =
    competitorFormat === 'TWO_V_TWO'
      ? (
          await prisma.teamMember.findMany({
            where: { team_id: { in: [player1Id, player2Id] }, accepted_at: { not: null } },
            orderBy: { invited_at: 'asc' },
            select: { team_id: true, user_id: true },
          })
        )
          .sort((a, b) => Number(a.team_id === player2Id) - Number(b.team_id === player2Id))
          .map((m) => m.user_id)
      : [player1Id, player2Id];
  const weeklyBans = await snapshotWeeklyBans(prisma, banUserIds);

  const newMatch = await prisma.$transaction(async (tx) => {
    const match = await tx.match.create({
      data: {
        type: 'OPEN_PLAY',
        source,
        round: 0,
        match_number: 0,
        player1_id: player1Id,
        player2_id: player2Id,
        competitor_format: competitorFormat,
        match_format: matchFormat,
        status: 'ONGOING',
        version_id: activeVersion?.id ?? null,
        pick_mode: pickMode,
        weekly_bans: weeklyBans,
      },
    });

    const game = await tx.matchGame.create({
      data: {
        match_id: match.id,
        game_number: 1,
        status: 'PENDING',
        counts_for_leaderboard: true,
        battle_type: battleType,
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

    if (!pickMode) await tx.matchBlindPick.create({ data: { game_id: game.id } });

    return match;
  });

  return {
    matchId: newMatch.id,
    mapId: randomMap?.id ?? null,
    mapName: randomMap?.name ?? null,
  };
}
