import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { MatchStatus, TournamentFormat, TournamentMode, TournamentStatus } from '@rizzotto/db';
import type { BracketResponse, SwissStandingEntry } from '@rizzotto/types';
import { generateSingleElim, generateDoubleElim } from '../lib/bracket.js';
import { generateRoundRobin } from '../lib/round-robin.js';
import { generateLiechtensteinSchedule } from '../lib/liechtenstein.js';
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
import { canManageTournament } from '../lib/tournament-utils.js';
import { notifyMatchesCreated } from '../lib/discord-notify.js';

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
        select: { id: true, format: true, mode: true, status: true, swiss_match_format: true, playoff_match_format: true, finale_match_format: true, rounds_count: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      const participantFactions = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: tournament.id, deleted_at: null },
        select: { user_id: true, faction_id: true },
      });
      const factionByUser = new Map(participantFactions.map((p) => [p.user_id, p.faction_id]));

      // factionFromGames is built after the matches query — see below.
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
          phase: true,
          player1_faction_id: true,
          player2_faction_id: true,
          draft: { select: { id: true, status: true } },
          games: {
            select: {
              winner_id: true,
              status: true,
              player1_faction_id: true,
              player2_faction_id: true,
              map_decision: { select: { picked_map_id: true } },
            },
          },
        },
      });

      const rounds = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;

      // Derive faction per player from completed game records (most authoritative source —
      // set when the game result is reported, before TournamentParticipant is latched).
      const factionFromGames = new Map<string, string>();
      for (const m of matches) {
        for (const g of m.games) {
          if (g.status === 'COMPLETED') {
            if (m.player1_id && g.player1_faction_id && !factionFromGames.has(m.player1_id)) {
              factionFromGames.set(m.player1_id, g.player1_faction_id);
            }
            if (m.player2_id && g.player2_faction_id && !factionFromGames.has(m.player2_id)) {
              factionFromGames.set(m.player2_id, g.player2_faction_id);
            }
          }
        }
      }

      const response: BracketResponse = {
        tournamentId: tournament.id,
        rounds,
        mode: tournament.mode ?? undefined,
        status: tournament.status,
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
          matchFormat: m.phase === 'PLAYOFF_FINAL'
            ? tournament.finale_match_format
            : m.phase?.startsWith('PLAYOFF')
              ? tournament.playoff_match_format
              : tournament.swiss_match_format,
          // SFT: TournamentParticipant.faction_id is the committed faction — always authoritative.
          // Other modes: per-match faction first, TournamentParticipant as fallback.
          player1FactionId: tournament.mode === TournamentMode.SFT
            ? (m.player1_id ? factionByUser.get(m.player1_id) ?? null : null)
            : m.player1_faction_id ?? (m.player1_id ? factionByUser.get(m.player1_id) ?? null : null),
          player2FactionId: tournament.mode === TournamentMode.SFT
            ? (m.player2_id ? factionByUser.get(m.player2_id) ?? null : null)
            : m.player2_faction_id ?? (m.player2_id ? factionByUser.get(m.player2_id) ?? null : null),
          player1GameWins: m.games.filter((g) => g.winner_id === m.player1_id && g.status === 'COMPLETED').length,
          player2GameWins: m.games.filter((g) => g.winner_id === m.player2_id && g.status === 'COMPLETED').length,
          pickedMapId: m.games.find((g) => g.map_decision?.picked_map_id)?.map_decision?.picked_map_id ?? null,
          draft_id: m.draft?.id ?? null,
          draft_status: (m.draft?.status ?? null) as BracketResponse['matches'][number]['draft_status'],
          phase: (m.phase ?? null) as BracketResponse['matches'][number]['phase'],
        })),
      };

      // Augment with standings for Swiss, Round Robin, and Auto Swiss
      if (tournament.format === TournamentFormat.SWISS || tournament.format === TournamentFormat.ROUND_ROBIN || tournament.format === TournamentFormat.LIECHTENSTEIN || tournament.format === TournamentFormat.AUTO_SWISS) {
        const participants = await fastify.prisma.tournamentParticipant.findMany({
          where: {
            tournament_id: tournament.id,
            status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] },
            deleted_at: null,
          },
          select: {
            user_id: true,
            status: true,
            user: { select: { id: true, username: true, avatar_url: true } },
          },
        });

        const participantIds = participants.map((p) => p.user_id);
        const userMap = new Map(participants.map((p) => [p.user_id, p.user]));
        const withdrawnIds = new Set(
          participants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id),
        );

        const completedMatches = matches
          .filter((m) =>
            (m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST') &&
            (m.phase === null || m.phase === 'SWISS'),
          )
          .map((m) => ({
            round: m.round,
            player1_id: m.player1_id,
            player2_id: m.player2_id,
            winner_id: m.winner_id,
            status: m.status,
            player1_game_wins: m.games.some((g) => g.status === 'COMPLETED')
              ? m.games.filter((g) => g.winner_id === m.player1_id && g.status === 'COMPLETED').length
              : undefined,
            player2_game_wins: m.games.some((g) => g.status === 'COMPLETED')
              ? m.games.filter((g) => g.winner_id === m.player2_id && g.status === 'COMPLETED').length
              : undefined,
          }));

        const computedStandings = computeSwissStandings(participantIds, completedMatches, withdrawnIds);
        const rawStandings = sortSwissStandings(computedStandings, completedMatches);

        const standings: SwissStandingEntry[] = rawStandings.map((s) => {
          const user = userMap.get(s.userId);
          return {
            userId: s.userId,
            username: user?.username ?? null,
            avatarUrl: user?.avatar_url ?? null,
            factionId: factionByUser.get(s.userId) ?? factionFromGames.get(s.userId) ?? null,
            score: s.score,
            wins: s.wins,
            losses: s.losses,
            draws: s.draws,
            byes: s.byes,
            gamesLost: s.gamesLost,
            buchholz: s.buchholz,
            solkoff: s.solkoff,
            dropped: (s.dropped || withdrawnIds.has(s.userId)) || undefined,
          };
        });

        // For AUTO_SWISS, rounds_count is authoritative (set by autoSwissConfig).
        // For manual SWISS, fall back to the recommendation formula.
        const activeCount = participantIds.length - rawStandings.filter((s) => s.dropped).length;
        const recommendedRounds = tournament.rounds_count ?? recommendNumberOfRounds(activeCount);

        response.swiss = {
          recommendedRounds,
          currentRound: rounds,
          standings,
        };
      }

      return response;
    },
  );

  /**
   * POST /api/tournaments/:id/start
   * Auth required. Host or MOD/ADMIN only.
   * Generates the bracket/rounds, transitions tournament to ONGOING.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/start',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
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
          host_id: true,
          rounds_count: true,
          has_third_place_match: true,
          start_date: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament host can start this tournament',
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

      const allEligible = await fastify.prisma.tournamentParticipant.findMany({
        where: {
          tournament_id: tournament.id,
          status: { in: ['REGISTERED', 'CHECKED_IN'] },
          deleted_at: null,
        },
        orderBy: { registered_at: 'asc' },
        select: { user_id: true, status: true, faction_id: true },
      });

      const now = new Date();
      const checkInWindowOpen =
        now >= new Date(tournament.start_date.getTime() - 60 * 60 * 1000);
      const checkedIn = allEligible.filter((p) => p.status === 'CHECKED_IN');
      const participants =
        checkInWindowOpen && checkedIn.length > 0 ? checkedIn : allEligible;

      if (participants.length < 2) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'At least 2 participants required',
          statusCode: 400,
        });
      }

      const participantIds = participants.map((p) => p.user_id);
      const factionById = new Map<string, string | null>(
        allEligible.map((p) => [p.user_id, p.faction_id]),
      );
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
        phase?: string | null;
      }>;

      switch (tournament.format) {
        case TournamentFormat.SINGLE_ELIMINATION: {
          bracketMatches = generateSingleElim(tournament.id, participantIds, {
            hasThirdPlace: tournament.has_third_place_match,
          });
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
            factionId: factionById.get(userId) ?? null,
          }));
          bracketMatches = generateSwissRound(tournament.id, swissPlayers, 1);
          break;
        }

        case TournamentFormat.LIECHTENSTEIN: {
          try {
            bracketMatches = generateLiechtensteinSchedule(
              tournament.id,
              participantIds,
              tournament.rounds_count ?? 5,
              { factionById },
            );
          } catch (err) {
            return reply.code(400).send({
              error: 'BadRequest',
              message: err instanceof Error ? err.message : 'Liechtenstein-Scheduling fehlgeschlagen',
              statusCode: 400,
            });
          }
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
            phase: (m.phase ?? (tournament.format === TournamentFormat.SWISS ? 'SWISS' : null)) as import('@rizzotto/db').MatchPhase | null,
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

      // B22: notify round-1 pairings (previously only rounds 2+ were announced).
      await notifyMatchesCreated(
        tournament.id,
        1,
        bracketMatches.filter((m) => m.round === 1),
      );

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
   * Auth required. Host or MOD/ADMIN only.
   * SWISS only: generates the next round of pairings based on current standings.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/next-round',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
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
          host_id: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament host can advance rounds',
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

      // Pair only CHECKED_IN players (B14): REGISTERED-but-never-checked-in must not
      // enter pairing in later rounds. WITHDREW is kept for correct Buchholz (they
      // contribute to opponents' BH) but is excluded from pairing via withdrawnIds.
      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: {
          tournament_id: tournament.id,
          status: { in: ['CHECKED_IN', 'WITHDREW'] },
          deleted_at: null,
        },
        select: { user_id: true, faction_id: true, status: true },
      });

      const participantIds = participants.map((p) => p.user_id);
      const withdrawnIds = new Set(
        participants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id),
      );
      const factionById = new Map<string, string | null>(
        participants.map((p) => [p.user_id, p.faction_id]),
      );
      const targetRound = currentRound + 1;
      const recommendedRounds = recommendNumberOfRounds(participantIds.length);

      if (targetRound > recommendedRounds) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `All ${recommendedRounds} Swiss rounds played; use start-playoffs or finalize the tournament`,
          statusCode: 400,
        });
      }

      // Verify all matches in current round are completed or BYE
      const currentRoundMatches = existingMatches.filter((m) => m.round === currentRound);
      const incomplete = currentRoundMatches.filter(
        (m) => m.status !== 'COMPLETED' && m.status !== 'BYE' && m.status !== 'FORFEIT' && m.status !== 'CANCELLED' && m.status !== 'NO_CONTEST',
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
        .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST')
        .map((m) => ({
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          winner_id: m.winner_id,
          status: m.status,
        }));

      const rawStandings = computeSwissStandings(participantIds, completedMatchRecords, withdrawnIds);
      const standings = sortSwissStandings(rawStandings, completedMatchRecords);

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

      // No-contest pairs must NEVER be re-paired (B8/B10) — harder than a rematch.
      const noContestMap = new Map<string, string[]>();
      for (const m of existingMatches) {
        if (m.status === 'NO_CONTEST' && m.player1_id && m.player2_id) {
          (noContestMap.get(m.player1_id) ?? noContestMap.set(m.player1_id, []).get(m.player1_id)!).push(m.player2_id);
          (noContestMap.get(m.player2_id) ?? noContestMap.set(m.player2_id, []).get(m.player2_id)!).push(m.player1_id);
        }
      }

      const swissPlayers = standings.filter((s) => !s.dropped).map((s) => ({
        userId: s.userId,
        score: s.score,
        avoid: avoidMap.get(s.userId) ?? [],
        receivedBye: byeMap.get(s.userId) ?? false,
        factionId: factionById.get(s.userId) ?? null,
        noContestAvoid: noContestMap.get(s.userId) ?? [],
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
            phase: 'SWISS' as const,
          })),
        });

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'swiss_next_round',
            actor_id: request.user.sub,
            new_value: { round: targetRound, matches_created: newMatches.length },
          },
        });
      });

      emitBracketUpdate(fastify.io, tournament.id);

      // Notify pairings via Discord (non-fatal, fire-and-forget)
      await notifyMatchesCreated(tournament.id, targetRound, newMatches);

      return reply.code(200).send({
        tournamentId: tournament.id,
        round: targetRound,
        matches_created: newMatches.length,
        isLastRound: targetRound === recommendedRounds,
        recommendedRounds,
      });
    },
  );

  /**
   * POST /api/tournaments/:id/start-playoffs
   * Auth required. Host or MOD/ADMIN only.
   * Generates the playoff bracket from the final Swiss standings.
   * Must be called after all Swiss rounds are completed.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/start-playoffs',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id, deleted_at: null },
        select: {
          id: true,
          format: true,
          status: true,
          host_id: true,
          playoff_format: true,
          playoff_match_format: true,
          finale_match_format: true,
          has_third_place_match: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }

      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can start playoffs', statusCode: 403 });
      }

      if (
        tournament.format !== TournamentFormat.SWISS &&
        tournament.format !== TournamentFormat.ROUND_ROBIN &&
        tournament.format !== TournamentFormat.LIECHTENSTEIN
      ) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Playoffs can only be started for Swiss, Round Robin, or Liechtenstein tournaments', statusCode: 400 });
      }

      if (tournament.status !== TournamentStatus.ONGOING) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Tournament is not ONGOING', statusCode: 400 });
      }

      if (!tournament.playoff_format || tournament.playoff_format === 'NONE') {
        return reply.code(400).send({ error: 'BadRequest', message: 'Tournament has no playoff format configured', statusCode: 400 });
      }

      // Load all existing matches
      const existingMatches = await fastify.prisma.match.findMany({
        where: { tournament_id: id, deleted_at: null },
        select: { id: true, round: true, player1_id: true, player2_id: true, winner_id: true, status: true, phase: true },
      });

      // Guard: no playoff matches yet
      const hasPlayoffs = existingMatches.some((m) => m.phase && m.phase !== 'SWISS');
      if (hasPlayoffs) {
        return reply.code(409).send({ error: 'Conflict', message: 'Playoffs have already been generated', statusCode: 409 });
      }

      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: id, status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] }, deleted_at: null },
        select: { user_id: true, status: true },
      });

      const participantIds = participants.map((p) => p.user_id);
      const withdrawnIds = new Set(
        participants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id),
      );
      const currentRound = existingMatches.length > 0 ? Math.max(...existingMatches.map((m) => m.round)) : 0;

      if (tournament.format === TournamentFormat.ROUND_ROBIN) {
        // For Round Robin all rounds are pre-generated — every non-playoff match must be complete
        const incompleteRR = existingMatches.filter(
          (m) => m.phase === null && m.status !== 'COMPLETED' && m.status !== 'BYE',
        );
        if (incompleteRR.length > 0) {
          return reply.code(400).send({
            error: 'BadRequest',
            message: `Round Robin phase not complete — ${incompleteRR.length} match(es) remaining`,
            statusCode: 400,
          });
        }
      } else {
        // Swiss: must have played the recommended number of rounds
        const recommendedRounds = recommendNumberOfRounds(participantIds.length);
        if (currentRound < recommendedRounds) {
          return reply.code(400).send({
            error: 'BadRequest',
            message: `Swiss phase not complete — ${currentRound}/${recommendedRounds} rounds played`,
            statusCode: 400,
          });
        }
        const incomplete = existingMatches.filter(
          (m) => m.round === currentRound && m.status !== 'COMPLETED' && m.status !== 'BYE' && m.status !== 'FORFEIT' && m.status !== 'CANCELLED' && m.status !== 'NO_CONTEST',
        );
        if (incomplete.length > 0) {
          return reply.code(400).send({
            error: 'BadRequest',
            message: `${incomplete.length} match(es) in round ${currentRound} not yet completed`,
            statusCode: 400,
          });
        }
      }

      // Compute final Swiss standings
      const completedMatchRecords = existingMatches
        .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE')
        .map((m) => ({
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          winner_id: m.winner_id,
          status: m.status,
        }));

      const rawStandings = computeSwissStandings(participantIds, completedMatchRecords, withdrawnIds);
      const standings = sortSwissStandings(rawStandings, completedMatchRecords);
      const activeStandings = standings.filter((s) => !s.dropped);

      let playoffFallbackApplied: string | undefined;

      try {
        const playoffResult = generatePlayoffBracket({
          tournament: {
            playoff_format: tournament.playoff_format as 'NONE' | 'TOP2' | 'TOP4' | 'TOP8',
            playoff_match_format: tournament.playoff_match_format,
            finale_match_format: tournament.finale_match_format,
          },
          finalStandings: activeStandings,
          // B6: count only active (non-dropped) players for the reduction thresholds.
          checkedInPlayerIds: new Set(activeStandings.map((s) => s.userId)),
        });

        if (playoffResult.fallbackApplied) {
          playoffFallbackApplied = playoffResult.fallbackApplied;
        }

        const playoffRoundOffset = currentRound;
        const phaseMap: Record<number, 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL'> =
          playoffResult.format === 'TOP8'
            ? { 1: 'PLAYOFF_QF', 2: 'PLAYOFF_SF', 3: 'PLAYOFF_FINAL' }
            : playoffResult.format === 'TOP2'
              ? { 1: 'PLAYOFF_FINAL' }
              : { 1: 'PLAYOFF_SF', 2: 'PLAYOFF_FINAL' };

        // Only generate the first playoff round — subsequent rounds are advanced
        // one at a time via POST /advance-playoffs once each round completes.
        const playoffMatches = playoffResult.matches
          .filter((pm: PlayoffMatch) => pm.round === 1)
          .map((pm: PlayoffMatch) => ({
            id: randomUUID(),
            tournament_id: id,
            round: playoffRoundOffset + pm.round,
            match_number: pm.bracket_position,
            player1_id: pm.player1_id || null,
            player2_id: pm.player2_id || null,
            status: 'PENDING' as MatchStatus,
            next_match_id: null,
            phase: phaseMap[pm.round] ?? null,
          }));

        await fastify.prisma.$transaction(async (tx) => {
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

          await tx.auditLog.create({
            data: {
              entity_type: 'Tournament',
              entity_id: id,
              action: 'start_playoffs',
              actor_id: request.user.sub,
              new_value: {
                format: playoffResult.format,
                matches_created: playoffMatches.length,
                fallback: playoffFallbackApplied ?? null,
              },
            },
          });
        });

        emitBracketUpdate(fastify.io, id);

        // B22: notify the first playoff round's participants (QF/SF).
        const playablePO = playoffMatches.filter((m) => m.player1_id && m.player2_id);
        if (playablePO.length > 0) {
          await notifyMatchesCreated(id, Math.min(...playablePO.map((m) => m.round)), playablePO);
        }

        return reply.code(200).send({
          tournamentId: id,
          format: playoffResult.format,
          matches_created: playoffMatches.length,
          fallback_applied: playoffFallbackApplied ?? null,
        });
      } catch (err) {
        if (err instanceof InsufficientPlayersError) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: err.message,
            statusCode: 422,
          });
        }
        throw err;
      }
    },
  );

  /**
   * POST /api/tournaments/:id/advance-playoffs
   * Generate the next playoff round from the winners of the current one.
   * Called after all QF matches are done (to create SF) or all SF are done (to create Final).
   */
  fastify.post(
    '/api/tournaments/:id/advance-playoffs',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id, deleted_at: null, status: 'ONGOING' },
        select: { id: true, host_id: true, playoff_match_format: true, finale_match_format: true, has_third_place_match: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }

      const allPlayoffMatches = await fastify.prisma.match.findMany({
        where: {
          tournament_id: id,
          deleted_at: null,
          phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL'] },
        },
        orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
      });

      if (allPlayoffMatches.length === 0) {
        return reply.code(409).send({ error: 'Conflict', message: 'No playoff matches — call start-playoffs first', statusCode: 409 });
      }
      if (allPlayoffMatches.some((m) => m.phase === 'PLAYOFF_FINAL')) {
        return reply.code(409).send({ error: 'Conflict', message: 'Playoffs already fully generated', statusCode: 409 });
      }

      const currentRound = Math.max(...allPlayoffMatches.map((m) => m.round));
      const currentRoundMatches = allPlayoffMatches
        .filter((m) => m.round === currentRound)
        .sort((a, b) => a.match_number - b.match_number);

      // A playoff match only counts as resolved when it has a definitive winner:
      // COMPLETED / BYE always resolve; FORFEIT resolves only if a winner was
      // recorded (one-sided drop). CANCELLED (double-drop, no winner) and any
      // FORFEIT without winner_id do NOT resolve — they must block advancement,
      // otherwise we propagate phantom/dropped players into the GF + third-place
      // match before the semifinals were ever played.
      const incomplete = currentRoundMatches.filter((m) => {
        if (m.status === 'COMPLETED' || m.status === 'BYE') return false;
        if (m.status === 'FORFEIT' && m.winner_id !== null) return false;
        return true;
      });
      if (incomplete.length > 0) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `${incomplete.length} match(es) in current playoff round not yet decided (a cancelled or unfinished match cannot advance — restore or replay it first)`,
          statusCode: 422,
        });
      }

      const currentPhases = new Set(currentRoundMatches.map((m) => m.phase));
      const nextPhase: 'PLAYOFF_SF' | 'PLAYOFF_FINAL' = currentPhases.has('PLAYOFF_QF')
        ? 'PLAYOFF_SF'
        : 'PLAYOFF_FINAL';

      // Pair winners into next round matches (GF or SFs).
      const nextMatches = currentRoundMatches
        .reduce<{ m1: typeof currentRoundMatches[0]; m2?: typeof currentRoundMatches[0] }[]>(
          (pairs, m, i) => {
            if (i % 2 === 0) pairs.push({ m1: m });
            else pairs[pairs.length - 1]!.m2 = m;
            return pairs;
          },
          [],
        )
        .map(({ m1, m2 }, i) => ({
          id: randomUUID(),
          tournament_id: id,
          round: currentRound + 1,
          match_number: i + 1,
          player1_id: m1.winner_id ?? null,
          player2_id: m2?.winner_id ?? null,
          status: 'PENDING' as MatchStatus,
          next_match_id: null as string | null,
          phase: nextPhase,
        }));

      // Defend against a phantom slot: with the guard above every feeding match
      // has a winner, but never persist a next-round match with an empty slot.
      const phantom = nextMatches.find((m) => m.player1_id === null || m.player2_id === null);
      if (phantom) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message:
            'Cannot generate the next round: a feeding match has no winner. Restore or replay the affected match first.',
          statusCode: 422,
        });
      }

      // When advancing to the Grand Final: also create the third-place match with
      // the SF losers already filled in — exactly analogous to the GF being created
      // with the SF winners. Then wire loser_next_match_id on the SF rows.
      const thirdPlaceMatch =
        tournament.has_third_place_match && nextPhase === 'PLAYOFF_FINAL'
          ? (() => {
              const sf1 = currentRoundMatches[0];
              const sf2 = currentRoundMatches[1];
              const loser = (m: typeof sf1): string | null => {
                if (!m || m.winner_id === null) return null;
                return m.player1_id === m.winner_id ? m.player2_id : m.player1_id;
              };
              const l1 = loser(sf1);
              const l2 = loser(sf2);
              // Skip when a loser cannot be determined (e.g. a bye SF). The small
              // final can still be added later via add-third-place-match.
              if (l1 === null || l2 === null) return null;
              return {
                id: randomUUID(),
                tournament_id: id,
                round: currentRound + 1,
                match_number: 2,
                player1_id: l1,
                player2_id: l2,
                status: 'PENDING' as MatchStatus,
                next_match_id: null as string | null,
                phase: 'PLAYOFF_THIRD_PLACE' as const,
              };
            })()
          : null;

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.createMany({
          data: [...nextMatches, ...(thirdPlaceMatch ? [thirdPlaceMatch] : [])].map((m) => ({
            id: m.id,
            tournament_id: m.tournament_id,
            round: m.round,
            match_number: m.match_number,
            player1_id: m.player1_id,
            player2_id: m.player2_id,
            status: m.status,
            next_match_id: m.next_match_id,
            phase: m.phase as import('@rizzotto/db').MatchPhase | null,
          })),
        });

        // Wire loser connectors on the SFs so the SVG bracket draws the dashed lines.
        if (thirdPlaceMatch) {
          await tx.match.updateMany({
            where: { id: { in: currentRoundMatches.map((m) => m.id) } },
            data: { loser_next_match_id: thirdPlaceMatch.id },
          });
        }

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: id,
            action: 'advance_playoffs',
            actor_id: request.user.sub,
            new_value: { phase: nextPhase, matches_created: nextMatches.length },
          },
        });
      });

      emitBracketUpdate(fastify.io, id);

      // B22: notify newly created playoff-round participants (SF/GF/small final).
      const advanced = [...nextMatches, ...(thirdPlaceMatch ? [thirdPlaceMatch] : [])]
        .filter((m) => m.player1_id && m.player2_id);
      if (advanced.length > 0) {
        await notifyMatchesCreated(id, Math.min(...advanced.map((m) => m.round)), advanced);
      }

      return reply.code(200).send({ phase: nextPhase, matches_created: nextMatches.length });
    },
  );

  /**
   * POST /api/tournaments/:id/add-third-place-match
   * Retroactively creates (or repairs) the small final for both SE and
   * Swiss+Playoff formats:
   *   - SE: has_third_place_match was false at start → match was never created,
   *     OR loser propagation bug left the match with null players.
   *   - Playoff: has_third_place_match was false when advance-playoffs ran.
   */
  fastify.post(
    '/api/tournaments/:id/add-third-place-match',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id, deleted_at: null, status: 'ONGOING' },
        select: { id: true, host_id: true, format: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }
      // In DE the matches feeding the grand final are the WB and LB finals,
      // whose loser_next_match_id pointers are part of the bracket chain —
      // rewiring them here would corrupt it. Third place is decided by the
      // lower bracket anyway.
      if (tournament.format === 'DOUBLE_ELIMINATION') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Double elimination decides third place via the lower bracket — no small final needed',
          statusCode: 422,
        });
      }

      // Load all non-deleted matches for this tournament — works for both SE
      // (phase=null matches) and Playoff (phase='PLAYOFF_*' matches).
      const allMatches = await fastify.prisma.match.findMany({
        where: { tournament_id: id, deleted_at: null },
        orderBy: [{ round: 'asc' }, { match_number: 'asc' }],
      });

      // Existing third-place match (if any).
      const existingTP = allMatches.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE');
      if (existingTP && existingTP.player1_id !== null && existingTP.player2_id !== null) {
        return reply.code(409).send({ error: 'Conflict', message: 'Third-place match already exists with players', statusCode: 409 });
      }

      // Find the final: the match with no next_match_id that is NOT the TP match.
      // For SE: phase=null; for Playoff: phase='PLAYOFF_FINAL'. Both have next_match_id=null.
      const finalMatch = allMatches.find(
        (m) => m.next_match_id === null && m.phase !== 'PLAYOFF_THIRD_PLACE',
      );
      if (!finalMatch) {
        return reply.code(409).send({ error: 'Conflict', message: 'No final match found — start the bracket first', statusCode: 409 });
      }

      // Find the two matches feeding into the final (the semi-finals).
      const sfMatches = allMatches
        .filter((m) => m.next_match_id === finalMatch.id)
        .sort((a, b) => a.match_number - b.match_number);

      if (sfMatches.length < 2) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Expected 2 semifinal matches feeding into the final', statusCode: 422 });
      }

      // Same resolution rule as advance-playoffs: FORFEIT only counts when a
      // winner was recorded; CANCELLED / winner-less matches block the repair.
      const incomplete = sfMatches.filter((m) => {
        if (m.status === 'COMPLETED' || m.status === 'BYE') return false;
        if (m.status === 'FORFEIT' && m.winner_id !== null) return false;
        return true;
      });
      if (incomplete.length > 0) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `${incomplete.length} semifinal match(es) not yet decided`,
          statusCode: 422,
        });
      }

      const sf1 = sfMatches[0]!;
      const sf2 = sfMatches[1]!;
      const loser = (m: typeof sf1): string | null =>
        m.winner_id === null ? null : m.player1_id === m.winner_id ? m.player2_id : m.player1_id;
      const p1 = loser(sf1);
      const p2 = loser(sf2);

      // A semifinal decided by bye has no loser — creating the match anyway
      // would just reproduce the null-player state this endpoint repairs.
      if (p1 === null || p2 === null) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'A semifinal had no loser (bye) — third place cannot be determined automatically',
          statusCode: 422,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        if (existingTP) {
          // State B: match exists but players are null — fill them in.
          await tx.match.update({
            where: { id: existingTP.id },
            data: { player1_id: p1, player2_id: p2 },
          });
        } else {
          // State A: match doesn't exist — create it.
          const thirdPlaceId = randomUUID();
          await tx.match.create({
            data: {
              id: thirdPlaceId,
              tournament_id: id,
              round: finalMatch.round,
              match_number: 2,
              player1_id: p1,
              player2_id: p2,
              status: 'PENDING',
              phase: 'PLAYOFF_THIRD_PLACE',
            },
          });
          await tx.match.updateMany({
            where: { id: { in: [sf1.id, sf2.id] } },
            data: { loser_next_match_id: thirdPlaceId },
          });
        }
        await tx.tournament.update({
          where: { id },
          data: { has_third_place_match: true },
        });
        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: id,
            action: 'add_third_place_match',
            actor_id: request.user.sub,
            new_value: { repaired: !!existingTP },
          },
        });
      });

      emitBracketUpdate(fastify.io, id);

      return reply.code(201).send({ repaired: !!existingTP });
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
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
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
   * REGISTRATION_CLOSED so the host can re-start from scratch.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/tournaments/:id/bracket/reset',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('HOST', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, slug: true, status: true, host_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Tournament not found',
          statusCode: 404,
        });
      }

      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the tournament host can reset this bracket',
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
