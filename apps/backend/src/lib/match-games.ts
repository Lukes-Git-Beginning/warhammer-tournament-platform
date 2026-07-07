import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@rizzotto/db';
import { completeMatch } from './complete-match.js';
import { recomputeFactionStats } from './recompute-faction-stats.js';
import { invalidate } from './cache.js';

/**
 * Upserts a MatchGame row for the given match/game combination.
 * For v1 (Bo1), gameNumber is always 1.
 * Returns the MatchGame id.
 */
export async function ensureMatchGame(
  prisma: PrismaClient,
  matchId: string,
  gameNumber = 1,
  countsForLeaderboard = true,
): Promise<string> {
  const existing = await prisma.matchGame.findUnique({
    where: { match_id_game_number: { match_id: matchId, game_number: gameNumber } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: gameNumber, counts_for_leaderboard: countsForLeaderboard },
    select: { id: true },
  });

  // 2D3 mode: draw one faction per player from their registered 3-faction pool and
  // write it onto the fresh game, so it shows on the game tile (like an SFT faction)
  // before the game is played. Runs only on creation → drawn once per game.
  await drawTwoD3GameFactions(prisma, matchId, created.id);

  return created.id;
}

/**
 * For TWO_D_THREE tournaments, randomly draws one faction per player from each
 * player's registered pool (TournamentParticipant.faction_ids) and writes them onto
 * the given freshly-created MatchGame. No-op for other modes / Open Play, or when a
 * player has no registered pool.
 */
async function drawTwoD3GameFactions(
  prisma: PrismaClient,
  matchId: string,
  gameId: string,
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      player1_id: true,
      player2_id: true,
      tournament: {
        select: {
          mode: true,
          participants: {
            where: { deleted_at: null },
            select: { user_id: true, faction_ids: true },
          },
        },
      },
    },
  });
  if (!match || match.tournament?.mode !== 'TWO_D_THREE') return;

  const poolByUser = new Map(
    match.tournament.participants.map((p) => [p.user_id, p.faction_ids]),
  );
  const drawOne = (userId: string | null): string | null => {
    if (!userId) return null;
    const pool = poolByUser.get(userId) ?? [];
    if (pool.length === 0) return null;
    return pool[randomInt(pool.length)] ?? null;
  };

  const p1FactionId = drawOne(match.player1_id);
  const p2FactionId = drawOne(match.player2_id);
  if (p1FactionId === null && p2FactionId === null) return;

  await prisma.matchGame.update({
    where: { id: gameId },
    data: {
      ...(p1FactionId !== null ? { player1_faction_id: p1FactionId } : {}),
      ...(p2FactionId !== null ? { player2_faction_id: p2FactionId } : {}),
    },
  });
}

function resolveMatchFormat(
  tournament: { swiss_match_format: string; playoff_match_format: string; finale_match_format: string },
  phase: string | null,
): 'BO1' | 'BO3' | 'BO5' {
  if (phase === 'PLAYOFF_FINAL') return tournament.finale_match_format as 'BO1' | 'BO3' | 'BO5';
  if (phase?.startsWith('PLAYOFF')) return tournament.playoff_match_format as 'BO1' | 'BO3' | 'BO5';
  return tournament.swiss_match_format as 'BO1' | 'BO3' | 'BO5';
}

/**
 * Finalizes a game result: sets game COMPLETED, resolves factions automatically,
 * then either completes the match (series won) or creates the next MatchGame row.
 */
