/**
 * Match Result Service — resolves, disputes, and overrides match outcomes.
 *
 * This module is the single source of truth for:
 *  - Completing a match (status → COMPLETED, winner_id, points, ELO, leaderboard)
 *  - Disputing a match (status → DISPUTED)
 *  - Writing AuditLog entries
 *  - Emitting Socket.IO events after DB writes
 *
 * It intentionally does NOT import fastify — callers pass prisma and io directly
 * so this lib is usable in tests without a full app instance.
 */

import type { PrismaClient } from '@rizzotto/db';
import type { MatchResultType } from '@rizzotto/types';
import type { Server } from 'socket.io';
import type { Redis } from 'ioredis';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@rizzotto/types';
import { tournamentRoom } from './emit.js';
import { invalidate } from './cache.js';
import { recomputeFactionStats } from './recompute-faction-stats.js';

type Io =
  | Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  | undefined;

// Default 3/1/0 scoring: PLAYER1_WIN → p1 gets 3, DRAW → both 1, DOUBLE_LOSS → both 0, PLAYER2_WIN → p2 gets 3
const DEFAULT_POINTS: Record<MatchResultType, { player1: number; player2: number }> = {
  PLAYER1_WIN: { player1: 3, player2: 0 },
  PLAYER2_WIN: { player1: 0, player2: 3 },
  DRAW: { player1: 1, player2: 1 },
  DOUBLE_LOSS: { player1: 0, player2: 0 },
};

export interface ResolveMatchResultOpts {
  /** If true, record action as 'result_overridden' in audit log */
  override?: boolean;
  /** Points to award player1 — if omitted, uses DEFAULT_POINTS */
  player1_points?: number | null;
  /** Points to award player2 — if omitted, uses DEFAULT_POINTS */
  player2_points?: number | null;
  /** Actor user id for audit log */
  actorId?: string;
  /** Reason text stored in audit log (for overrides) */
  reason?: string;
  /** Faction overrides — written to the match and latched onto TournamentParticipant if not set */
  player1FactionId?: string;
  player2FactionId?: string;
  /**
   * Per-game detail for a multi-game (non-Bo1) match. When provided, these game rows are
   * written verbatim (map / factions / winner, winnerId null = a per-game draw) instead of
   * collapsing the match onto a single game 1. The match-level `result` still drives the
   * winner + bracket progression; these rows are the statistical record. Existing games not
   * listed here are removed. Games are the statistical unit.
   */
  games?: Array<{
    gameNumber: number;
    mapId?: string | null;
    player1FactionId?: string | null;
    player2FactionId?: string | null;
    winnerId?: string | null;
  }>;
}

/**
 * Resolves a match with the given result:
 *  1. Determines winner_id from result
 *  2. Updates Match record (status=COMPLETED, result, winner_id, points)
 *  3. Advances winner to next_match if applicable
 *  4. Updates LeaderboardEntry (wins/losses/matches_played/total_points)
 *  5. Writes AuditLog
 *  6. Emits match_completed + bracket_update socket events
 *
 * Must be called inside or outside a transaction — caller decides.
 * Uses a raw prisma client (or transaction client) passed in.
 */
