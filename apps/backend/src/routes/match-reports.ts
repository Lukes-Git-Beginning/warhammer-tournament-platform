/**
 * Match Report Routes — Dual-Submit flow (Q4 / Q12)
 *
 * POST /api/matches/:matchId/reports      — player submits their own result
 * PUT  /api/matches/:matchId/result       — organizer/mod/admin override
 * GET  /api/matches/:matchId/reports      — fetch existing reports + match state
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  SubmitMatchReportSchema,
  OverrideMatchResultSchema,
  type MatchReportDto,
  type SubmitMatchReportResponse,
  type MatchReportingState,
} from '@rizzotto/types';
import { resolveMatchResult, disputeMatch } from '../lib/match-result-service.js';
import { canManageTournament } from '../lib/tournament-utils.js';
import { tournamentRoom } from '../lib/emit.js';
import { notifyDispute } from '../lib/discord-notify.js';
import { invalidate } from '../lib/cache.js';

/** Invalidate leaderboard/faction/meta/rating-model caches after a match completes. */
async function invalidateScoringCaches(redis: import('ioredis').Redis | undefined): Promise<void> {
  if (!redis) return;
  await Promise.all([
    invalidate(redis, 'leaderboard:*'),
    invalidate(redis, 'factions:*'),
    invalidate(redis, 'meta:*'),
    invalidate(redis, 'rating-model:*'),
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map raw MatchReport rows to MatchReportDto shape.
 */
function toReportDto(
  report: {
    id: string;
    match_id: string;
    reporter_id: string;
    result: string;
    player1_score: number | null;
    player2_score: number | null;
    notes: string | null;
    created_at: Date;
    reporter: { username: string };
  },
): MatchReportDto {
  return {
    id: report.id,
    match_id: report.match_id,
    reporter_id: report.reporter_id,
    reporter_username: report.reporter.username,
    result: report.result as MatchReportDto['result'],
    player1_score: report.player1_score,
    player2_score: report.player2_score,
    notes: report.notes,
    created_at: report.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const matchReportsRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /api/matches/:matchId/reports
  // A participating player submits their report of the match outcome.
  // -------------------------------------------------------------------------
  fastify.post<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/reports',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { matchId } = request.params;
      const userId = request.user.sub;

      // Validate body
      const parsed = SubmitMatchReportSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { result, player1_score, player2_score, notes } = parsed.data;

      // Load match — 404 if not found OR user is not a player (security: don't reveal existence)
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          player1_id: true,
          player2_id: true,
          status: true,
          next_match_id: true,
          tournament: {
            select: {
              id: true,
              counts_for_leaderboard: true,
              is_major: true,
            },
          },
        },
      });

      // 404 if match doesn't exist OR user is not player1/player2
      if (
        !match ||
        (match.player1_id !== userId && match.player2_id !== userId)
      ) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Match not found',
          statusCode: 404,
        });
      }

      // Status gate: only ONGOING or DISPUTED matches accept reports
      if (match.status !== 'ONGOING' && match.status !== 'DISPUTED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match status is ${match.status} — reports only accepted for ONGOING or DISPUTED matches`,
          statusCode: 422,
        });
      }

      // Upsert MatchReport (unique: match_id + reporter_id)
      await fastify.prisma.matchReport.upsert({
        where: {
          match_id_reporter_id: {
            match_id: matchId,
            reporter_id: userId,
          },
        },
        create: {
          match_id: matchId,
          reporter_id: userId,
          result,
          player1_score: player1_score ?? null,
          player2_score: player2_score ?? null,
          notes: notes ?? null,
        },
        update: {
          result,
          player1_score: player1_score ?? null,
          player2_score: player2_score ?? null,
          notes: notes ?? null,
        },
      });

      // Reload all reports for this match
      const allReports = await fastify.prisma.matchReport.findMany({
        where: { match_id: matchId },
        include: { reporter: { select: { username: true } } },
        orderBy: { created_at: 'asc' },
      });

      const reportDtos = allReports.map(toReportDto);

      // -----------------------------------------------------------------------
      // Resolution logic
      // -----------------------------------------------------------------------

      // Reload match status (may have changed concurrently)
      const freshMatch = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: { status: true },
      });
      const currentStatus = freshMatch?.status ?? match.status;

      let state: MatchReportingState;
      let finalMatchStatus = currentStatus;

      if (allReports.length < 2) {
        // Still waiting for the second player
        state = 'AWAITING_OPPONENT';
        // Match stays ONGOING — no status change needed
      } else {
        // Two reports exist — check agreement
        const [r1, r2] = [allReports[0]!, allReports[1]!];
        const agree = r1.result === r2.result;

        if (agree) {
          // Both agree → resolve match immediately
          state = 'AGREED';
          await resolveMatchResult(
            fastify.prisma,
            matchId,
            r1.result as Parameters<typeof resolveMatchResult>[2],
            {
              actorId: userId,
              player1_points: r1.player1_score ?? undefined,
              player2_points: r1.player2_score ?? undefined,
            },
            fastify.io,
          );
          await invalidateScoringCaches(fastify.redis);
          finalMatchStatus = 'COMPLETED';
        } else {
          // Disagreement → DISPUTED
          state = 'DISPUTED';
          if (currentStatus !== 'DISPUTED') {
            await disputeMatch(
              fastify.prisma,
              matchId,
              match.tournament_id ?? '',
              userId,
              fastify.io,
            );

            // Notify organizer + moderators of the dispute via Discord DM (non-fatal)
            if (match.tournament_id) {
              try {
                const tournamentForNotify = await fastify.prisma.tournament.findUnique({
                  where: { id: match.tournament_id },
                  select: { id: true, name: true, slug: true, start_date: true },
                });
                const reporterUser = await fastify.prisma.user.findUnique({
                  where: { id: userId },
                  select: { id: true, username: true, discord_id: true },
                });
                if (tournamentForNotify && reporterUser) {
                  await notifyDispute(
                    { id: matchId, tournament: tournamentForNotify },
                    { id: reporterUser.id, username: reporterUser.username, discord_id: reporterUser.discord_id },
                  ).catch((err) => {
                    fastify.log.warn({ err, matchId }, 'notifyDispute failed (non-fatal)');
                  });
                }
              } catch (notifyErr) {
                fastify.log.warn({ notifyErr, matchId }, 'Dispute notify error (non-fatal)');
              }
            }
          }
          finalMatchStatus = 'DISPUTED';
        }
      }

      // Emit match_reported event (tournament matches only)
      if (fastify.io && match.tournament_id) {
        fastify.io.to(tournamentRoom(match.tournament_id)).emit('match_reported', {
          tournamentId: match.tournament_id,
          matchId,
          reporterId: userId,
          state: state as 'AWAITING_OPPONENT' | 'AGREED' | 'DISPUTED',
        });
      }

      const response: SubmitMatchReportResponse = {
        state,
        match_status: finalMatchStatus as SubmitMatchReportResponse['match_status'],
        reports: reportDtos,
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/matches/:matchId/result
  // Organizer / Moderator / Admin override — bypasses dual-submit flow.
  // -------------------------------------------------------------------------
  fastify.put<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/result',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { matchId } = request.params;
      const user = request.user;

      // Validate body
      const parsed = OverrideMatchResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { result, player1_points, player2_points, player1_score, player2_score, reason, map_id, player1FactionId, player2FactionId } = parsed.data;

      // Load match
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          player1_id: true,
          player2_id: true,
          status: true,
          next_match_id: true,
          tournament: {
            select: {
              id: true,
              organizer_id: true,
              counts_for_leaderboard: true,
              is_major: true,
            },
          },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Match not found',
          statusCode: 404,
        });
      }

      // HOST must own the tournament or be a co-host (open play matches have no organizer)
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', user.sub, user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not the organizer of this tournament',
          statusCode: 403,
        });
      }

      // Cannot override already-completed matches unless ADMIN or a tournament manager
      if (match.status === 'COMPLETED' && user.role !== 'ADMIN' && !(await canManageTournament(fastify.prisma, match.tournament_id ?? '', user.sub, user.role))) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Match is already COMPLETED — only the tournament organizer or an admin can re-override',
          statusCode: 422,
        });
      }

      await resolveMatchResult(
        fastify.prisma,
        matchId,
        result,
        {
          override: true,
          player1_points: player1_points ?? undefined,
          player2_points: player2_points ?? undefined,
          player1FactionId: player1FactionId ?? undefined,
          player2FactionId: player2FactionId ?? undefined,
          actorId: user.sub,
          reason,
        },
        fastify.io,
      );

      if (player1_score != null || player2_score != null) {
        await fastify.prisma.match.update({
          where: { id: matchId },
          data: { score: `${player1_score ?? 0}-${player2_score ?? 0}` },
        });
      }

      if (map_id && match.player1_id && match.player2_id) {
        const winnerId = result === 'PLAYER1_WIN' ? match.player1_id : result === 'PLAYER2_WIN' ? match.player2_id : null;
        await fastify.prisma.matchGame.upsert({
          where: { match_id_game_number: { match_id: matchId, game_number: 1 } },
          create: { match_id: matchId, game_number: 1, status: 'COMPLETED', winner_id: winnerId, played_at: new Date(), counts_for_leaderboard: match.tournament?.counts_for_leaderboard ?? true },
          update: { status: 'COMPLETED', winner_id: winnerId, played_at: new Date() },
        });
        const game = await fastify.prisma.matchGame.findUniqueOrThrow({
          where: { match_id_game_number: { match_id: matchId, game_number: 1 } },
          select: { id: true },
        });
        await fastify.prisma.matchMapDecision.upsert({
          where: { game_id: game.id },
          create: {
            game_id: game.id,
            mode: 'HOST_PRESET',
            coin_flip_seed: 'manual',
            top_player_id: match.player1_id,
            bottom_player_id: match.player2_id,
            bans_top: [],
            bans_bottom: [],
            active_pool: [],
            picked_map_id: map_id,
            decided_at: new Date(),
          },
          update: { picked_map_id: map_id },
        });
      }

      await invalidateScoringCaches(fastify.redis);

      // Reload reports to build response
      const allReports = await fastify.prisma.matchReport.findMany({
        where: { match_id: matchId },
        include: { reporter: { select: { username: true } } },
        orderBy: { created_at: 'asc' },
      });

      const response: SubmitMatchReportResponse = {
        state: 'OVERRIDDEN',
        match_status: 'COMPLETED',
        reports: allReports.map(toReportDto),
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/matches/:matchId/reports
  // Returns existing reports + current match state for UI display.
  // Auth required but any logged-in user can read (visibility handled by frontend).
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/reports',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { matchId } = request.params;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Match not found',
          statusCode: 404,
        });
      }

      const allReports = await fastify.prisma.matchReport.findMany({
        where: { match_id: matchId },
        include: { reporter: { select: { username: true } } },
        orderBy: { created_at: 'asc' },
      });

      const reportDtos = allReports.map(toReportDto);

      // Derive state from current match status + report count
      let state: MatchReportingState;
      if (match.status === 'COMPLETED') {
        state = 'AGREED'; // Could also be OVERRIDDEN — no way to distinguish without extra flag
      } else if (match.status === 'DISPUTED') {
        state = 'DISPUTED';
      } else if (allReports.length === 0) {
        state = 'AWAITING_REPORTS';
      } else {
        state = 'AWAITING_OPPONENT';
      }

      const response: SubmitMatchReportResponse = {
        state,
        match_status: match.status as SubmitMatchReportResponse['match_status'],
        reports: reportDtos,
      };

      return reply.code(200).send(response);
    },
  );
};

export default matchReportsRoutes;
