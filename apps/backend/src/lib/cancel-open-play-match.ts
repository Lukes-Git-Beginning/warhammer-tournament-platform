import type { FastifyInstance } from 'fastify';
import { logQueueActivity } from './queue-activity.js';
import { runMatchmakingTick, resetContactedSet } from './matchmaking-tick.js';
import { notifyOpponentOfCancel } from './open-play-cancel-notify.js';

/** After a player cancels, the other side has this long to still report the battle. */
export const LATE_REPORT_WINDOW_MS = 2 * 60 * 60 * 1000;

type CancelState = { status: string; cancelled_slot: string | null; cancelled_at: Date | null };

/** Until when the other side may report, or null when no player cancelled this match. */
export function lateReportDeadline(match: CancelState): Date | null {
  if (match.status !== 'CANCELLED' || !match.cancelled_slot || !match.cancelled_at) return null;
  return new Date(match.cancelled_at.getTime() + LATE_REPORT_WINDOW_MS);
}

export function isLateReportOpen(match: CancelState, now = Date.now()): boolean {
  const deadline = lateReportDeadline(match);
  return !!deadline && deadline.getTime() > now;
}

/**
 * Cancel an Open Play match — the single source of truth shared by the player-initiated cancel
 * route and the blind-pick no-show timeout. Sets the match to CANCELLED, finalizes any
 * reported-but-unconfirmed game to its real result (a reported game is statistically real),
 * cancels the remaining unreported games (so a cancelled match fabricates no result and nothing
 * counts), logs the CANCEL for both players, and immediately re-runs matchmaking so the freed
 * players can be re-paired. The match itself stays, with CANCELLED as its outcome: `cancelledBy` (a
 * player, not the no-show timeout or staff) opens the late report for the other side, and an admin
 * can add a result at any time (PATCH /api/matches/:id/games/:gameNumber).
 */
export async function cancelOpenPlayMatch(
  fastify: FastifyInstance,
  match: { id: string; player1_id: string | null; player2_id: string | null },
  cancelledBy?: { userId: string; slot: string },
): Promise<void> {
  await fastify.prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: match.id },
      data: {
        status: 'CANCELLED',
        cancelled_at: new Date(),
        cancelled_by_id: cancelledBy?.userId ?? null,
        cancelled_slot: cancelledBy?.slot ?? null,
      },
    });
    // A reported-but-unconfirmed game is statistically real — finalize it to its reported result
    // instead of overwriting it with a draw.
    const reportedGames = await tx.matchGame.findMany({
      where: { match_id: match.id, status: 'PENDING', winner_id: null, reported_winner_id: { not: null } },
      select: { id: true, reported_winner_id: true },
    });
    for (const game of reportedGames) {
      await tx.matchGame.update({
        where: { id: game.id },
        data: { winner_id: game.reported_winner_id, status: 'COMPLETED', counts_for_leaderboard: true, played_at: new Date() },
      });
    }
    // Remaining games without a reported result are CANCELLED and do NOT count.
    await tx.matchGame.updateMany({
      where: { match_id: match.id, status: 'PENDING', winner_id: null, reported_winner_id: null },
      data: { status: 'CANCELLED', counts_for_leaderboard: false },
    });
  });

  await Promise.all([
    match.player1_id
      ? logQueueActivity(fastify.prisma, 'CANCEL', match.player1_id, { matchId: match.id, opponentId: match.player2_id })
      : Promise.resolve(),
    match.player2_id
      ? logQueueActivity(fastify.prisma, 'CANCEL', match.player2_id, { matchId: match.id, opponentId: match.player1_id })
      : Promise.resolve(),
  ]);

  // A match ending frees both players — start a fresh wait-cycle DM wave + re-pair immediately.
  await resetContactedSet(fastify);
  setImmediate(() => void runMatchmakingTick(fastify));
  if (cancelledBy) setImmediate(() => void notifyOpponentOfCancel(fastify, match.id));
}
