import type { FastifyInstance } from 'fastify';
import { logQueueActivity } from './queue-activity.js';
import { runMatchmakingTick, resetContactedSet } from './matchmaking-tick.js';

/**
 * Cancel an Open Play match — the single source of truth shared by the player-initiated cancel
 * route and the blind-pick no-show timeout. Sets the match to CANCELLED, finalizes any
 * reported-but-unconfirmed game to its real result (a reported game is statistically real),
 * cancels the remaining unreported games (so a cancelled match fabricates no result and nothing
 * counts), logs the CANCEL for both players, and immediately re-runs matchmaking so the freed
 * players can be re-paired.
 */
export async function cancelOpenPlayMatch(
  fastify: FastifyInstance,
  match: { id: string; player1_id: string | null; player2_id: string | null },
): Promise<void> {
  await fastify.prisma.$transaction(async (tx) => {
    await tx.match.update({ where: { id: match.id }, data: { status: 'CANCELLED' } });
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
}