export async function resolveMatchResult(
  prisma: PrismaClient,
  matchId: string,
  result: MatchResultType,
  opts: ResolveMatchResultOpts = {},
  io?: Io,
  // Cache invalidation: callers that hold a redis handle (e.g. match-reports.ts via
  // invalidateScoringCaches) may pass it here so FactionStats/MatchupStats cache keys
  // are busted atomically after the transaction. Omitting redis is safe — the caller
  // is responsible for invalidation in that case (match-reports.ts already does so
  // immediately after resolveMatchResult). No existing callers are broken by this default.
  redis?: Redis,
): Promise<void> {
  const { override = false, actorId, reason } = opts;

  // Load match with tournament info
  const match = await prisma.match.findFirst({
    where: { id: matchId, deleted_at: null },
    select: {
      id: true,
      tournament_id: true,
      player1_id: true,
      player2_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      next_match_id: true,
      loser_next_match_id: true,
      bracket_side: true,
      tournament: {
        select: {
          id: true,
          counts_for_leaderboard: true,
          is_major: true,
          mode: true,
          restricted_factions: { select: { faction_id: true } },
        },
      },
    },
  });

  if (!match) {
    throw new Error(`Match ${matchId} not found`);
  }

  // Determine winner_id
  let winnerId: string | null = null;
  if (result === 'PLAYER1_WIN') {
    winnerId = match.player1_id ?? null;
  } else if (result === 'PLAYER2_WIN') {
    winnerId = match.player2_id ?? null;
  }
  // DRAW and DOUBLE_LOSS → winnerId stays null

  // Points
  const defaultPts = DEFAULT_POINTS[result];
  const p1Points = opts.player1_points ?? defaultPts.player1;
  const p2Points = opts.player2_points ?? defaultPts.player2;

  // Active season — tags the match (for the dynamic leaderboard), gates the
  // LeaderboardEntry update, and drives the post-transaction stats recompute.
  const activeSeason = await prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const p1FactionId = opts.player1FactionId ?? match.player1_faction_id ?? null;
    const p2FactionId = opts.player2FactionId ?? match.player2_faction_id ?? null;

    // 1. Update match
    await tx.match.update({
      where: { id: matchId },
      data: {
        status: 'COMPLETED',
        result,
        winner_id: winnerId,
        player1_points: p1Points,
        player2_points: p2Points,
        season_id: activeSeason?.id ?? null,
        played_at: new Date(),
        ...(p1FactionId ? { player1_faction_id: p1FactionId } : {}),
        ...(p2FactionId ? { player2_faction_id: p2FactionId } : {}),
      },
    });

    // Latch faction onto TournamentParticipant if not yet set (SFT: faction locked at registration)
    if (match.tournament?.mode === 'SFT') {
      if (p1FactionId && match.player1_id) {
        await tx.tournamentParticipant.updateMany({
          where: { tournament_id: match.tournament_id ?? undefined, user_id: match.player1_id, faction_id: null, deleted_at: null },
          data: { faction_id: p1FactionId },
        });
      }
      if (p2FactionId && match.player2_id) {
        await tx.tournamentParticipant.updateMany({
          where: { tournament_id: match.tournament_id ?? undefined, user_id: match.player2_id, faction_id: null, deleted_at: null },
          data: { faction_id: p2FactionId },
        });
      }
    }

    // 2. Bracket progression — advance winner to next match
    if (match.next_match_id && winnerId) {
      const nextMatch = await tx.match.findUnique({
        where: { id: match.next_match_id },
        select: { id: true, player1_id: true, player2_id: true },
      });
      if (nextMatch) {
        if (nextMatch.player1_id === null) {
          await tx.match.update({
            where: { id: nextMatch.id },
            data: { player1_id: winnerId },
          });
        } else {
          await tx.match.update({
            where: { id: nextMatch.id },
            data: { player2_id: winnerId },
          });
        }
      }
    }

    // 2b. DE loser progression — drop loser into losers bracket
    if (match.loser_next_match_id) {
      const loserId =
        winnerId === match.player1_id
          ? match.player2_id
          : winnerId === match.player2_id
            ? match.player1_id
            : null;

      if (loserId) {
        const lbMatch = await tx.match.findUnique({
          where: { id: match.loser_next_match_id },
          select: { id: true, player1_id: true, player2_id: true },
        });
        if (lbMatch) {
          if (lbMatch.player1_id === null) {
            await tx.match.update({
              where: { id: lbMatch.id },
              data: { player1_id: loserId },
            });
          } else if (lbMatch.player2_id === null) {
            await tx.match.update({
              where: { id: lbMatch.id },
              data: { player2_id: loserId },
            });
          }
        }
      }
    }

    // 2c. Grand Final reset-match handling
    // Convention: player1 in GF = WB champion; player2 = LB champion.
    // If WB champion wins (winnerId === player1_id), the Reset Match is never played.
    // If LB champion wins (winnerId === player2_id), activate the Reset Match.
    if (match.bracket_side === 'GRAND_FINAL' && match.next_match_id) {
      const resetMatch = await tx.match.findUnique({
        where: { id: match.next_match_id },
        select: { id: true, bracket_side: true },
      });

      if (resetMatch && resetMatch.bracket_side === 'GRAND_FINAL') {
        if (winnerId === match.player1_id) {
          // WB champion wins — cancel reset match (set as BYE so UI shows it as skipped)
          await tx.match.update({
            where: { id: resetMatch.id },
            data: { status: 'BYE', winner_id: winnerId },
          });
        } else if (winnerId === match.player2_id) {
          // LB champion wins — activate reset: both players enter the reset match
          // player1 = WB champion (who won GF as p1 in first bracket, now loses as p2 of GF)
          // Actually in the reset: WB-champion = match.player1_id, LB-champion = match.player2_id
          await tx.match.update({
            where: { id: resetMatch.id },
            data: {
              player1_id: match.player1_id,
              player2_id: match.player2_id,
              status: 'PENDING',
            },
          });
        }
      }
    }

    // 3. LeaderboardEntry updates (only when tournament counts for leaderboard)
    if (match.tournament?.counts_for_leaderboard ?? true) {
      if (activeSeason) {
        const seasonId = activeSeason.id;
        const players: Array<{
          userId: string;
          isWinner: boolean;
          isDraw: boolean;
          points: number;
        }> = [];

        if (match.player1_id) {
          players.push({
            userId: match.player1_id,
            isWinner: winnerId === match.player1_id,
            isDraw: result === 'DRAW',
            points: p1Points,
          });
        }
        if (match.player2_id) {
          players.push({
            userId: match.player2_id,
            isWinner: winnerId === match.player2_id,
            isDraw: result === 'DRAW',
            points: p2Points,
          });
        }

        for (const p of players) {
          await tx.leaderboardEntry.upsert({
            where: {
              user_id_season_id: {
                user_id: p.userId,
                season_id: seasonId,
              },
            },
            create: {
              user_id: p.userId,
              season_id: seasonId,
              games_played: 1,
              wins: p.isWinner ? 1 : 0,
              losses: !p.isWinner && !p.isDraw ? 1 : 0,
              total_points: p.points,
            },
            update: {
              games_played: { increment: 1 },
              wins: p.isWinner ? { increment: 1 } : undefined,
              losses: !p.isWinner && !p.isDraw ? { increment: 1 } : undefined,
              total_points: { increment: p.points },
            },
          });
        }
      }
    }

    // 4. Game-level records — the statistical unit (the match is just a container).
    //    FactionStats/MatchupStats are rebuilt from these rows by recomputeFactionStats()
    //    after the transaction — never incrementally — so overrides never double-count.
    if (opts.games && opts.games.length > 0) {
      // Multi-game override: write each provided game's map / factions / winner verbatim
      // (winnerId null = a per-game draw) and drop games the host removed from the series.
      const restricted = new Set(match.tournament?.restricted_factions.map((r) => r.faction_id) ?? []);
      const tournamentCounts = match.tournament?.counts_for_leaderboard ?? true;
      const keepNumbers = opts.games.map((g) => g.gameNumber);
      await tx.matchGame.deleteMany({ where: { match_id: matchId, game_number: { notIn: keepNumbers } } });
      for (const g of opts.games) {
        const gp1 = g.player1FactionId ?? null;
        const gp2 = g.player2FactionId ?? null;
        const isRestricted = restricted.size > 0 && ((gp1 !== null && restricted.has(gp1)) || (gp2 !== null && restricted.has(gp2)));
        const gameData = {
          status: 'COMPLETED' as const,
          winner_id: g.winnerId ?? null,
          player1_faction_id: gp1,
          player2_faction_id: gp2,
          played_at: new Date(),
          counts_for_leaderboard: tournamentCounts && !isRestricted,
        };
        const existing = await tx.matchGame.findFirst({
          where: { match_id: matchId, game_number: g.gameNumber },
          select: { id: true },
        });
        const gameId = existing
          ? (await tx.matchGame.update({ where: { id: existing.id }, data: gameData })).id
          : (await tx.matchGame.create({ data: { match_id: matchId, game_number: g.gameNumber, ...gameData } })).id;
        if (g.mapId !== undefined && match.player1_id && match.player2_id) {
          await tx.matchMapDecision.upsert({
            where: { game_id: gameId },
            update: { picked_map_id: g.mapId, decided_at: new Date() },
            create: {
              game_id: gameId,
              mode: 'HOST_PRESET',
              coin_flip_seed: 'host-override',
              top_player_id: match.player1_id,
              bottom_player_id: match.player2_id,
              picked_map_id: g.mapId,
              decided_at: new Date(),
            },
          });
        }
      }
    } else {
      // Single-game (Bo1) completion: create or refresh game 1 with the result + factions.
      const existingGames = await tx.matchGame.count({ where: { match_id: matchId } });
      const gameData = {
        status: 'COMPLETED' as const,
        winner_id: winnerId,
        player1_faction_id: p1FactionId,
        player2_faction_id: p2FactionId,
        played_at: new Date(),
        counts_for_leaderboard: match.tournament?.counts_for_leaderboard ?? true,
      };
      if (existingGames === 0) {
        await tx.matchGame.create({ data: { match_id: matchId, game_number: 1, ...gameData } });
      } else {
        await tx.matchGame.updateMany({ where: { match_id: matchId, game_number: 1 }, data: gameData });
      }
    }

    // 5. AuditLog
    await tx.auditLog.create({
      data: {
        entity_type: 'Match',
        entity_id: matchId,
        action: override ? 'result_overridden' : 'result_reported',
        actor_id: actorId ?? null,
        new_value: {
          result,
          winnerId,
          player1_points: p1Points,
          player2_points: p2Points,
          ...(reason ? { reason } : {}),
        },
      },
    });
  });

  // Rebuild faction/matchup stats from the COMPLETED game rows (idempotent) so a
  // re-edit/override can never double-count.
  if (activeSeason) {
    await recomputeFactionStats(prisma, activeSeason.id);
  }

  // Cache invalidation for FactionStats/MatchupStats keys — only when a redis
  // handle is provided. match-reports.ts already calls invalidateScoringCaches()
  // after resolveMatchResult() which covers these keys; passing redis here is
  // therefore optional and mainly useful for callers that skip the outer helper.
  if (redis) {
    await Promise.all([invalidate(redis, 'factions:*'), invalidate(redis, 'meta:*')]);
  }

  // 5. Socket events (after transaction committed)
  if (io && match.tournament_id) {
    io.to(tournamentRoom(match.tournament_id)).emit('match_completed', {
      tournamentId: match.tournament_id,
      matchId,
      result,
      winnerId,
      nextMatchId: match.next_match_id ?? null,
    });
    io.to(tournamentRoom(match.tournament_id)).emit('bracket_update', {
      tournamentId: match.tournament_id,
    });
  }
}

/**
 * Marks a match as DISPUTED and emits the socket event.
 */
export async function disputeMatch(
  prisma: PrismaClient,
  matchId: string,
  tournamentId: string,
  actorId: string | undefined,
  io?: Io,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: matchId },
      data: { status: 'DISPUTED' },
    });

    await tx.auditLog.create({
      data: {
        entity_type: 'Match',
        entity_id: matchId,
        action: 'match_disputed',
        actor_id: actorId ?? null,
        new_value: { status: 'DISPUTED' },
      },
    });
  });

  if (io) {
    io.to(tournamentRoom(tournamentId)).emit('match_disputed', {
      tournamentId,
      matchId,
    });
  }
}
