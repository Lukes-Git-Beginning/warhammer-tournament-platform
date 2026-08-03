import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureMatchGame, finalizeGameResult } from '../lib/match-games.js';
import { Prisma } from '@rizzotto/db';
import { REPLAY_DIR, validateReplayUpload } from '../lib/replays.js';
import { verifyGameReplay } from '../lib/verify-report.js';
import type { ReplayIssue, ReplayVerification } from '../lib/replay-verify.js';
import { canManageTournament } from '../lib/tournament-utils.js';
import { notifyOpenPlayDispute, notifyReplayMismatchHeld } from '../lib/discord-notify.js';
import { recomputeFactionStats } from '../lib/recompute-faction-stats.js';
import { invalidate } from '../lib/cache.js';
import { emitBracketUpdate } from '../lib/emit.js';

const LobbyCodeBodySchema = z.object({
  lobby_code: z.string().max(64).nullable(),
});

const LobbyPasswordBodySchema = z.object({
  lobby_password: z.string().max(64).nullable(),
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
  lobby_password: string | null;
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
    lobbyPassword: includeSensitive ? game.lobby_password : null,
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
          // #2: earliest lock — starts the 2-minute auto-resolve countdown so the
          // game tile can show the faction-pick timer.
          firstLockedAt: (
            game.blind_pick.player1_locked_at && game.blind_pick.player2_locked_at
              ? (game.blind_pick.player1_locked_at < game.blind_pick.player2_locked_at
                  ? game.blind_pick.player1_locked_at
                  : game.blind_pick.player2_locked_at)
              : (game.blind_pick.player1_locked_at ?? game.blind_pick.player2_locked_at)
          )?.toISOString() ?? null,
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
  lobby_password: true,
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
// Replay-verification settle: given a verification outcome, either finalize the game (clean),
// hold it DISPUTED with the reporter's explanation (path B — result pending host/admin, but an
// Open Play match freed since DISPUTED is not queue-blocking), or hold it for the reporter to
// correct/explain (mismatch, no explanation yet).
// ---------------------------------------------------------------------------
type SettleResult =
  | { kind: 'confirmed'; winnerId: string }
  | { kind: 'mismatch'; issues: ReplayIssue[] }
  | { kind: 'disputed'; issues: ReplayIssue[] };

async function settleVerifiedReport(
  fastify: Parameters<FastifyPluginAsync>[0],
  args: {
    gameId: string;
    matchId: string;
    gameNumber: number;
    tournamentId: string | null;
    reporterId: string;
    opponentId: string | null;
    winnerId: string;
    verification: ReplayVerification;
    explanation: string;
  },
): Promise<SettleResult> {
  const { gameId, matchId, gameNumber, tournamentId, reporterId, opponentId, winnerId, verification, explanation } = args;

  if (verification.ok) {
    await fastify.prisma.matchGame.update({ where: { id: gameId }, data: { verification: Prisma.DbNull } });
    await finalizeGameResult(fastify, gameId);
    return { kind: 'confirmed', winnerId };
  }

  if (explanation) {
    // Path B — hold the result for host/admin review (DISPUTED), keep the explanation + issues.
    await fastify.prisma.matchGame.update({
      where: { id: gameId },
      data: { status: 'DISPUTED', verification: { issues: verification.issues, explanation } as unknown as Prisma.InputJsonValue },
    });
    fastify.log.warn({ matchId, gameId }, 'Replay mismatch — held DISPUTED with explanation for review');
    if (!tournamentId) {
      const reporter = await fastify.prisma.user.findUnique({ where: { id: reporterId }, select: { discord_id: true } });
      if (reporter?.discord_id) setImmediate(() => void notifyOpenPlayDispute(matchId, reporter.discord_id!));
    }
    // Tell the opponent — they can confirm (do nothing) or dispute at the match page.
    if (opponentId) setImmediate(() => void notifyReplayMismatchHeld(matchId, opponentId, explanation));
    if (fastify.io) {
      fastify.io.to(`match_decision_${matchId}`).emit('match.game.updated', {
        matchId, gameNumber, status: 'DISPUTED', winnerId: null, lobbyCode: null,
        reportedWinnerId: winnerId, reportedAt: new Date().toISOString(), confirmedAt: null,
      });
    }
    return { kind: 'disputed', issues: verification.issues };
  }

  // Mismatch, no explanation yet — hold for the reporter to upload the right replay or explain.
  await fastify.prisma.matchGame.update({
    where: { id: gameId },
    data: { verification: { issues: verification.issues } as unknown as Prisma.InputJsonValue },
  });
  return { kind: 'mismatch', issues: verification.issues };
}

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
  // PATCH /api/matches/:id/games/:gameNumber
  // Staff correction of a recorded game's factions, map and/or winner (there is
  // no other way to fix a mis-recorded game in a multi-game match). Games are the
  // statistical unit, so any change rebuilds FactionStats/MatchupStats + busts
  // caches. Editing the WINNER is allowed only while it does NOT change the MATCH
  // winner (which would ripple into the bracket + standings) — an outcome-changing
  // correction is rejected with 409 and directed to the match-result editor, which
  // handles bracket advancement and leaderboard points correctly.
  // -------------------------------------------------------------------------
  const EditGameSchema = z.object({
    player1FactionId: z.string().nullable().optional(),
    player2FactionId: z.string().nullable().optional(),
    pickedMapId: z.string().nullable().optional(),
    winnerId: z.string().nullable().optional(),
    // "Official" flag (internally counts_for_leaderboard): drives every statistic, not just
    // the leaderboard. An explicit value here overrides the restricted-faction derivation.
    countsForLeaderboard: z.boolean().optional(),
  });

  fastify.patch(
    '/api/matches/:id/games/:gameNumber',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId, gameNumber: gameNumberRaw } = request.params as { id: string; gameNumber: string };
      const gameNumber = Number(gameNumberRaw);
      const parsed = EditGameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }
      const body = parsed.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          player1_id: true,
          player2_id: true,
          winner_id: true,
          tournament: {
            select: {
              counts_for_leaderboard: true,
              restricted_factions: { select: { faction_id: true } },
              faction_allowlist: { select: { faction_id: true } },
              map_pool: { select: { map_id: true } },
            },
          },
          games: {
            select: { id: true, game_number: true, winner_id: true, player1_faction_id: true, player2_faction_id: true, status: true },
          },
        },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only a tournament manager can edit games', statusCode: 403 });
      }

      const game = match.games.find((g) => g.game_number === gameNumber);
      if (!game) {
        return reply.code(404).send({ error: 'NotFound', message: 'Game not found', statusCode: 404 });
      }

      // Proposed values (undefined = leave unchanged).
      const newP1F = body.player1FactionId !== undefined ? body.player1FactionId : game.player1_faction_id;
      const newP2F = body.player2FactionId !== undefined ? body.player2FactionId : game.player2_faction_id;
      const newWinner = body.winnerId !== undefined ? body.winnerId : game.winner_id;

      if (newWinner !== null && newWinner !== match.player1_id && newWinner !== match.player2_id) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Winner must be one of the two players', statusCode: 422 });
      }

      // Factions must be in the allowlist (empty = all allowed) and must exist.
      const allowlist = new Set(match.tournament?.faction_allowlist.map((f) => f.faction_id) ?? []);
      for (const fid of [newP1F, newP2F]) {
        if (fid !== null && allowlist.size > 0 && !allowlist.has(fid)) {
          return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Faction is not allowed in this tournament', statusCode: 422 });
        }
      }
      for (const fid of [body.player1FactionId, body.player2FactionId]) {
        if (fid) {
          const exists = await fastify.prisma.faction.findUnique({ where: { id: fid }, select: { id: true } });
          if (!exists) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Unknown faction', statusCode: 422 });
        }
      }

      // Map must be in the tournament pool (empty pool = any map).
      if (body.pickedMapId) {
        const pool = new Set(match.tournament?.map_pool.map((m) => m.map_id) ?? []);
        if (pool.size > 0 && !pool.has(body.pickedMapId)) {
          return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Map is not in the tournament map pool', statusCode: 422 });
        }
      }

      // Guard: reject an edit that would flip the MATCH winner (bracket + standings).
      const wins = new Map<string, number>();
      for (const g of match.games) {
        const w = g.id === game.id ? newWinner : g.winner_id;
        if (w) wins.set(w, (wins.get(w) ?? 0) + 1);
      }
      let proposedMatchWinner: string | null = null;
      let top = 0;
      let tie = false;
      for (const [uid, c] of wins) {
        if (c > top) { top = c; proposedMatchWinner = uid; tie = false; }
        else if (c === top) tie = true;
      }
      if (tie) proposedMatchWinner = match.winner_id;
      if (match.winner_id !== null && proposedMatchWinner !== match.winner_id) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'This would change the match result. Use the match result editor, which updates the bracket and standings.',
          statusCode: 409,
        });
      }

      // Restricted faction → the game does not count for the leaderboard.
      const restricted = new Set(match.tournament?.restricted_factions.map((r) => r.faction_id) ?? []);
      const isRestricted =
        restricted.size > 0 && ((newP1F !== null && restricted.has(newP1F)) || (newP2F !== null && restricted.has(newP2F)));
      const gameCounts =
        body.countsForLeaderboard !== undefined
          ? body.countsForLeaderboard
          : (match.tournament?.counts_for_leaderboard ?? true) && !isRestricted;

      await fastify.prisma.matchGame.update({
        where: { id: game.id },
        data: {
          player1_faction_id: newP1F,
          player2_faction_id: newP2F,
          winner_id: newWinner,
          counts_for_leaderboard: gameCounts,
        },
      });
      if (body.pickedMapId !== undefined && match.player1_id && match.player2_id) {
        await fastify.prisma.matchMapDecision.upsert({
          where: { game_id: game.id },
          update: { picked_map_id: body.pickedMapId, decided_at: new Date() },
          create: {
            game_id: game.id,
            mode: 'HOST_PRESET',
            coin_flip_seed: 'staff-edit',
            top_player_id: match.player1_id,
            bottom_player_id: match.player2_id,
            picked_map_id: body.pickedMapId,
            decided_at: new Date(),
          },
        });
      }

      // Rebuild stats from the game rows (idempotent) + bust caches.
      const activeSeason = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      if (activeSeason) await recomputeFactionStats(fastify.prisma, activeSeason.id);
      if (fastify.redis) {
        await Promise.all([
          invalidate(fastify.redis, 'factions:*'),
          invalidate(fastify.redis, 'meta:*'),
          invalidate(fastify.redis, 'leaderboard:*'),
          invalidate(fastify.redis, 'rating-model:*'),
          invalidate(fastify.redis, 'h2h:*'),
        ]);
      }

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'MatchGame',
          entity_id: game.id,
          action: 'game_edited',
          actor_id: userId,
          new_value: {
            player1_faction_id: newP1F,
            player2_faction_id: newP2F,
            winner_id: newWinner,
            picked_map_id: body.pickedMapId ?? null,
          },
        },
      });
      if (fastify.io) {
        if (match.tournament_id) emitBracketUpdate(fastify.io, match.tournament_id);
        fastify.io.to(`match_decision_${matchId}`).emit('match.game.updated', {
          matchId,
          gameNumber,
          status: game.status,
          winnerId: newWinner,
          lobbyCode: null,
          reportedWinnerId: null,
          reportedAt: null,
          confirmedAt: null,
        });
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/matches/:id/games/:gameNumber
  // Staff hard-delete of a single recorded game (admin cleanup). Cascades its map
  // decision / blind pick / matrix, rebuilds stats and busts caches. The match's own
  // winner/bracket is left untouched — deleting a game only drops its game-level record.
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/matches/:id/games/:gameNumber',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId, gameNumber: gameNumberRaw } = request.params as { id: string; gameNumber: string };
      const gameNumber = Number(gameNumberRaw);

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: { id: true, tournament_id: true, games: { select: { id: true, game_number: true } } },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only a tournament manager can delete games', statusCode: 403 });
      }
      const game = match.games.find((g) => g.game_number === gameNumber);
      if (!game) {
        return reply.code(404).send({ error: 'NotFound', message: 'Game not found', statusCode: 404 });
      }

      await fastify.prisma.matchGame.delete({ where: { id: game.id } });

      const activeSeason = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      if (activeSeason) await recomputeFactionStats(fastify.prisma, activeSeason.id);
      if (fastify.redis) {
        await Promise.all([
          invalidate(fastify.redis, 'factions:*'),
          invalidate(fastify.redis, 'meta:*'),
          invalidate(fastify.redis, 'leaderboard:*'),
          invalidate(fastify.redis, 'rating-model:*'),
          invalidate(fastify.redis, 'h2h:*'),
        ]);
      }
      await fastify.prisma.auditLog.create({
        data: { entity_type: 'MatchGame', entity_id: game.id, action: 'game_deleted', actor_id: userId, new_value: { matchId, gameNumber } },
      });
      if (fastify.io && match.tournament_id) emitBracketUpdate(fastify.io, match.tournament_id);

      return reply.code(200).send({ ok: true });
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

  // PATCH /api/matches/:id/games/:gameNumber/lobby-password
  // Either player or host/admin can set the optional lobby password (paired with the code).
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/matches/:id/games/:gameNumber/lobby-password',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId, gameNumber: gameNumberStr } = request.params as { id: string; gameNumber: string };
      const gameNumber = parseInt(gameNumberStr, 10);

      const parsed = LobbyPasswordBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: { player1_id: true, player2_id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const userId = request.user.sub;
      const isParticipant = userId === match.player1_id || userId === match.player2_id;
      const isStaff = await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, request.user.role);
      if (!isParticipant && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not a participant or staff', statusCode: 403 });
      }

      const gameId = await ensureMatchGame(fastify.prisma, matchId, gameNumber);
      const updated = await fastify.prisma.matchGame.update({
        where: { id: gameId },
        data: { lobby_password: parsed.data.lobby_password },
        select: { lobby_code: true, lobby_password: true },
      });

      if (fastify.io) {
        fastify.io.to(`match_decision_${matchId}`).emit('match.game.updated', {
          matchId,
          gameNumber,
          status: 'PENDING',
          winnerId: null,
          lobbyCode: updated.lobby_code,
          lobbyPassword: updated.lobby_password,
          reportedWinnerId: null,
          reportedAt: null,
          confirmedAt: null,
        });
      }

      return reply.code(200).send({ ok: true, lobby_password: updated.lobby_password });
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

      // Optional explanation (path B of the replay-mismatch prompt): the reporter asserts the
      // report is correct despite the replay not matching, for host/admin review.
      const explanation = ((data?.fields['explanation'] as { value?: string } | undefined)?.value ?? '').trim();

      const gameId = await ensureMatchGame(fastify.prisma, matchId, gameNumber);
      const existingGame = await fastify.prisma.matchGame.findUnique({
        where: { id: gameId },
        select: {
          id: true,
          reported_at: true,
          reported_winner_id: true,
          reporter_id: true,
          status: true,
          verification: true,
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

        const replayError = validateReplayUpload(data?.filename, buffer);
        if (replayError) {
          return reply.code(400).send({ error: 'BadRequest', message: replayError, statusCode: 400 });
        }
        const filename = `${randomUUID()}.replay`;
        const matchDir = join(REPLAY_DIR, matchId);
        await mkdir(matchDir, { recursive: true });
        await writeFile(join(matchDir, filename), buffer);

        const replayUrl = `/uploads/replays/${matchId}/${filename}`;
        const now = new Date();

        // Store report metadata (replay, reporter) before verifying.
        await fastify.prisma.matchGame.update({
          where: { id: gameId },
          data: {
            reported_winner_id: winnerIdField,
            reporter_id: userId,
            reported_at: now,
            replay_url: replayUrl,
          },
        });

        // Verify the replay against the reported game (fail-open) then finalize / hold / dispute.
        const verification = await verifyGameReplay(fastify.prisma, gameId, buffer);
        const settled = await settleVerifiedReport(fastify, {
          gameId, matchId, gameNumber, tournamentId: match.tournament_id,
          reporterId: userId,
          opponentId: userId === match.player1_id ? match.player2_id : match.player1_id,
          winnerId: winnerIdField, verification, explanation,
        });
        if (settled.kind === 'confirmed') return reply.code(200).send({ confirmed: true, winnerId: winnerIdField });
        if (settled.kind === 'disputed') return reply.code(200).send({ held: true, disputed: true, issues: settled.issues });
        return reply.code(200).send({ mismatch: true, issues: settled.issues });
      }

      // -----------------------------------------------------------------------
      // Held replay-mismatch resubmission by the ORIGINAL reporter (before dual-submit).
      // A game held for a mismatch (verification issues stored, not yet DISPUTED/COMPLETED) lets
      // the reporter either upload the correct replay (re-verify) or explain the deviation.
      // -----------------------------------------------------------------------
      // (COMPLETED / DISPUTED already returned above, so status is neither here.)
      const heldV = existingGame.verification as { issues?: unknown[]; explanation?: string } | null;
      const isHeld = !!heldV?.issues && !heldV.explanation;
      if (isHeld && existingGame.reporter_id === userId) {
        if (buffer && buffer.length > 0) {
          const replayError = validateReplayUpload(data?.filename, buffer);
          if (replayError) return reply.code(400).send({ error: 'BadRequest', message: replayError, statusCode: 400 });
          const filename = `${randomUUID()}.replay`;
          const matchDir = join(REPLAY_DIR, matchId);
          await mkdir(matchDir, { recursive: true });
          await writeFile(join(matchDir, filename), buffer);
          await fastify.prisma.matchGame.update({
            where: { id: gameId },
            data: { reported_winner_id: winnerIdField, replay_url: `/uploads/replays/${matchId}/${filename}` },
          });
          const verification = await verifyGameReplay(fastify.prisma, gameId, buffer);
          const settled = await settleVerifiedReport(fastify, {
            gameId, matchId, gameNumber, tournamentId: match.tournament_id,
            reporterId: userId,
            opponentId: userId === match.player1_id ? match.player2_id : match.player1_id,
            winnerId: winnerIdField, verification, explanation,
          });
          if (settled.kind === 'confirmed') return reply.code(200).send({ confirmed: true, winnerId: winnerIdField });
          if (settled.kind === 'disputed') return reply.code(200).send({ held: true, disputed: true, issues: settled.issues });
          return reply.code(200).send({ mismatch: true, issues: settled.issues });
        }
        if (explanation) {
          const settled = await settleVerifiedReport(fastify, {
            gameId, matchId, gameNumber, tournamentId: match.tournament_id,
            reporterId: userId,
            opponentId: userId === match.player1_id ? match.player2_id : match.player1_id,
            winnerId: winnerIdField,
            verification: { ok: false, issues: (heldV.issues as ReplayIssue[]) ?? [] }, explanation,
          });
          return reply.code(200).send({ held: true, disputed: settled.kind === 'disputed', issues: settled.kind === 'mismatch' ? settled.issues : (heldV.issues as ReplayIssue[]) });
        }
        return reply.code(400).send({ error: 'BadRequest', message: 'Upload the correct replay, or explain the deviation.', statusCode: 400 });
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

      const replayError = validateReplayUpload(data.filename, buffer);
      if (replayError) {
        return reply.code(400).send({ error: 'BadRequest', message: replayError, statusCode: 400 });
      }
      const filename = `${randomUUID()}.replay`;
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
