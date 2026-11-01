import type { DiscordClickKind, DiscordClickOutcome, Prisma, PrismaClient, QueueEventType, QueueJoinVia } from '@rizzotto/db';

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
  opts: { matchId?: string | null; opponentId?: string | null; level?: number | null; via?: QueueJoinVia; guildId?: string | null } = {},
): Promise<void> {
  try {
    await db.queueActivityLog.create({
      data: {
        user_id: userId,
        event,
        match_id: opts.matchId ?? null,
        opponent_id: opts.opponentId ?? null,
        level: opts.level ?? null,
        via: opts.via ?? null,
        guild_id: opts.guildId ?? null,
      },
    });
  } catch {
    /* swallow — the activity log is non-critical observability */
  }
}

/** One click on a way into Open Play on Discord and what it led to. Best-effort, like the log above. */
export async function logDiscordClick(
  db: Db,
  click: {
    kind: DiscordClickKind;
    outcome: DiscordClickOutcome;
    guildId?: string | null;
    userId?: string | null;
    matchId?: string | null;
  },
): Promise<void> {
  try {
    await db.discordClick.create({
      data: {
        kind: click.kind,
        outcome: click.outcome,
        guild_id: click.guildId ?? null,
        user_id: click.userId ?? null,
        match_id: click.matchId ?? null,
      },
    });
  } catch (err) {
    console.error('[queue-activity] failed to log Discord click', click.kind, err);
  }
}
