import type { FastifyPluginAsync } from 'fastify';
import { MatchStatus, TournamentFormat, TournamentStatus } from '@tww3/db';
import type { BracketResponse } from '@tww3/types';
import { generateSingleElim } from '../lib/bracket.js';
import { emitStatusChange, emitBracketUpdate } from '../lib/emit.js';

const bracketRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/tournaments/:slug/bracket
   * Public — returns the full bracket for a tournament by slug.
   */
  fastify.get<{ Params: { slug: string } }>(
    '/api/tournaments/:slug/bracket',
    async (request, reply) => {
      const { slug } = request.params;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      const matches = await fastify.prisma.match.findMany({
        where: { tournament_id: tournament.id, deleted_at: null },
        orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
        select: {
          id: true,
          round: true,
          match_number: true,
          player1_id: true,
          player2_id: true,
          winner_id: true,
          score: true,
          status: true,
          next_match_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
        },
      });

      const rounds = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;

      const response: BracketResponse = {
        tournamentId: tournament.id,
        rounds,
        matches: matches.map((m) => ({
          matchId: m.id,
          round: m.round,
          matchNumber: m.match_number,
          player1Id: m.player1_id,
          player2Id: m.player2_id,
          winnerId: m.winner_id,
          score: m.score,
          status: m.status as BracketResponse['matches'][number]['status'],
          nextMatchId: m.next_match_id,
          player1FactionId: m.player1_faction_id,
          player2FactionId: m.player2_faction_id,
        })),
      };

      return response;
    },
  );

  /**
   * POST /api/tournaments/:id/start
   * Auth required. Organizer or MOD/ADMIN only.
   * Generates the bracket, transitions tournament to ONGOING.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/start',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id, deleted_at: null },
        select: {
          id: true,
          slug: true,
          status: true,
          format: true,
          organizer_id: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      // Only the organizer (or MOD/ADMIN) may start — MOD/ADMIN already allowed by requireRole.
      const actorRole = request.user.role;
      if (
        actorRole === 'ORGANIZER' &&
        tournament.organizer_id !== request.user.sub
      ) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament organizer can start this tournament',
          statusCode: 403,
        });
      }

      if (tournament.status !== TournamentStatus.REGISTRATION_CLOSED) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Status muss REGISTRATION_CLOSED sein',
          statusCode: 400,
        });
      }

      if (tournament.format !== TournamentFormat.SINGLE_ELIMINATION) {
        return reply.code(501).send({
          error: 'NotImplemented',
          message: `Format ${tournament.format} wird in M2 implementiert`,
          statusCode: 501,
        });
      }

      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: {
          tournament_id: tournament.id,
          status: { in: ['REGISTERED', 'CHECKED_IN'] },
          deleted_at: null,
        },
        orderBy: { registered_at: 'asc' },
        select: { user_id: true },
      });

      if (participants.length < 2) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Mindestens 2 Teilnehmer erforderlich',
          statusCode: 400,
        });
      }

      const participantIds = participants.map((p) => p.user_id);
      const bracketMatches = generateSingleElim(tournament.id, participantIds);
      const rounds = bracketMatches.length > 0
        ? Math.max(...bracketMatches.map((m) => m.round))
        : 0;

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.createMany({
          data: bracketMatches.map((m) => ({
            id: m.id,
            tournament_id: m.tournament_id,
            round: m.round,
            match_number: m.match_number,
            player1_id: m.player1_id,
            player2_id: m.player2_id,
            status: m.status as MatchStatus,
            next_match_id: m.next_match_id,
            winner_id: m.winner_id,
          })),
        });

        await tx.tournament.update({
          where: { id: tournament.id },
          data: { status: TournamentStatus.ONGOING },
        });

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'tournament_start',
            actor_id: request.user.sub,
            new_value: {
              status: TournamentStatus.ONGOING,
              matches_created: bracketMatches.length,
            },
          },
        });
      });

      // Emit socket events after successful transaction.
      emitStatusChange(fastify.io, {
        tournamentId: tournament.id,
        status: 'ONGOING',
      });
      emitBracketUpdate(fastify.io, tournament.id);

      return reply.code(200).send({
        tournamentId: tournament.id,
        matches_created: bracketMatches.length,
        rounds,
      });
    },
  );
};

export default bracketRoutes;
