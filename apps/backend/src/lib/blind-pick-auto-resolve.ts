import type { FastifyInstance } from 'fastify';

const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Scans for blind picks where one player locked but the opponent hasn't responded
 * within the timeout window, then auto-assigns a random faction and reveals.
 * Called by the cron task every minute.
 */
export async function autoResolveStaleBlindPicks(fastify: FastifyInstance): Promise<number> {
  const cutoff = new Date(Date.now() - TIMEOUT_MS);

  const stale = await fastify.prisma.matchBlindPick.findMany({
    where: {
      revealed_at: null,
      OR: [
        { player1_locked_at: { not: null, lt: cutoff }, player2_locked_at: null },
        { player2_locked_at: { not: null, lt: cutoff }, player1_locked_at: null },
      ],
    },
    include: {
      game: {
        select: {
          id: true,
          map_decision: { select: { picked_map_id: true } },
          match: { select: { id: true } },
        },
      },
    },
  });

  if (stale.length === 0) return 0;

  const allFactions = await fastify.prisma.faction.findMany({ select: { id: true } });
  if (allFactions.length === 0) return 0;

  const now = new Date();
  let resolved = 0;

  for (const pick of stale) {
    const lockedFactionId = pick.player1_faction_id ?? pick.player2_faction_id;
    const pool = allFactions.filter((f) => f.id !== lockedFactionId);
    const randomFaction = pool[Math.floor(Math.random() * pool.length)];
    if (!randomFaction) continue;

    try {
      const updated = await fastify.prisma.matchBlindPick.update({
        where: { game_id: pick.game_id },
        data: {
          player1_faction_id: pick.player1_faction_id ?? randomFaction.id,
          player2_faction_id: pick.player2_faction_id ?? randomFaction.id,
          player1_locked_at: pick.player1_locked_at ?? now,
          player2_locked_at: pick.player2_locked_at ?? now,
          revealed_at: now,
        },
      });

      const matchId = pick.game.match.id;
      const room = `match_decision_${matchId}`;

      if (fastify.io) {
        fastify.io.to(room).emit('match.blind-pick.update', {
          matchId,
          player1Locked: true,
          player2Locked: true,
          revealedAt: now.toISOString(),
          player1FactionId: updated.player1_faction_id,
          player2FactionId: updated.player2_faction_id,
        });

        if (pick.game.map_decision?.picked_map_id) {
          fastify.io.to(room).emit('match.decision.complete', {
            matchId,
            pickedMapId: pick.game.map_decision.picked_map_id,
            decidedAt: now.toISOString(),
          });
        }
      }

      resolved++;
    } catch (err) {
      fastify.log.warn({ err, gameId: pick.game_id }, 'Failed to auto-resolve blind pick');
    }
  }

  return resolved;
}
