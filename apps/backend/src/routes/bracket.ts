import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { MatchStatus, TournamentFormat, TournamentStatus } from '@rizzotto/db';
import type { BracketResponse, SwissStandingEntry } from '@rizzotto/types';
import { generateSingleElim, generateDoubleElim } from '../lib/bracket.js';
import { generateRoundRobin } from '../lib/round-robin.js';
import {
  generateSwissRound,
  computeSwissStandings,
  sortSwissStandings,
  recommendNumberOfRounds,
} from '../lib/swiss.js';
import {
  generatePlayoffBracket,
  type PlayoffMatch,
  InsufficientPlayersError,
} from '../lib/playoff-generator.js';
import { emitStatusChange, emitBracketUpdate } from '../lib/emit.js';
import { notifyRoundPairings } from '../lib/discord-notify.js';

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
          games: {
            select: {
              winner_id: true,
              status: true,
              map_decision: { select: { picked_map_id: true } },
            },
          },
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
          player1GameWins: m.games.filter((g) => g.winner_id === m.player1_id && g.status === 'COMPLETED').length,
          player2GameWins: m.games.filter((g) => g.winner_id === m.player2_id && g.status === 'COMPLETED').length,
          pickedMapId: m.games.find((g) => g.map_decision?.picked_map_id)?.map_decision?.picked_map_id ?? null,
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
            // Only provide game counts when MatchGame records exist; otherwise leave
            // undefined so swiss.ts falls back to the winner-based heuristic (1/0).
            // Only use actual game records when at least one is COMPLETED.
            // PENDING records (created for map-tracking only) must not block the fallback.
            player1_game_wins: m.games.some((g) => g.status === 'COMPLETED')
              ? m.games.filter((g) => g.winner_id === m.player1_id && g.status === 'COMPLETED').length
              : undefined,
            player2_game_wins: m.games.some((g) => g.status === 'COMPLETED')
              ? m.games.filter((g) => g.winner_id === m.player2_id && g.status === 'COMPLETED').length
              : undefined,
          }));

        const rawStandings = sortSwissStandings(
          computeSwissStandings(participantIds, completedMatches),
          completedMatches,
        );

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
            gamesLost: s.gamesLost,
            buchholz: s.buchholz,
            solkoff: s.solkoff,
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

      // Use full tiebreaker sort (score → buchholz → solkoff → H2H) for standings
      const rawStandings = computeSwissStandings(participantIds, completedMatchRecords);
      const standings = sortSwissStandings(rawStandings, completedMatchRecords);

      const isLastSwissRound = targetRound === recommendedRounds;

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

      // If this is the last Swiss round, generate playoff matches (if configured)
      let playoffMatchesCreated = 0;
      let playoffFallbackApplied: string | undefined;

      const fullTournament = isLastSwissRound
        ? await fastify.prisma.tournament.findFirst({
            where: { id: tournament.id },
            select: {
              playoff_format: true,
              playoff_match_format: true,
              finale_match_format: true,
            },
          })
        : null;

      let playoffMatches: Array<{
        id: string;
        tournament_id: string;
        round: number;
        match_number: number;
        player1_id: string | null;
        player2_id: string | null;
        status: MatchStatus;
        next_match_id: string | null;
        phase: 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL' | null;
      }> = [];

      if (isLastSwissRound && fullTournament && fullTournament.playoff_format !== 'NONE') {
        try {
          // For playoff generation: all participants are "checked in" if they participated
          const checkedInSet = new Set(participantIds);

          const playoffResult = generatePlayoffBracket({
            tournament: {
              playoff_format: fullTournament.playoff_format,
              playoff_match_format: fullTournament.playoff_match_format,
              finale_match_format: fullTournament.finale_match_format,
            },
            finalStandings: standings,
            checkedInPlayerIds: checkedInSet,
          });

          if (playoffResult.fallbackApplied) {
            playoffFallbackApplied = playoffResult.fallbackApplied;
            request.log.info(
              { tournamentId: tournament.id, fallback: playoffResult.fallbackApplied },
              'Playoff fallback applied',
            );
          }

          // Map PlayoffMatch descriptors to DB rows
          // Swiss rounds are numbered 1..N; playoff rounds start at N+1
          const playoffRoundOffset = targetRound;
          const phaseMap: Record<number, 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL'> =
            playoffResult.format === 'TOP8'
              ? { 1: 'PLAYOFF_QF', 2: 'PLAYOFF_SF', 3: 'PLAYOFF_FINAL' }
              : { 1: 'PLAYOFF_SF', 2: 'PLAYOFF_FINAL' };

          playoffMatches = playoffResult.matches.map((pm: PlayoffMatch) => ({
            id: randomUUID(),
            tournament_id: tournament.id,
            round: playoffRoundOffset + pm.round,
            match_number: pm.bracket_position,
            player1_id: pm.player1_id || null,
            player2_id: pm.player2_id || null,
            status: (pm.player1_id && pm.player2_id ? 'PENDING' : 'PENDING') as MatchStatus,
            next_match_id: null,
            phase: phaseMap[pm.round] ?? null,
          }));

          playoffMatchesCreated = playoffMatches.length;
        } catch (err) {
          if (err instanceof InsufficientPlayersError) {
            request.log.warn(
              { tournamentId: tournament.id, err: err.message },
              'Insufficient players for playoff — skipping playoff generation',
            );
          } else {
            throw err;
          }
        }
      }

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
            phase: 'SWISS' as const,
          })),
        });

        // Persist playoff matches
        if (playoffMatches.length > 0) {
          await tx.match.createMany({
            data: playoffMatches.map((pm) => ({
              id: pm.id,
              tournament_id: pm.tournament_id,
              round: pm.round,
              match_number: pm.match_number,
              player1_id: pm.player1_id,
              player2_id: pm.player2_id,
              status: pm.status,
              next_match_id: pm.next_match_id,
              phase: pm.phase,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'swiss_next_round',
            actor_id: request.user.sub,
            new_value: {
              round: targetRound,
              matches_created: newMatches.length,
              playoff_matches_created: playoffMatchesCreated,
              playoff_fallback: playoffFallbackApplied ?? null,
            },
          },
        });
      });

      emitBracketUpdate(fastify.io, tournament.id);

      // Notify pairings via Discord (non-fatal, fire-and-forget)
      try {
        const tournamentForNotify = await fastify.prisma.tournament.findFirst({
          where: { id: tournament.id },
          select: { id: true, name: true, slug: true, start_date: true },
        });

        if (tournamentForNotify) {
          const pairingData = await Promise.all(
            newMatches
              .filter((m) => m.player1_id && m.player2_id)
              .map(async (m) => {
                const [p1, p2] = await Promise.all([
                  fastify.prisma.user.findUnique({
                    where: { id: m.player1_id! },
                    select: { discord_id: true, username: true },
                  }),
                  fastify.prisma.user.findUnique({
                    where: { id: m.player2_id! },
                    select: { discord_id: true, username: true },
                  }),
                ]);
                if (!p1 || !p2) return null;
                return {
                  matchId: m.id,
                  player1: { discord_id: p1.discord_id, username: p1.username },
                  player2: { discord_id: p2.discord_id, username: p2.username },
                  round: targetRound,
                  map: null,
                };
              }),
          );

          const pairings = pairingData.filter((p): p is NonNullable<typeof p> => p !== null);

          await notifyRoundPairings(tournamentForNotify, targetRound, pairings).catch((err) => {
            request.log.warn({ err }, 'notifyRoundPairings failed (non-fatal)');
          });
        }
      } catch (notifyErr) {
        request.log.warn({ notifyErr }, 'Pairing notification error (non-fatal)');
      }

      return reply.code(200).send({
        tournamentId: tournament.id,
        round: targetRound,
        matches_created: newMatches.length,
        isLastRound: isLastSwissRound,
        recommendedRounds,
        playoff_matches_created: playoffMatchesCreated,
        playoff_fallback_applied: playoffFallbackApplied ?? null,
      });
    },
  );

  /**
   * POST /api/tournaments/:id/playoff/propagate-winner
   * Internal-use endpoint: after a playoff match completes, propagate the winner
   * to the next bracket slot. Called by match-result route after COMPLETED.
   *
   * Also exposed as REST for testing and admin override.
   */
  fastify.post<{ Params: { id: string }; Body: { completedMatchId: string } }>(
    '/api/tournaments/:id/playoff/propagate-winner',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id: tournamentId } = request.params;
      const { completedMatchId } = request.body;

      const completedMatch = await fastify.prisma.match.findFirst({
        where: { id: completedMatchId, tournament_id: tournamentId, deleted_at: null },
        select: {
          id: true,
          round: true,
          match_number: true,
          phase: true,
          winner_id: true,
          status: true,
        },
      });

      if (!completedMatch) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      if (completedMatch.status !== 'COMPLETED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Match is not yet COMPLETED',
          statusCode: 422,
        });
      }

      if (!completedMatch.winner_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Match has no winner to propagate',
          statusCode: 422,
        });
      }

      const winnerId = completedMatch.winner_id;
      const nextRound = completedMatch.round + 1;

      // For TOP8: QF round 1 (QF1+QF2 → SF1, QF3+QF4 → SF2); SF round 2 → Final
      // For TOP4: SF round 1 → Final
      // Bracket position determines slot in next round.
      // Odd-numbered positions feed into the floor(position/2)+1 slot of next round.
      // bracket_position 1,2 → next round position 1; 3,4 → next round position 2.
      const nextPosition = Math.ceil(completedMatch.match_number / 2);

      const nextMatch = await fastify.prisma.match.findFirst({
        where: {
          tournament_id: tournamentId,
          round: nextRound,
          match_number: nextPosition,
          deleted_at: null,
          phase: { in: ['PLAYOFF_SF', 'PLAYOFF_FINAL'] },
        },
        select: { id: true, player1_id: true, player2_id: true },
      });

      if (!nextMatch) {
        // No further match — this was the Final
        return reply.code(200).send({ propagated: false, message: 'No further playoff match found (Final completed)' });
      }

      // Fill whichever slot is empty
      const slotToFill = nextMatch.player1_id === null ? 'player1_id' : 'player2_id';

      await fastify.prisma.match.update({
        where: { id: nextMatch.id },
        data: { [slotToFill]: winnerId },
      });

      emitBracketUpdate(fastify.io, tournamentId);

      return reply.code(200).send({
        propagated: true,
        winnerId,
        nextMatchId: nextMatch.id,
        slotFilled: slotToFill,
      });
    },
  );

  /**
   * POST /api/tournaments/:id/bracket/reset
   * Deletes all matches (and cascaded sub-entities) and resets status to
   * REGISTRATION_CLOSED so the organizer can re-start from scratch.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/bracket/reset',
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
        select: { id: true, slug: true, status: true, organizer_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      const actorRole = request.user.role;
      if (actorRole === 'ORGANIZER' && tournament.organizer_id !== request.user.sub) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament organizer can reset this bracket',
          statusCode: 403,
        });
      }

      if (tournament.status !== TournamentStatus.ONGOING) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Bracket can only be reset while tournament is ONGOING',
          statusCode: 400,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        // Null self-referencing FKs first to avoid NoAction constraint violations
        await tx.match.updateMany({
          where: { tournament_id: id },
          data: { next_match_id: null, loser_next_match_id: null },
        });

        // Delete all matches — cascades MatchGame, MatchMapDecision, MatchBlindPick,
        // Draft, DraftEvent, and MatchReport automatically
        await tx.match.deleteMany({ where: { tournament_id: id } });

        await tx.tournament.update({
          where: { id },
          data: { status: TournamentStatus.REGISTRATION_CLOSED },
        });
      });

      emitBracketUpdate(fastify.io, id);
      emitStatusChange(fastify.io, {
        tournamentId: id,
        status: TournamentStatus.REGISTRATION_CLOSED,
      });

      return reply.code(200).send({ ok: true });
    },
  );
};

export default bracketRoutes;
