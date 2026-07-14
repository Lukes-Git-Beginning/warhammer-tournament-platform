import type { Prisma, PrismaClient, QueueEventType } from '@rizzotto/db';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Records an Open Play queue/match lifecycle event for the admin activity log.
 *
 * Best-effort: never throws. The observability log must never break the
 * user-facing queue/match flow, so write failures are swallowed.
 */
export async function logQueueActivity(
  db: Db,
  event: QueueEventType,
  userId: string,
  opts: { matchId?: string | null; opponentId?: string | null; level?: number | null } = {},
): Promise<void> {
  try {
    await db.queueActivityLog.create({
      data: {
        user_id: userId,
        event,
        match_id: opts.matchId ?? null,
        opponent_id: opts.opponentId ?? null,
        level: opts.level ?? null,
      },
    });
  } catch {
    /* swallow — the activity log is non-critical observability */
  }
}
