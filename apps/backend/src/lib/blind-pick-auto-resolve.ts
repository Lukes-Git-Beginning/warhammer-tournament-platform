import type { FastifyInstance } from 'fastify';
import { cancelOpenPlayMatch } from './cancel-open-play-match.js';
import { escalateQueuePenalty } from './queue-penalty.js';
import {
  notifyQueueTimeout,
  notifyQueueWarning,
  notifyQueueAbuseToStaff,
} from './discord-notify.js';

/**
 * How long a blind faction pick may sit unfinished before the timeout fires. The two contexts get
 * DIFFERENT deadlines on purpose:
 *  · Open Play (ladder): 5 minutes — then the match is CANCELLED and the no-show is penalised.
 *  · Blind Pick Tournament: 2 minutes (the original, stricter deadline — a tournament must keep
 *    moving) — then the missing side is auto-assigned a random allowlist faction.
 * Both are mirrored on the frontend countdown (GameTile.tsx). The cron checks every minute, so
 * worst-case latency is +1 minute.
 */
export const OPEN_PLAY_BLIND_PICK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — ladder, then cancel
export const TOURNAMENT_BLIND_PICK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes — tournament, then random-pick
/** Faction bans (Blind Pick tournaments): after the first side locked its bans, the other side has
 *  this long — then its bans lapse and the bans are revealed. Same 2 minutes as the pick. */
export const FACTION_BAN_TIMEOUT_MS = 2 * 60 * 1000;

/** Factions banned for this game by either side — empty until the bans are revealed. */
export function revealedBans(
  row: { bans_revealed_at: Date | null; player1_bans: string[]; player2_bans: string[] } | null,
): string[] {
  if (!row?.bans_revealed_at) return [];
  return [...new Set([...row.player1_bans, ...row.player2_bans])];
}

/**
 * Faction-ban timeout (Alex 2026-10-10: a side that doesn't ban in time simply loses its bans).
 * One side locked its bans more than FACTION_BAN_TIMEOUT_MS ago and the other hasn't → mark the
 * missing side as locked with no bans and reveal, so the game moves on to the blind pick.
 */