export async function finalizeGameResult(
  fastify: FastifyInstance,
  gameId: string,
): Promise<void> {
  const game = await fastify.prisma.matchGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      match_id: true,
      game_number: true,
      reported_winner_id: true,
      player1_faction_id: true,
      player2_faction_id: true,
      blind_pick: {
        select: {
          revealed_at: true,
          player1_faction_id: true,
          player2_faction_id: true,
        },
      },
      faction_matrix: {
        select: {
          decided_at: true,
          picked_cell: true,
          p1_factions: true,
          p2_factions: true,
        },
      },
      match: {
        select: {
          player1_id: true,
          player2_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
          phase: true,
          tournament: {
            select: {
              mode: true,
              counts_for_leaderboard: true,
              swiss_match_format: true,
              playoff_match_format: true,
              finale_match_format: true,
              participants: {
                select: {
                  user_id: true,
                  faction: { select: { id: true } },
                },
                where: { deleted_at: null },
              },
              restricted_factions: { select: { faction_id: true } },
            },
          },
        },
      },
    },
  });

  if (!game || !game.reported_winner_id) return;

  const now = new Date();

  // Faction auto-resolve (no manual input):
  // Priority: BPT blind-pick revealed > SFT participant faction > existing match faction
  let p1FactionId: string | null;
  let p2FactionId: string | null;

  const mode = game.match.tournament?.mode;
  if (mode === 'BPT' && game.blind_pick?.revealed_at) {
    p1FactionId = game.blind_pick.player1_faction_id ?? null;
    p2FactionId = game.blind_pick.player2_faction_id ?? null;
  } else if (mode === 'SFT') {
    const participants = game.match.tournament?.participants ?? [];
    const p1Part = participants.find((p) => p.user_id === game.match.player1_id);
    const p2Part = participants.find((p) => p.user_id === game.match.player2_id);
    p1FactionId = p1Part?.faction?.id ?? game.match.player1_faction_id ?? null;
    p2FactionId = p2Part?.faction?.id ?? game.match.player2_faction_id ?? null;
  } else if (mode === 'MATRIX') {
    const matrix = game.faction_matrix;
    if (matrix?.decided_at && matrix.picked_cell) {
      const [row, col] = matrix.picked_cell.split(',').map(Number);
      p1FactionId = matrix.p1_factions[row ?? 0] ?? null;
      p2FactionId = matrix.p2_factions[col ?? 0] ?? null;
    } else {
      p1FactionId = null;
      p2FactionId = null;
    }
  } else if (mode === 'TWO_D_THREE') {
    // 2D3: faction was drawn per game at creation (drawTwoD3GameFactions) — keep it.
    p1FactionId = game.player1_faction_id ?? null;
    p2FactionId = game.player2_faction_id ?? null;
  } else if (mode === 'FREE_PICK') {
    // Free Pick: each player registered either a fixed faction (faction_id set)
    // or pick-later (null). Both fixed → play their factions. Otherwise the
    // pick flow (3×3 matrix for two pick-later players, or the mixed mini-pick)
    // stored its result in the faction_matrix record; a fixed player's side holds
    // just their one faction, so the picked_cell resolves both correctly.
    const participants = game.match.tournament?.participants ?? [];
    const p1Fixed = participants.find((p) => p.user_id === game.match.player1_id)?.faction?.id ?? null;
    const p2Fixed = participants.find((p) => p.user_id === game.match.player2_id)?.faction?.id ?? null;
    const matrix = game.faction_matrix;
    if (matrix?.decided_at && matrix.picked_cell) {
      const [row, col] = matrix.picked_cell.split(',').map(Number);
      p1FactionId = matrix.p1_factions[row ?? 0] ?? p1Fixed ?? null;
      p2FactionId = matrix.p2_factions[col ?? 0] ?? p2Fixed ?? null;
    } else {
      p1FactionId = p1Fixed ?? game.match.player1_faction_id ?? null;
      p2FactionId = p2Fixed ?? game.match.player2_faction_id ?? null;
    }
  } else if (!game.match.tournament && game.blind_pick?.revealed_at) {
    // Open Play: factions come from the blind pick
    p1FactionId = game.blind_pick.player1_faction_id ?? null;
    p2FactionId = game.blind_pick.player2_faction_id ?? null;
  } else {
    p1FactionId = game.match.player1_faction_id ?? null;
    p2FactionId = game.match.player2_faction_id ?? null;
  }

  // If either faction is restricted in this tournament, this game doesn't count for the leaderboard.
  const restrictedIds = new Set(
    game.match.tournament?.restricted_factions.map((r) => r.faction_id) ?? [],
  );
  const isRestrictedGame =
    restrictedIds.size > 0 &&
    ((p1FactionId !== null && restrictedIds.has(p1FactionId)) ||
      (p2FactionId !== null && restrictedIds.has(p2FactionId)));

  // Finalize game row
  await fastify.prisma.matchGame.update({
    where: { id: gameId },
    data: {
      status: 'COMPLETED',
      winner_id: game.reported_winner_id,
      player1_faction_id: p1FactionId,
      player2_faction_id: p2FactionId,
      confirmed_at: now,
      played_at: now,
      ...(isRestrictedGame ? { counts_for_leaderboard: false } : {}),
    },
  });

  // Rebuild FactionStats + MatchupStats from scratch — eliminates incremental drift.
  const activeSeason = await fastify.prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
  if (activeSeason) {
    await recomputeFactionStats(fastify.prisma, activeSeason.id);
    if (fastify.redis) {
      await Promise.all([
        invalidate(fastify.redis, 'factions:*'),
        invalidate(fastify.redis, 'meta:*'),
      ]);
    }
  }

  // Emit game-updated socket event
  if (fastify.io) {
    fastify.io.to(`match_decision_${game.match_id}`).emit('match.game.updated', {
      matchId: game.match_id,
      gameNumber: game.game_number,
      status: 'COMPLETED',
      winnerId: game.reported_winner_id,
      lobbyCode: null,
      reportedWinnerId: game.reported_winner_id,
      reportedAt: null,
      confirmedAt: now.toISOString(),
    });
  }

  // Series completion: count wins and decide whether to continue or complete
  let format: 'BO1' | 'BO3' | 'BO5';
  if (game.match.tournament) {
    format = resolveMatchFormat(game.match.tournament, game.match.phase ?? null);
  } else {
    // Open Play: format comes from the ScheduledMatchup (queue matches default to BO1)
    const matchup = await fastify.prisma.scheduledMatchup.findUnique({
      where: { match_id: game.match_id },
      select: { format: true },
    });
    format = (matchup?.format ?? 'BO1') as 'BO1' | 'BO3' | 'BO5';
  }
  const winsNeeded = format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;

  const completedGames = await fastify.prisma.matchGame.findMany({
    where: { match_id: game.match_id, status: 'COMPLETED' },
    select: { winner_id: true },
  });

  const p1Wins = completedGames.filter((g) => g.winner_id === game.match.player1_id).length;
  const p2Wins = completedGames.filter((g) => g.winner_id === game.match.player2_id).length;

  if (p1Wins >= winsNeeded || p2Wins >= winsNeeded) {
    const matchWinner = p1Wins >= winsNeeded ? game.match.player1_id! : game.match.player2_id!;
    await completeMatch(fastify, {
      matchId: game.match_id,
      winnerId: matchWinner,
      player1FactionId: p1FactionId,
      player2FactionId: p2FactionId,
      actorId: matchWinner,
      skipStats: true, // stats already written per-game above
    });
  } else {
    // Series continues — create next game row
    const nextGameNumber = game.game_number + 1;
    const nextGameId = await ensureMatchGame(fastify.prisma, game.match_id, nextGameNumber, game.match.tournament?.counts_for_leaderboard ?? true);

    // For Open Play (no tournament): auto-assign a random map + blind pick so
    // players go straight to faction selection — no "Choose Battlefield" needed.
    if (!game.match.tournament && game.match.player1_id && game.match.player2_id) {
      const existing = await fastify.prisma.matchMapDecision.findUnique({ where: { game_id: nextGameId } });
      if (!existing) {
        const maps = await fastify.prisma.map.findMany({ where: { deleted_at: null }, select: { id: true } });
        const randomMap = maps.length > 0 ? maps[Math.floor(Math.random() * maps.length)] : null;
        if (randomMap) {
          await fastify.prisma.matchMapDecision.create({
            data: {
              game_id: nextGameId,
              mode: 'RANDOM',
              coin_flip_seed: `open_play_${game.match_id}_g${nextGameNumber}`,
              top_player_id: game.match.player1_id,
              bottom_player_id: game.match.player2_id,
              bans_top: [],
              bans_bottom: [],
              active_pool: [],
              picked_map_id: randomMap.id,
              decided_at: new Date(),
            },
          });
        }
        await fastify.prisma.matchBlindPick.create({ data: { game_id: nextGameId } });
      }
    }

    if (fastify.io) {
      fastify.io.to(`match_decision_${game.match_id}`).emit('match.game.updated', {
        matchId: game.match_id,
        gameNumber: nextGameNumber,
        status: 'PENDING',
        winnerId: null,
        lobbyCode: null,
        reportedWinnerId: null,
        reportedAt: null,
        confirmedAt: null,
      });
    }
  }
}

/**
 * Scans for game results that have passed the 30-minute confirm window and
 * finalizes them automatically. Called by the cron task every minute.
 */
export async function autoConfirmExpiredGameResults(fastify: FastifyInstance): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const expired = await fastify.prisma.matchGame.findMany({
    where: {
      reported_at: { lt: cutoff, not: null },
      confirmed_at: null,
      status: { notIn: ['COMPLETED', 'DISPUTED'] },
    },
    select: { id: true },
  });

  let confirmed = 0;
  for (const game of expired) {
    try {
      await finalizeGameResult(fastify, game.id);
      confirmed++;
    } catch (err) {
      fastify.log.warn({ err, gameId: game.id }, 'auto-confirm failed for game');
    }
  }

  return confirmed;
}
