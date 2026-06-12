/**
 * Shared match-completion logic used by both the legacy result endpoint
 * (routes/matches.ts) and the new game-result flow (routes/match-games.ts).
 *
 * Runs the full transaction: match update, bracket progression, FactionStats,
 * MatchupStats, AuditLog. Then emits socket events and invalidates caches.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma, type BracketSide } from '@rizzotto/db';
import { slotForFeeder, type FeederEvent } from './bracket.js';
import { invalidate } from './cache.js';
import { emitMatchResult, emitBracketUpdate } from './emit.js';

type TxClient = Prisma.TransactionClient;

interface AdvanceSrc {
  id: string;
  tournamentFormat: string;
  bracket_side: BracketSide | null;
  match_number: number;
}

async function advanceToSlot(
  tx: TxClient,
  targetId: string,
  playerId: string | null,
  src: AdvanceSrc,
  role: 'winner' | 'loser',
): Promise<void> {
  if (playerId === null) return;
  const t = await tx.match.findUnique({
    where: { id: targetId },
    select: { id: true, player1_id: true, player2_id: true, tournament_id: true },
  });
  if (!t) return;

  let slot: 'player1_id' | 'player2_id';
  if (src.tournamentFormat !== 'DOUBLE_ELIMINATION') {
    slot = t.player1_id === null ? 'player1_id' : 'player2_id';
  } else {
    const feederRows = await tx.match.findMany({
      where: {
        tournament_id: t.tournament_id,
        OR: [{ next_match_id: targetId }, { loser_next_match_id: targetId }],
      },
      select: {
        id: true,
        round: true,
        match_number: true,
        next_match_id: true,
        loser_next_match_id: true,
      },
    });
    const events: FeederEvent[] = [];
    for (const f of feederRows) {
      if (f.next_match_id === targetId)
        events.push({ matchId: f.id, round: f.round, matchNumber: f.match_number, role: 'winner' });
      if (f.loser_next_match_id === targetId)
        events.push({ matchId: f.id, round: f.round, matchNumber: f.match_number, role: 'loser' });
    }
    slot = slotForFeeder(events, src.id, role);
  }

  await tx.match.update({ where: { id: targetId }, data: { [slot]: playerId } });
}

async function checkAndPromoteBye(tx: TxClient, matchId: string): Promise<void> {
  const m = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      player1_id: true,
      player2_id: true,
      next_match_id: true,
      bracket_side: true,
      match_number: true,
      tournament_id: true,
    },
  });
  if (!m || m.status !== 'PENDING') return;
  if (m.bracket_side === 'GRAND_FINAL') return;
  if (m.player1_id !== null && m.player2_id !== null) return;
  const present = m.player1_id ?? m.player2_id;
  if (present === null) return;
  const pendingFeeders = await tx.match.count({
    where: {
      tournament_id: m.tournament_id,
      deleted_at: null,
      status: { notIn: ['COMPLETED', 'BYE', 'FORFEIT'] },
      OR: [{ next_match_id: matchId }, { loser_next_match_id: matchId }],
    },
  });
  if (pendingFeeders > 0) return;
  await tx.match.update({ where: { id: matchId }, data: { status: 'BYE', winner_id: present } });
  if (m.next_match_id) {
    await advanceToSlot(
      tx,
      m.next_match_id,
      present,
      { id: m.id, tournamentFormat: 'DOUBLE_ELIMINATION', bracket_side: m.bracket_side, match_number: m.match_number },
      'winner',
    );
    await checkAndPromoteBye(tx, m.next_match_id);
  }
}

async function handleGrandFinalProgression(
  tx: TxClient,
  gf: { id: string; next_match_id: string | null; player1_id: string | null },
  winnerId: string | null,
  loserId: string | null,
): Promise<void> {
  if (gf.next_match_id === null) return;
  if (winnerId === gf.player1_id) {
    await tx.match.update({
      where: { id: gf.next_match_id },
      data: { status: 'FORFEIT', player1_id: winnerId, player2_id: loserId, winner_id: winnerId },
    });
  } else {
    await tx.match.update({
      where: { id: gf.next_match_id },
      data: { player1_id: gf.player1_id, player2_id: winnerId },
    });
  }
}

export interface CompleteMatchOpts {
  matchId: string;
  winnerId: string | null;
  player1FactionId?: string | null;
  player2FactionId?: string | null;
  actorId: string;
  score?: string | null;
  /** Skip FactionStats/MatchupStats writes — set true when stats are written per-game upstream */
  skipStats?: boolean;
}

