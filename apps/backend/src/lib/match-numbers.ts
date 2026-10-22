import type { Prisma, PrismaClient } from '@rizzotto/db';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Highest match_number per round of a tournament, INCLUDING soft-deleted rows.
 *
 * The unique key (tournament_id, round, match_number) still counts a soft-deleted row, so any code
 * that numbers new rows from the live (deleted_at: null) rows alone reuses a deleted row's number and
 * fails with P2002. Seed new numbers from this instead. A Liechtenstein tick that got this wrong
 * stalled a live tournament after the host deleted one match (2026-10-22).
 */
export async function maxMatchNumberByRound(db: Db, tournamentId: string): Promise<Map<number, number>> {
  const rows = await db.match.groupBy({
    by: ['round'],
    where: { tournament_id: tournamentId }, // no deleted_at filter: deleted rows still hold their number
    _max: { match_number: true },
  });
  return new Map(rows.map((r) => [r.round, r._max.match_number ?? 0]));
}
