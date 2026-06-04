import type { PrismaClient } from '@rizzotto/db';

/**
 * Upserts a MatchGame row for the given match/game combination.
 * For v1 (Bo1), gameNumber is always 1.
 * Returns the MatchGame id.
 */
export async function ensureMatchGame(
  prisma: PrismaClient,
  matchId: string,
  gameNumber = 1,
): Promise<string> {
  const existing = await prisma.matchGame.findUnique({
    where: { match_id_game_number: { match_id: matchId, game_number: gameNumber } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: gameNumber },
    select: { id: true },
  });
  return created.id;
}