/**
 * Finalizes a match: updates DB, advances bracket, writes stats, emits sockets.
 * Throws if match is not found or already completed.
 */
export async function completeMatch(
  fastify: FastifyInstance,
  opts: CompleteMatchOpts,
): Promise<void> {
  const { matchId, winnerId, actorId, score } = opts;

  const match = await fastify.prisma.match.findFirst({
    where: { id: matchId, deleted_at: null },
    select: {
      id: true,
      tournament_id: true,
      player1_id: true,
      player2_id: true,
      next_match_id: true,
      loser_next_match_id: true,
      bracket_side: true,
      match_number: true,
      player1_faction_id: true,
      player2_faction_id: true,
      tournament: { select: { organizer_id: true, format: true, mode: true, counts_for_leaderboard: true } },
    },
  });

  if (!match) throw new Error(`Match "${matchId}" not found`);

  const player1FactionId = opts.player1FactionId ?? match.player1_faction_id ?? null;
  const player2FactionId = opts.player2FactionId ?? match.player2_faction_id ?? null;

  const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

  const winnerFactionId =
    winnerId === null
      ? null
      : winnerId === match.player1_id
        ? player1FactionId
        : player2FactionId;
  const loserFactionId =
    winnerId === null
      ? null
      : loserId === match.player1_id
        ? player1FactionId
        : player2FactionId;

  const activeSeason = await fastify.prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });

  await fastify.prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: matchId },
      data: {
        winner_id: winnerId,
        score: score ?? null,
        status: 'COMPLETED',
        season_id: activeSeason?.id ?? null,
        played_at: new Date(),
        ...(player1FactionId ? { player1_faction_id: player1FactionId } : {}),
        ...(player2FactionId ? { player2_faction_id: player2FactionId } : {}),
      },
    });

    // In SFT tournaments: latch faction onto the participant record if not yet set.
    // This covers players who registered before the faction picker existed.
    if (match.tournament?.mode === 'SFT') {
      if (player1FactionId && match.player1_id) {
        await tx.tournamentParticipant.updateMany({
          where: { tournament_id: match.tournament_id ?? undefined, user_id: match.player1_id, faction_id: null, deleted_at: null },
          data: { faction_id: player1FactionId },
        });
      }
      if (player2FactionId && match.player2_id) {
        await tx.tournamentParticipant.updateMany({
          where: { tournament_id: match.tournament_id ?? undefined, user_id: match.player2_id, faction_id: null, deleted_at: null },
          data: { faction_id: player2FactionId },
        });
      }
    }

    const isDE = match.tournament?.format === 'DOUBLE_ELIMINATION';
    const isGFSource = isDE && match.bracket_side === 'GRAND_FINAL';
    const src: AdvanceSrc = {
      id: match.id,
      tournamentFormat: match.tournament?.format ?? 'SWISS',
      bracket_side: match.bracket_side,
      match_number: match.match_number,
    };

    if (match.next_match_id && !isGFSource) {
      await advanceToSlot(tx, match.next_match_id, winnerId, src, 'winner');
      await checkAndPromoteBye(tx, match.next_match_id);
    }

    if (match.loser_next_match_id && winnerId !== null && loserId !== null) {
      await advanceToSlot(tx, match.loser_next_match_id, loserId, src, 'loser');
      await checkAndPromoteBye(tx, match.loser_next_match_id);
    }

    if (isGFSource) {
      await handleGrandFinalProgression(tx, match, winnerId, loserId);
    }

    if (activeSeason && !opts.skipStats) {
      const seasonId = activeSeason.id;
      const factionIdsToUpdate = [winnerFactionId, loserFactionId].filter(
        (f): f is string => f !== null,
      );
      for (const factionId of factionIdsToUpdate) {
        const isWinner = factionId === winnerFactionId;
        await tx.factionStats.upsert({
          where: { faction_id_season_id: { faction_id: factionId, season_id: seasonId } },
          create: {
            faction_id: factionId,
            season_id: seasonId,
            matches_played: 1,
            wins: isWinner ? 1 : 0,
            losses: isWinner ? 0 : 1,
            draws: 0,
            pick_count: 1,
            ban_count: 0,
          },
          update: {
            matches_played: { increment: 1 },
            pick_count: { increment: 1 },
            ...(isWinner ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
          },
        });
      }
    }

    if (activeSeason && !opts.skipStats && player1FactionId && player2FactionId) {
      const sorted = [player1FactionId, player2FactionId].sort();
      const aId = sorted[0]!;
      const bId = sorted[1]!;
      const isDraw = winnerId === null;
      const winnerIsA = winnerFactionId === aId;
      await tx.matchupStats.upsert({
        where: {
          faction_a_id_faction_b_id_season_id: {
            faction_a_id: aId,
            faction_b_id: bId,
            season_id: activeSeason.id,
          },
        },
        create: {
          faction_a_id: aId,
          faction_b_id: bId,
          season_id: activeSeason.id,
          faction_a_wins: !isDraw && winnerIsA ? 1 : 0,
          faction_b_wins: !isDraw && !winnerIsA ? 1 : 0,
          draws: isDraw ? 1 : 0,
        },
        update: isDraw
          ? { draws: { increment: 1 } }
          : winnerIsA
            ? { faction_a_wins: { increment: 1 } }
            : { faction_b_wins: { increment: 1 } },
      });
    }

    // LeaderboardEntry — mirrors resolveMatchResult so GameTile matches count on the leaderboard
    if (activeSeason && (match.tournament?.counts_for_leaderboard ?? true)) {
      const seasonId = activeSeason.id;
      const WIN_PTS = 3, LOSS_PTS = 0;
      const entries = [
        match.player1_id ? { userId: match.player1_id, isWinner: winnerId === match.player1_id, points: winnerId === match.player1_id ? WIN_PTS : LOSS_PTS } : null,
        match.player2_id ? { userId: match.player2_id, isWinner: winnerId === match.player2_id, points: winnerId === match.player2_id ? WIN_PTS : LOSS_PTS } : null,
      ].filter((e): e is NonNullable<typeof e> => e !== null);
      for (const e of entries) {
        await tx.leaderboardEntry.upsert({
          where: { user_id_season_id: { user_id: e.userId, season_id: seasonId } },
          create: { user_id: e.userId, season_id: seasonId, games_played: 1, wins: e.isWinner ? 1 : 0, losses: e.isWinner ? 0 : 1, total_points: e.points },
          update: { games_played: { increment: 1 }, wins: e.isWinner ? { increment: 1 } : undefined, losses: !e.isWinner ? { increment: 1 } : undefined, total_points: { increment: e.points } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        entity_type: 'Match',
        entity_id: matchId,
        action: 'match_result',
        actor_id: actorId,
        new_value: {
          winnerId,
          loserId,
          score: score ?? null,
          player1FactionId: player1FactionId ?? null,
          player2FactionId: player2FactionId ?? null,
        },
      },
    });
  });

  if (fastify.redis) {
    await Promise.all([
      invalidate(fastify.redis, 'factions:*'),
      invalidate(fastify.redis, 'meta:*'),
      invalidate(fastify.redis, 'leaderboard:*'),
      invalidate(fastify.redis, 'rating-model:*'),
      invalidate(fastify.redis, 'h2h:*'),
    ]);
  }

  if (match.tournament_id) {
    emitMatchResult(fastify.io, {
      tournamentId: match.tournament_id,
      matchId,
      winnerId,
      score: score ?? null,
      nextMatchId: match.next_match_id ?? null,
    });
    emitBracketUpdate(fastify.io, match.tournament_id);
  }
}
