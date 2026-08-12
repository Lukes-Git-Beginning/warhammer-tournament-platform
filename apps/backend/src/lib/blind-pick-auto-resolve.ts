import type { FastifyInstance } from 'fastify';
import { cancelOpenPlayMatch } from './cancel-open-play-match.js';
import { escalateQueuePenalty } from './queue-penalty.js';
import {
  notifyQueueTimeout,
  notifyQueueWarning,
  notifyQueueAbuseToStaff,
} from './discord-notify.js';

/**
 * How long a blind faction pick may sit unfinished before the timeout fires. For Open Play this
 * is the deadline for BOTH players to pick (anchored to match creation); for a Blind Pick
 * Tournament it's how long the second player has once the first locked. Mirrored on the frontend
 * countdown (GameTile.tsx). The cron checks every minute, so worst-case latency is +1 minute.
 */
export const BLIND_PICK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Blind-Pick Tournament (type TOURNAMENT) fallback: a tournament match MUST produce a result, so
 * if one player locked and the opponent didn't respond within the window, auto-assign the missing
 * side a random (allowlist-respecting) faction and reveal. Unchanged from the original behaviour,
 * now scoped to tournaments only — Open Play no-shows are cancelled instead (see below).
 */
async function autoResolveTournamentBlindPicks(fastify: FastifyInstance, cutoff: Date): Promise<number> {
  const stale = await fastify.prisma.matchBlindPick.findMany({
    where: {
      revealed_at: null,
      game: { match: { type: 'TOURNAMENT' } },
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
          match: { select: { id: true, tournament: { select: { faction_allowlist: { select: { faction_id: true } } } } } },
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
    const allowlist = pick.game.match.tournament?.faction_allowlist.map((f) => f.faction_id) ?? [];
    const allowed = allowlist.length > 0 ? allFactions.filter((f) => allowlist.includes(f.id)) : allFactions;
    const pool = allowed.filter((f) => f.id !== lockedFactionId);
    const randomFaction = pool[Math.floor(Math.random() * pool.length)] ?? allowed[0];
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
      fastify.log.warn({ err, gameId: pick.game_id }, 'Failed to auto-resolve tournament blind pick');
    }
  }

  return resolved;
}

/**
 * Open Play no-show handling: the faction pick is the one meaningful interaction, so if a player
 * hasn't picked by the deadline the match is CANCELLED (freeing both players back into matchmaking)
 * and every player who did NOT pick gets a single queue-penalty escalation step (same stages as
 * queue-ghosting: 1st = warning, then 1h / 24h). A player who DID pick walks away with no penalty.
 *
 * The deadline is BLIND_PICK_TIMEOUT_MS after the FIRST lock when one player has picked (matches
 * the frontend countdown, which anchors to firstLockedAt), and after match creation when NEITHER
 * has picked (the total no-show fallback — no lock to anchor to).
 */
async function cancelOpenPlayNoShows(fastify: FastifyInstance, cutoff: Date): Promise<number> {
  const stale = await fastify.prisma.matchBlindPick.findMany({
    where: {
      revealed_at: null,
      game: { match: { type: 'OPEN_PLAY', status: 'ONGOING', deleted_at: null } },
      OR: [
        { player1_locked_at: { not: null, lt: cutoff }, player2_locked_at: null },
        { player2_locked_at: { not: null, lt: cutoff }, player1_locked_at: null },
        {
          player1_locked_at: null,
          player2_locked_at: null,
          game: { match: { created_at: { lt: cutoff } } },
        },
      ],
    },
    select: {
      player1_locked_at: true,
      player2_locked_at: true,
      game: {
        select: {
          match: {
            select: {
              id: true,
              player1_id: true,
              player2_id: true,
              player1: { select: { id: true, username: true, discord_id: true } },
              player2: { select: { id: true, username: true, discord_id: true } },
            },
          },
        },
      },
    },
  });

  if (stale.length === 0) return 0;

  const nowMs = Date.now();
  let cancelled = 0;

  for (const pick of stale) {
    const match = pick.game.match;
    const noShows: { id: string; username: string; discord_id: string | null }[] = [];
    if (!pick.player1_locked_at && match.player1) noShows.push(match.player1);
    if (!pick.player2_locked_at && match.player2) noShows.push(match.player2);

    try {
      await cancelOpenPlayMatch(fastify, {
        id: match.id,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
      });

      if (fastify.redis) {
        for (const u of noShows) {
          const outcome = await escalateQueuePenalty(fastify.redis, u.id, nowMs);
          if (!outcome.tripped || !u.discord_id) continue;
          if (outcome.timeoutSec > 0) {
            void notifyQueueTimeout(u.discord_id, outcome.timeoutSec);
            void notifyQueueAbuseToStaff(u.username, outcome.level, outcome.timeoutSec);
          } else {
            void notifyQueueWarning(u.discord_id);
          }
        }
      }
      cancelled++;
    } catch (err) {
      fastify.log.warn({ err, matchId: match.id }, 'Failed to cancel Open Play no-show match');
    }
  }

  return cancelled;
}

/**
 * Called by the cron every minute. Two behaviours: tournament blind picks get the random-faction
 * fallback (a tournament needs a result); Open Play blind picks that no one finished in time get
 * cancelled + the no-show(s) penalised. Returns the number of picks acted on.
 */
export async function autoResolveStaleBlindPicks(fastify: FastifyInstance): Promise<number> {
  const cutoff = new Date(Date.now() - BLIND_PICK_TIMEOUT_MS);
  const [tournament, openPlay] = await Promise.all([
    autoResolveTournamentBlindPicks(fastify, cutoff),
    cancelOpenPlayNoShows(fastify, cutoff),
  ]);
  return tournament + openPlay;
}