async function autoResolveStaleFactionBans(fastify: FastifyInstance, cutoff: Date): Promise<number> {
  const stale = await fastify.prisma.matchBlindPick.findMany({
    where: {
      bans_revealed_at: null,
      OR: [
        { player1_bans_locked_at: { not: null, lt: cutoff }, player2_bans_locked_at: null },
        { player2_bans_locked_at: { not: null, lt: cutoff }, player1_bans_locked_at: null },
      ],
    },
    select: {
      game_id: true,
      player1_bans_locked_at: true,
      player2_bans_locked_at: true,
      game: { select: { match: { select: { id: true, tournament: { select: { faction_bans_per_player: true } } } } } },
    },
  });

  const now = new Date();
  let resolved = 0;
  for (const row of stale) {
    try {
      const updated = await fastify.prisma.matchBlindPick.update({
        where: { game_id: row.game_id },
        data: {
          player1_bans_locked_at: row.player1_bans_locked_at ?? now,
          player2_bans_locked_at: row.player2_bans_locked_at ?? now,
          bans_revealed_at: now,
        },
      });
      const matchId = row.game.match.id;
      const first = row.player1_bans_locked_at ?? row.player2_bans_locked_at;
      fastify.io?.to(`match_decision_${matchId}`).emit('match.faction-bans.update', {
        matchId,
        perPlayer: row.game.match.tournament?.faction_bans_per_player ?? 0,
        player1Locked: true,
        player2Locked: true,
        firstLockedAt: first?.toISOString() ?? null,
        revealedAt: now.toISOString(),
        player1Bans: updated.player1_bans,
        player2Bans: updated.player2_bans,
      });
      resolved++;
    } catch (err) {
      fastify.log.warn({ err, gameId: row.game_id }, 'Failed to auto-resolve faction bans');
    }
  }
  return resolved;
}

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
          match: { select: { id: true, competitor_format: true, tournament: { select: { faction_allowlist: { select: { faction_id: true } } } } } },
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
    const banned = revealedBans(pick); // this game's faction bans are off-limits for the random pick
    const allowed = (allowlist.length > 0 ? allFactions.filter((f) => allowlist.includes(f.id)) : allFactions).filter(
      (f) => !banned.includes(f.id),
    );
    const pool = allowed.filter((f) => f.id !== lockedFactionId);
    const randomFaction = pool[Math.floor(Math.random() * pool.length)] ?? allowed[0];
    if (!randomFaction) continue;

    // 2v2: the timed-out team also needs a teammate faction (positional _2). It must differ from
    // the team's own captain faction; like the captain it also avoids mirroring the locked side's
    // pair where the pool allows.
    const isTeam = pick.game.match.competitor_format === 'TWO_V_TWO';
    const p1Missing = !pick.player1_locked_at;
    const lockedPair = p1Missing
      ? [pick.player2_faction_id, pick.player2_faction_id_2]
      : [pick.player1_faction_id, pick.player1_faction_id_2];
    const teammatePool = allowed.filter((f) => f.id !== randomFaction.id);
    const teammatePreferred = teammatePool.filter((f) => !lockedPair.includes(f.id));
    const teammateFaction = isTeam
      ? (teammatePreferred[Math.floor(Math.random() * teammatePreferred.length)] ??
        teammatePool[Math.floor(Math.random() * teammatePool.length)] ??
        null)
      : null;

    try {
      const updated = await fastify.prisma.matchBlindPick.update({
        where: { game_id: pick.game_id },
        data: {
          player1_faction_id: pick.player1_faction_id ?? randomFaction.id,
          player2_faction_id: pick.player2_faction_id ?? randomFaction.id,
          ...(isTeam && teammateFaction
            ? p1Missing
              ? { player1_faction_id_2: pick.player1_faction_id_2 ?? teammateFaction.id }
              : { player2_faction_id_2: pick.player2_faction_id_2 ?? teammateFaction.id }
            : {}),
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
 * The deadline is OPEN_PLAY_BLIND_PICK_TIMEOUT_MS after the FIRST lock when one player has picked
 * (matches the frontend countdown, which anchors to firstLockedAt), and after match creation when
 * NEITHER has picked (the total no-show fallback — no lock to anchor to).
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
            },
          },
        },
      },
    },
  });

  if (stale.length === 0) return 0;

  // Open Play is always 1v1, so the match slots are User ids — resolve them directly
  // (we need discord_id for the no-show penalty DMs).
  const playerIds = [
    ...new Set(stale.flatMap((p) => [p.game.match.player1_id, p.game.match.player2_id]).filter((x): x is string => !!x)),
  ];
  const players = await fastify.prisma.user.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, username: true, discord_id: true },
  });
  const playerMap = new Map(players.map((u) => [u.id, u]));

  const nowMs = Date.now();
  let cancelled = 0;

  for (const pick of stale) {
    const match = pick.game.match;
    const p1 = match.player1_id ? playerMap.get(match.player1_id) : null;
    const p2 = match.player2_id ? playerMap.get(match.player2_id) : null;
    const noShows: { id: string; username: string; discord_id: string | null }[] = [];
    if (!pick.player1_locked_at && p1) noShows.push(p1);
    if (!pick.player2_locked_at && p2) noShows.push(p2);

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
  const now = Date.now();
  const [tournament, openPlay, bans] = await Promise.all([
    autoResolveTournamentBlindPicks(fastify, new Date(now - TOURNAMENT_BLIND_PICK_TIMEOUT_MS)),
    cancelOpenPlayNoShows(fastify, new Date(now - OPEN_PLAY_BLIND_PICK_TIMEOUT_MS)),
    autoResolveStaleFactionBans(fastify, new Date(now - FACTION_BAN_TIMEOUT_MS)),
  ]);
  return tournament + openPlay + bans;
}
