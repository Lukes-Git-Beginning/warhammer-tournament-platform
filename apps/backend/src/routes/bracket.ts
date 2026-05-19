import type { FastifyPluginAsync } from 'fastify';
import { MatchStatus, TournamentFormat, TournamentStatus } from '@rizzotto/db';
import type { BracketResponse, SwissStandingEntry } from '@rizzotto/types';
import { generateSingleElim, generateDoubleElim } from '../lib/bracket.js';
import { generateRoundRobin } from '../lib/round-robin.js';
import {
  generateSwissRound,
  computeSwissStandings,
  recommendNumberOfRounds,
} from '../lib/swiss.js';
import { emitStatusChange, emitBracketUpdate } from '../lib/emit.js';

const bracketRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/tournaments/:slug/bracket
   * Public — returns the full bracket for a tournament by slug.
   * For SWISS tournaments also includes standings and swiss meta.
   */
  fastify.get<{ Params: { slug: string } }>(
    '/api/tournaments/:slug/bracket',
    async (request, reply) => {
      const { slug } = request.params;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, format: true },
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
          result: true,
          player1_points: true,
          player2_points: true,
          status: true,
          next_match_id: true,
          loser_next_match_id: true,
          bracket_side: true,
          player1_faction_id: true,
          player2_faction_id: true,
          draft: { select: { id: true, status: true } },
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
          result: m.result,
          player1Points: m.player1_points,
          player2Points: m.player2_points,
          status: m.status as BracketResponse['matches'][number]['status'],
          nextMatchId: m.next_match_id,
          loserNextMatchId: m.loser_next_match_id,
          bracketSide: m.bracket_side,
          player1FactionId: m.player1_faction_id,
          player2FactionId: m.player2_faction_id,
          draft_id: m.draft?.id ?? null,
          draft_status: (m.draft?.status ?? null) as BracketResponse['matches'][number]['draft_status'],
        })),
      };

      // Augment with Swiss standings if applicable
      if (tournament.format === TournamentFormat.SWISS) {
        const participants = await fastify.prisma.tournamentParticipant.findMany({
          where: {
            tournament_id: tournament.id,
            status: { in: ['REGISTERED', 'CHECKED_IN'] },
            deleted_at: null,
          },
          select: {
            user_id: true,
            user: { select: { id: true, username: true, avatar_url: true } },
          },
        });

        const participantIds = participants.map((p) => p.user_id);
        const userMap = new Map(
          participants.map((p) => [p.user_id, p.user]),
        );

        const completedMatches = matches
          .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE')
          .map((m) => ({
            round: m.round,
            player1_id: m.player1_id,
            player2_id: m.player2_id,
            winner_id: m.winner_id,
            status: m.status,
          }));

        const rawStandings = computeSwissStandings(participantIds, completedMatches);

        const standings: SwissStandingEntry[] = rawStandings.map((s) => {
          const user = userMap.get(s.userId);
          return {
            userId: s.userId,
            username: user?.username ?? null,
            avatarUrl: user?.avatar_url ?? null,
            score: s.score,
            wins: s.wins,
            losses: s.losses,
            draws: s.draws,
            byes: s.byes,
            buchholz: s.buchholz,
          };
        });

        response.swiss = {
          recommendedRounds: recommendNumberOfRounds(participantIds.length),
          currentRound: rounds,
          standings,
        };
      }

      return response;
    },
  );

  /**
   * POST /api/tournaments/:id/start
   * Auth required. Organizer or MOD/ADMIN only.
   * Generates the bracket/rounds, transitions tournament to ONGOING.
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
      let bracketMatches: Array<{
        id: string;
        tournament_id: string;
        round: number;
        match_number: number;
        player1_id: string | null;
        player2_id: string | null;
        status: MatchStatus;
        next_match_id: string | null;
        loser_next_match_id?: string | null;
        bracket_side?: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null;
        winner_id: string | null;
      }>;

      switch (tournament.format) {
        case TournamentFormat.SINGLE_ELIMINATION: {
          bracketMatches = generateSingleElim(tournament.id, participantIds);
          break;
        }

        case TournamentFormat.DOUBLE_ELIMINATION: {
          bracketMatches = generateDoubleElim(tournament.id, participantIds);
          break;
        }

        case TournamentFormat.ROUND_ROBIN: {
          bracketMatches = generateRoundRobin(tournament.id, participantIds, false);
          break;
        }

        case TournamentFormat.DOUBLE_ROUND_ROBIN: {
          bracketMatches = generateRoundRobin(tournament.id, participantIds, true);
          break;
        }

        case TournamentFormat.SWISS: {
          const swissPlayers = participantIds.map((userId) => ({
            userId,
            score: 0,
            avoid: [] as string[],
            receivedBye: false,
          }));
          bracketMatches = generateSwissRound(tournament.id, swissPlayers, 1);
          break;
        }

        default: {
          return reply.code(501).send({
            error: 'NotImplemented',
            message: `Format ${tournament.format} ist nicht implementiert`,
            statusCode: 501,
          });
        }
      }

      const rounds =
        bracketMatches.length > 0
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
            loser_next_match_id: m.loser_next_match_id ?? null,
            bracket_side: m.bracket_side ?? null,
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
              format: tournament.format,
              matches_created: bracketMatches.length,
            },
          },
        });
      });

      emitStatusChange(fastify.io, {
        tournamentId: tournament.id,
        status: 'ONGOING',
      });
      emitBracketUpdate(fastify.io, tournament.id);

      const responseBody: Record<string, unknown> = {
        tournamentId: tournament.id,
        matches_created: bracketMatches.length,
        rounds,
      };

      if (tournament.format === TournamentFormat.SWISS) {
        responseBody.recommendedRounds = recommendNumberOfRounds(participantIds.length);
      }

      return reply.code(200).send(responseBody);
    },
  );

  /**
   * POST /api/tournaments/:id/next-round
   * Auth required. Organizer or MOD/ADMIN only.
   * SWISS only: generates the next round of pairings based on current standings.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/next-round',
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

      const actorRole = request.user.role;
      if (
        actorRole === 'ORGANIZER' &&
        tournament.organizer_id !== request.user.sub
      ) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament organizer can advance rounds',
          statusCode: 403,
        });
      }

      if (tournament.format !== TournamentFormat.SWISS) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'next-round ist nur für Swiss-Turniere verfügbar',
          statusCode: 400,
        });
      }

      if (tournament.status !== TournamentStatus.ONGOING) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Turnier ist nicht im Status ONGOING',
          statusCode: 400,
        });
      }

      // Load all existing matches
      const existingMatches = await fastify.prisma.match.findMany({
        where: { tournament_id: tournament.id, deleted_at: null },
        select: {
          id: true,
          round: true,
          match_number: true,
          player1_id: true,
          player2_id: true,
          winner_id: true,
          status: true,
        },
      });

      const currentRound =
        existingMatches.length > 0
          ? Math.max(...existingMatches.map((m) => m.round))
          : 0;

      // Load active participants
      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: {
          tournament_id: tournament.id,
          status: { in: ['REGISTERED', 'CHECKED_IN'] },
          deleted_at: null,
        },
        select: { user_id: true },
      });

      const participantIds = participants.map((p) => p.user_id);
      const targetRound = currentRound + 1;
      const recommendedRounds = recommendNumberOfRounds(participantIds.length);

      if (targetRound > recommendedRounds) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `All swiss rounds played (${recommendedRounds}); finalize tournament`,
          statusCode: 400,
        });
      }

      // Verify all matches in current round are completed or BYE
      const currentRoundMatches = existingMatches.filter((m) => m.round === currentRound);
      const incomplete = currentRoundMatches.filter(
        (m) => m.status !== 'COMPLETED' && m.status !== 'BYE',
      );

      if (incomplete.length > 0) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `${incomplete.length} Match(es) in Runde ${currentRound} noch nicht abgeschlossen`,
          statusCode: 400,
        });
      }

      // Compute standings from all completed matches
      const completedMatchRecords = existingMatches
        .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE')
        .map((m) => ({
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          winner_id: m.winner_id,
          status: m.status,
        }));

      const standings = computeSwissStandings(participantIds, completedMatchRecords);

      // Build avoid maps: each player avoids all previous opponents
      const avoidMap = new Map<string, string[]>();
      for (const id of participantIds) avoidMap.set(id, []);

      for (const m of existingMatches) {
        if (m.player1_id && m.player2_id) {
          avoidMap.get(m.player1_id)?.push(m.player2_id);
          avoidMap.get(m.player2_id)?.push(m.player1_id);
        }
      }

      // Build receivedBye map
      const byeMap = new Map<string, boolean>();
      for (const m of existingMatches) {
        if (m.status === 'BYE') {
          const byePlayer = m.player1_id ?? m.player2_id;
          if (byePlayer) byeMap.set(byePlayer, true);
        }
      }

      const swissPlayers = standings.map((s) => ({
        userId: s.userId,
        score: s.score,
        avoid: avoidMap.get(s.userId) ?? [],
        receivedBye: byeMap.get(s.userId) ?? false,
      }));

      const newMatches = generateSwissRound(tournament.id, swissPlayers, targetRound);

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.createMany({
          data: newMatches.map((m) => ({
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

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'swiss_next_round',
            actor_id: request.user.sub,
            new_value: {
              round: targetRound,
              matches_created: newMatches.length,
            },
          },
        });
      });

      emitBracketUpdate(fastify.io, tournament.id);

      return reply.code(200).send({
        tournamentId: tournament.id,
        round: targetRound,
        matches_created: newMatches.length,
        isLastRound: targetRound === recommendedRounds,
        recommendedRounds,
      });
    },
  );
};

export default bracketRoutes;
