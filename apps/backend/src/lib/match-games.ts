import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@rizzotto/db';
import { completeMatch } from './complete-match.js';

/**
 * Upserts a MatchGame row for the given match/game combination.
 * For v1 (Bo1), gameNumber is always 1.
 * Returns the MatchGame id.
 */
export async function ensureMatchGame(
  prisma: PrismaClient,
  matchId: string,
  gameNumber = 1,
): Promise<string> {
  const existing = await prisma.matchGame.findUnique({
    where: { match_id_game_number: { match_id: matchId, game_number: gameNumber } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.matchGame.create({
    data: { match_id: matchId, game_number: gameNumber },
    select: { id: true },
  });
  return created.id;
}

/**
 * Finalizes a game result: sets game COMPLETED, resolves factions automatically,
 * and (for Bo1) triggers full match completion + bracket progression.
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
      blind_pick: {
        select: {
          revealed_at: true,
          player1_faction_id: true,
          player2_faction_id: true,
        },
      },
      match: {
        select: {
          player1_id: true,
          player2_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
          tournament: {
            select: {
              mode: true,
              participants: {
                select: {
                  user_id: true,
                  faction: { select: { id: true } },
                },
                where: { deleted_at: null },
              },
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
  let p1FactionId: string | null = null;
  let p2FactionId: string | null = null;

  const mode = game.match.tournament.mode;
  if (mode === 'BPT' && game.blind_pick?.revealed_at) {
    p1FactionId = game.blind_pick.player1_faction_id ?? null;
    p2FactionId = game.blind_pick.player2_faction_id ?? null;
  } else if (mode === 'SFT') {
    const participants = game.match.tournament.participants;
    const p1Part = participants.find((p) => p.user_id === game.match.player1_id);
    const p2Part = participants.find((p) => p.user_id === game.match.player2_id);
    p1FactionId = p1Part?.faction?.id ?? game.match.player1_faction_id ?? null;
    p2FactionId = p2Part?.faction?.id ?? game.match.player2_faction_id ?? null;
  } else {
    p1FactionId = game.match.player1_faction_id ?? null;
    p2FactionId = game.match.player2_faction_id ?? null;
  }

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
    },
  });

  // For Bo1: game winner = match winner → complete the match
  // (Bo3/Bo5: aggregate game wins first — to be implemented with series support)
  if (game.game_number === 1) {
    await completeMatch(fastify, {
      matchId: game.match_id,
      winnerId: game.reported_winner_id,
      player1FactionId: p1FactionId,
      player2FactionId: p2FactionId,
      actorId: game.reported_winner_id,
    });
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
