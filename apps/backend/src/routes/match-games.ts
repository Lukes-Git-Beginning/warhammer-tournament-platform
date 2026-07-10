import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureMatchGame, finalizeGameResult } from '../lib/match-games.js';
import { REPLAY_DIR } from '../lib/replays.js';
import { canManageTournament } from '../lib/tournament-utils.js';
import { notifyOpenPlayDispute } from '../lib/discord-notify.js';

const LobbyCodeBodySchema = z.object({
  lobby_code: z.string().max(64).nullable(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeGame(game: {
  id: string;
  game_number: number;
  status: string;
  winner_id: string | null;
  player1_faction_id: string | null;
  player2_faction_id: string | null;
  lobby_code: string | null;
  reported_winner_id: string | null;
  reporter_id: string | null;
  reported_at: Date | null;
  confirmed_at: Date | null;
  replay_url: string | null;
  played_at: Date | null;
  map_decision: {
    mode: string;
    top_player_id: string;
    bottom_player_id: string;
    coin_flip_seed: string;
    bans_top: unknown;
    bans_bottom: unknown;
    picked_map_id: string | null;
    decided_at: Date | null;
  } | null;
  blind_pick: {
    player1_locked_at: Date | null;
    player2_locked_at: Date | null;
    revealed_at: Date | null;
    player1_faction_id: string | null;
    player2_faction_id: string | null;
  } | null;
}, includeSensitive: boolean) {
  return {
    id: game.id,
    gameNumber: game.game_number,
    status: game.status,
    winnerId: game.winner_id,
    player1FactionId: game.player1_faction_id,
    player2FactionId: game.player2_faction_id,
    lobbyCode: includeSensitive ? game.lobby_code : null,
    reportedWinnerId: game.reported_winner_id,
    // reporter_id is an internal user UUID — only exposed to participants/staff
    reporterId: includeSensitive ? game.reporter_id : null,
    reportedAt: game.reported_at?.toISOString() ?? null,
    confirmedAt: game.confirmed_at?.toISOString() ?? null,
    replayUrl: game.replay_url,
    playedAt: game.played_at?.toISOString() ?? null,
    decision: game.map_decision
      ? {
          mode: game.map_decision.mode,
          topPlayerId: game.map_decision.top_player_id,
          bottomPlayerId: game.map_decision.bottom_player_id,
          seed: game.map_decision.coin_flip_seed,
          bansTop: (game.map_decision.bans_top as string[]) ?? [],
          bansBottom: (game.map_decision.bans_bottom as string[]) ?? [],
          pickedMapId: game.map_decision.picked_map_id,
          decidedAt: game.map_decision.decided_at?.toISOString() ?? null,
        }
      : null,
    blindPick: game.blind_pick
      ? {
          player1Locked: Boolean(game.blind_pick.player1_locked_at),
          player2Locked: Boolean(game.blind_pick.player2_locked_at),
          revealedAt: game.blind_pick.revealed_at?.toISOString() ?? null,
          player1FactionId: game.blind_pick.revealed_at
            ? (game.blind_pick.player1_faction_id ?? null)
            : null,
          player2FactionId: game.blind_pick.revealed_at
            ? (game.blind_pick.player2_faction_id ?? null)
            : null,
        }
      : null,
  };
}

const GAME_SELECT = {
  id: true,
  game_number: true,
  status: true,
  winner_id: true,
  player1_faction_id: true,
  player2_faction_id: true,
  lobby_code: true,
  reported_winner_id: true,
  reporter_id: true,
  reported_at: true,
  confirmed_at: true,
  replay_url: true,
  played_at: true,
  map_decision: true,
  blind_pick: true,
} as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const matchGamesRoutes: FastifyPluginAsync = async (fastify) => {
  await mkdir(REPLAY_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // GET /api/matches/:id/games
  // Returns all games for a match with their decision state.
  // For Bo1 matches with no game row yet, returns a virtual pending game.
  // lobby_code is masked for non-participants/non-staff.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/matches/:id/games',
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      // Optional auth to determine if lobby codes should be visible
      let currentUserId: string | null = null;
      try {
        await fastify.authenticate(request, reply);
        currentUserId = request.user?.sub ?? null;
      } catch {
        // unauthenticated — lobby codes hidden
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          withdrawn_player_id: true,
          tournament_id: true,
          tournament: { select: { host_id: true, mode: true, counts_for_leaderboard: true } },
          games: {
            orderBy: { game_number: 'asc' },
            select: GAME_SELECT,
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

      const isParticipant =
        currentUserId !== null &&
        (currentUserId === match.player1_id || currentUserId === match.player2_id);
      const isStaff =
        currentUserId !== null &&
        (await canManageTournament(
          fastify.prisma,
          match.tournament_id ?? '',
          currentUserId,
          request.user?.role ?? '',
        ));
      const includeLobbyCodes = isParticipant || isStaff;

      // 2D3: materialize the game-1 row on first read so the per-game faction
      // roll (drawTwoD3GameFactions, run inside ensureMatchGame) is drawn and
      // visible the moment the tile appears — before map selection, exactly like
      // an SFT faction. Idempotent; only for real, playable 2D3 matches (both
      // players set, not a BYE/completed match). Covers every match-creation path
      // (Swiss, Auto-Swiss, playoffs, manual) from a single point.
      let gameRows = match.games;
      if (
        gameRows.length === 0 &&
        match.player1_id &&
        match.player2_id &&
        match.tournament?.mode === 'TWO_D_THREE' &&
        (match.status === 'PENDING' || match.status === 'ONGOING')
      ) {
        try {
          await ensureMatchGame(fastify.prisma, matchId, 1, match.tournament.counts_for_leaderboard ?? true);
        } catch {
          // race: a concurrent read already materialized it — re-fetch below
        }
        gameRows = await fastify.prisma.matchGame.findMany({
          where: { match_id: matchId },
          orderBy: { game_number: 'asc' },
          select: GAME_SELECT,
        });
      }

      // For Bo1 with no game row yet, return a virtual pending game
      const games =
        gameRows.length > 0
          ? gameRows.map((g) => serializeGame(g, includeLobbyCodes))
          : [
              {
                id: null,
                gameNumber: 1,
                status: 'PENDING',
                winnerId: null,
                lobbyCode: null,
                reportedWinnerId: null,
                reportedAt: null,
                confirmedAt: null,
                replayUrl: null,
                playedAt: null,
                decision: null,
                blindPick: null,
              },
            ];

      return reply.code(200).send({
        games,
        // Match-level fields the frontend GameTile needs for the "opponent withdrew" banner.
        player1Id: match.player1_id,
        player2Id: match.player2_id,
        withdrawnPlayerId: match.withdrawn_player_id ?? null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/matches/:id/games/:gameNumber/lobby-code
  // Either player or host/admin can set the optional lobby code.
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/matches/:id/games/:gameNumber/lobby-code',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId, gameNumber: gameNumberStr } = request.params as {
        id: string;
        gameNumber: string;
      };
      const gameNumber = parseInt(gameNumberStr, 10);

      const parsed = LobbyCodeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          player1_id: true,
          player2_id: true,
          tournament_id: true,
          tournament: { select: { host_id: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const userId = request.user.sub;
      const isParticipant = userId === match.player1_id || userId === match.player2_id;
      const isStaff = await canManageTournament(
        fastify.prisma,
        match.tournament_id ?? '',
        userId,
        request.user.role,
      );

      if (!isParticipant && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not a participant or staff', statusCode: 403 });
      }

      const gameId = await ensureMatchGame(fastify.prisma, matchId, gameNumber);
      await fastify.prisma.matchGame.update({
        where: { id: gameId },
        data: { lobby_code: parsed.data.lobby_code },
      });

      if (fastify.io) {
        fastify.io.to(`match_decision_${matchId}`).emit('match.game.updated', {
          matchId,
          gameNumber,
          status: 'PENDING',
          winnerId: null,
          lobbyCode: parsed.data.lobby_code,
          reportedWinnerId: null,
          reportedAt: null,
          confirmedAt: null,
        });
      }

      return reply.code(200).send({ ok: true, lobby_code: parsed.data.lobby_code });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/games/:gameNumber/result
  // Multipart: winner_id (field) + replay (file, required on first report).
  // Implements provisional-result flow with 30-min auto-confirm window.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/games/:gameNumber/result',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId, gameNumber: gameNumberStr } = request.params as {
        id: string;
        gameNumber: string;
      };
      const gameNumber = parseInt(gameNumberStr, 10);
      const userId = request.user.sub;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          tournament_id: true,
        },
      });

      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status}`,
          statusCode: 422,
        });
      }

      const isPlayer1 = userId === match.player1_id;
      const isPlayer2 = userId === match.player2_id;

      if (!isPlayer1 && !isPlayer2) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only match participants can report game results',
          statusCode: 403,
        });
      }

      // Parse multipart — buffer the file immediately before any DB work to
      // prevent the stream from expiring mid-handler (busboy is consumed serially).
      const data = await request.file();
      const buffer = data ? await data.toBuffer() : null;
      const winnerIdField = (data?.fields['winner_id'] as { value?: string } | undefined)?.value;

      if (!winnerIdField) {
        return reply.code(400).send({ error: 'BadRequest', message: 'winner_id field required', statusCode: 400 });
      }

      if (winnerIdField !== match.player1_id && winnerIdField !== match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'winner_id must be player1 or player2 of this match',
          statusCode: 422,
        });
      }

      const gameId = await ensureMatchGame(fastify.prisma, matchId, gameNumber);
      const existingGame = await fastify.prisma.matchGame.findUnique({
        where: { id: gameId },
        select: {
          id: true,
          reported_at: true,
          reported_winner_id: true,
          reporter_id: true,
          status: true,
        },
      });

      if (!existingGame) {
        return reply.code(500).send({ error: 'Internal', message: 'Game row missing after ensure', statusCode: 500 });
      }

      if (existingGame.status === 'COMPLETED') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Game is already completed',
          statusCode: 409,
        });
      }

      if (existingGame.status === 'DISPUTED') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Game is disputed — host must resolve it',
          statusCode: 409,
        });
      }

      // -----------------------------------------------------------------------
      // First report
      // -----------------------------------------------------------------------
      if (!existingGame.reported_at) {
        // Replay is required for first report
        if (!buffer) {
          return reply.code(400).send({
            error: 'BadRequest',
            message: 'A replay file is required when reporting a game result',
            statusCode: 400,
          });
        }

        if (buffer.length === 0) {
          return reply.code(400).send({ error: 'BadRequest', message: 'Replay file is empty', statusCode: 400 });
        }

        const ext = data?.filename?.split('.').pop() ?? 'rec';
        const filename = `${randomUUID()}.${ext}`;
        const matchDir = join(REPLAY_DIR, matchId);
        await mkdir(matchDir, { recursive: true });
        await writeFile(join(matchDir, filename), buffer);

        const replayUrl = `/uploads/replays/${matchId}/${filename}`;
        const now = new Date();

        // Store report metadata (replay, reporter) then finalize immediately.
        // The bracket advances right away — disputes go via the host override.
        await fastify.prisma.matchGame.update({
          where: { id: gameId },
          data: {
            reported_winner_id: winnerIdField,
            reporter_id: userId,
            reported_at: now,
            replay_url: replayUrl,
          },
        });

        await finalizeGameResult(fastify, gameId);

        return reply.code(200).send({ confirmed: true, winnerId: winnerIdField });
      }

      // -----------------------------------------------------------------------
      // Second report (opponent reaction)
      // -----------------------------------------------------------------------
      if (existingGame.reporter_id === userId) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You already reported this game. Waiting for your opponent.',
          statusCode: 409,
        });
      }

      if (winnerIdField === existingGame.reported_winner_id) {
        // Agreement → finalize immediately
        await finalizeGameResult(fastify, gameId);
        return reply.code(200).send({ confirmed: true, winnerId: winnerIdField });
      }

      // Disagreement → DISPUTED
      await fastify.prisma.matchGame.update({
        where: { id: gameId },
        data: { status: 'DISPUTED' },
      });

      fastify.log.warn({ matchId, gameId }, 'Game result disputed — host must resolve');

      // Open Play has no tournament host — notify mods/admins so on-site disputes
      // don't go unnoticed (replaces the removed Discord dispute button).
      if (!match.tournament_id) {
        const reporter = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { discord_id: true },
        });
        if (reporter?.discord_id) {
          setImmediate(() => void notifyOpenPlayDispute(matchId, reporter.discord_id!));
        }
      }

      if (fastify.io) {
        fastify.io.to(`match_decision_${matchId}`).emit('match.game.updated', {
          matchId,
          gameNumber,
          status: 'DISPUTED',
          winnerId: null,
          lobbyCode: null,
          reportedWinnerId: existingGame.reported_winner_id,
          reportedAt: existingGame.reported_at?.toISOString() ?? null,
          confirmedAt: null,
        });
      }

      return reply.code(200).send({ disputed: true, message: 'Host will resolve the dispute' });
    },
  );
};

// ---------------------------------------------------------------------------
// POST /api/matches/:matchId/replay
// Open Play only: winner uploads a replay to activate leaderboard counting.
// Match must be COMPLETED (resolved via Discord or website), counts_for_leaderboard
// is currently false — this sets it to true.
// ---------------------------------------------------------------------------

const openPlayReplayRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/replay',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { matchId } = request.params;
      const userId = request.user.sub;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
        select: { id: true, status: true, winner_id: true, player1_id: true, player2_id: true },
      });

      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }
      if (match.status !== 'COMPLETED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not completed', statusCode: 422 });
      }
      const isStaff = await canManageTournament(fastify.prisma, '', userId, request.user.role);
      if (match.winner_id !== userId && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the winner or staff can upload a replay', statusCode: 403 });
      }

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'BadRequest', message: 'No file uploaded', statusCode: 400 });
      }

      const buffer = await data.toBuffer();
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Replay file is empty', statusCode: 400 });
      }

      const ext = data.filename?.split('.').pop() ?? 'rec';
      const filename = `${randomUUID()}.${ext}`;
      const matchDir = join(REPLAY_DIR, matchId);
      await mkdir(matchDir, { recursive: true });
      await writeFile(join(matchDir, filename), buffer);

      const replayUrl = `/uploads/replays/${matchId}/${filename}`;

      await fastify.prisma.matchGame.updateMany({
        where: { match_id: matchId },
        data: { replay_url: replayUrl, counts_for_leaderboard: true },
      });

      // Invalidate leaderboard caches so the win appears immediately
      if (fastify.redis) {
        await Promise.all([
          (await import('../lib/cache.js')).invalidate(fastify.redis, 'leaderboard:*'),
          (await import('../lib/cache.js')).invalidate(fastify.redis, 'rating-model:*'),
        ]);
      }

      return reply.code(200).send({ replayUrl });
    },
  );
};

export { openPlayReplayRoutes };
export default matchGamesRoutes;
