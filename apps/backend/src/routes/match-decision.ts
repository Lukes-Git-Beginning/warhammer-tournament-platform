import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@rizzotto/db';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';
import { ensureMatchGame } from '../lib/match-games.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const BanBodySchema = z.object({
  map_id: z.string().min(1),
});

const BlindPickLockBodySchema = z.object({
  faction_id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministically select a map from a pool given a seed string.
 * Uses a simple hash so the same seed always yields the same map.
 */
function deterministicMapPick(mapIds: string[], seed: string): string {
  // FNV-1a hash of the seed bytes → index into pool
  let hash = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep 32-bit
  }
  return mapIds[hash % mapIds.length] as string;
}

// ---------------------------------------------------------------------------
// Match-decision room helpers
// ---------------------------------------------------------------------------

function matchDecisionRoom(matchId: string): string {
  return `match_decision_${matchId}`;
}

// ---------------------------------------------------------------------------
// Shared serializer
// ---------------------------------------------------------------------------

type DecisionRow = {
  mode: string;
  top_player_id: string;
  bottom_player_id: string;
  coin_flip_seed: string;
  bans_top: unknown;
  bans_bottom: unknown;
  active_pool: unknown;
  picked_map_id: string | null;
  decided_at: Date | null;
};

type BlindPickRow = {
  player1_locked_at: Date | null;
  player2_locked_at: Date | null;
  revealed_at: Date | null;
  player1_faction_id: string | null;
  player2_faction_id: string | null;
} | null;

type MapDecisionModeLiteral = 'RANDOM' | 'PICK_BAN' | 'RANDOM_NO_REPEAT' | 'HOST_PRESET' | 'HOST_PRESET_PICK_BAN' | 'RANDOM_PICK_BAN';

function serializeDecisionState(
  matchId: string,
  decision: DecisionRow,
  blindPick: BlindPickRow,
  tournamentMode: string | null = null,
  matchPlayer1Id: string | null = null,
) {
  return {
    matchId,
    mode: decision.mode as MapDecisionModeLiteral,
    topPlayerId: decision.top_player_id,
    bottomPlayerId: decision.bottom_player_id,
    matchPlayer1Id,
    seed: decision.coin_flip_seed,
    bansTop: (decision.bans_top as string[]) ?? [],
    bansBottom: (decision.bans_bottom as string[]) ?? [],
    activePool: (decision.active_pool as string[]) ?? [],
    pickedMapId: decision.picked_map_id,
    decidedAt: decision.decided_at?.toISOString() ?? null,
    tournamentMode,
    blindPick: blindPick
      ? {
          player1Locked: Boolean(blindPick.player1_locked_at),
          player2Locked: Boolean(blindPick.player2_locked_at),
          revealedAt: blindPick.revealed_at?.toISOString() ?? null,
          firstLockedAt: (
            blindPick.player1_locked_at && blindPick.player2_locked_at
              ? (blindPick.player1_locked_at < blindPick.player2_locked_at ? blindPick.player1_locked_at : blindPick.player2_locked_at)
              : (blindPick.player1_locked_at ?? blindPick.player2_locked_at)
          )?.toISOString() ?? null,
          player1FactionId: blindPick.revealed_at ? (blindPick.player1_faction_id ?? null) : null,
          player2FactionId: blindPick.revealed_at ? (blindPick.player2_faction_id ?? null) : null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Map-decision helper functions
// ---------------------------------------------------------------------------

/** Gibt Map-IDs zurück, die in früheren Games desselben Matches bereits gespielt wurden. */
async function getPlayedMapsInMatch(
  prisma: PrismaClient,
  matchId: string,
  currentGameNumber: number,
): Promise<string[]> {
  const games = await prisma.matchGame.findMany({
    where: { match_id: matchId, game_number: { lt: currentGameNumber } },
    select: { map_decision: { select: { picked_map_id: true } } },
  });
  return games
    .map((g) => g.map_decision?.picked_map_id)
    .filter((id): id is string => id !== null && id !== undefined);
}

/**
 * Zieht `count` Maps aus `pool`; berücksichtigt No-Repeat im Match (`exclude`)
 * und turnierweit (`tournament.random_map_pool_played`).
 * Aktualisiert `random_map_pool_played` in einer Transaktion.
 */
async function drawMapsWithNoRepeat(
  prisma: PrismaClient,
  tournamentId: string,
  pool: string[],
  exclude: string[],
  count: number,
): Promise<string[]> {
  return await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { random_map_pool_played: true },
    });

    let played = t.random_map_pool_played;
    let available = pool.filter((id) => !played.includes(id) && !exclude.includes(id));

    // Zyklus zurücksetzen, wenn nicht genug Maps verfügbar sind
    if (available.length < count) {
      played = [];
      available = pool.filter((id) => !exclude.includes(id));
    }

    if (available.length < count) {
      throw new Error(`Not enough maps in pool (pool=${pool.length}, exclude=${exclude.length}, need=${count})`);
    }

    const drawn: string[] = [];
    const remaining = [...available];
    for (let i = 0; i < count; i++) {
      const idx = randomInt(remaining.length);
      drawn.push(remaining[idx] as string);
      remaining.splice(idx, 1);
    }

    await tx.tournament.update({
      where: { id: tournamentId },
      data: { random_map_pool_played: [...played, ...drawn] },
    });

    return drawn;
  });
}

/** Maps a match phase + bracket side to the canonical preset config key.
 * Named stages (SF, Final, 3rd place) use semantic keys.
 * DE matches use wb_round_N / lb_round_N with bracket-side-relative round numbers.
 * Swiss / SE early rounds fall back to swiss_N. */
function buildRoundKey(phase: string | null, bracketSide: string | null, round: number): string {
  switch (phase) {
    case 'PLAYOFF_SF': return 'playoff_sf';
    case 'PLAYOFF_FINAL': return 'playoff_final';
    case 'PLAYOFF_THIRD_PLACE': return 'playoff_third';
    default:
      if (bracketSide === 'WINNERS') return `wb_round_${round}`;
      if (bracketSide === 'LOSERS') return `lb_round_${round}`;
      if (bracketSide === 'GRAND_FINAL') return 'playoff_final';
      return `swiss_${round}`;
  }
}

/**
 * Liest den Preset-Eintrag für eine Runde aus map_preset_config.
 * Gibt ein Array von Maps zurück (HOST_PRESET: string[], HOST_PRESET_PICK_BAN: string[][]).
 */
function getPresetForRound(
  config: unknown,
  phase: string | null,
  bracketSide: string | null,
  round: number,
): unknown[] | null {
  if (!config || typeof config !== 'object') return null;
  const key = buildRoundKey(phase, bracketSide, round);
  const entry = (config as Record<string, unknown>)[key];
  if (!Array.isArray(entry)) return null;
  return entry;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const matchDecisionRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/matches/:id/decision
  // Returns the current decision state for a match (no auth required).
  // 404 if no decision flow has been started yet.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/matches/:id/decision',
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          tournament: { select: { mode: true } },
          games: {
            where: { map_decision: { isNot: null } },
            orderBy: { game_number: 'desc' },
            select: { map_decision: true, blind_pick: true },
            take: 1,
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

      const game = match.games[0];
      if (!game?.map_decision) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'No decision flow started for this match',
          statusCode: 404,
        });
      }

      return reply.code(200).send(
        serializeDecisionState(matchId, game.map_decision, game.blind_pick, match.tournament?.mode ?? 'BPT', match.player1_id),
      );
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/start
  // Initializes the match-decision flow: coin-flip, persist MatchMapDecision.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/start',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const rawGameNumber = (request.query as { gameNumber?: string }).gameNumber;
      const gameNumber = rawGameNumber ? Math.max(1, parseInt(rawGameNumber, 10)) : 1;

      // Load match with tournament info
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          round: true,
          phase: true,
          bracket_side: true,
          tournament: {
            select: {
              id: true,
              map_decision_mode: true,
              map_preset_config: true,
              map_pool: { select: { map_id: true } },
            },
          },
          games: {
            where: { game_number: gameNumber },
            select: { id: true, map_decision: { select: { game_id: true } } },
            take: 1,
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

      // Authorization — only the two match participants or staff may start a
      // decision flow (prevents a third party from triggering the coin flip /
      // map draw on someone else's match).
      const actorId = request.user.sub;
      const isParticipant = actorId === match.player1_id || actorId === match.player2_id;
      const isStaff =
        request.user.role === 'ORGANIZER' ||
        request.user.role === 'MODERATOR' ||
        request.user.role === 'ADMIN';
      if (!isParticipant && !isStaff) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not a participant of this match',
          statusCode: 403,
        });
      }

      // Validate status — decision can be started from PENDING or ONGOING
      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match status "${match.status}" does not allow starting a decision flow`,
          statusCode: 422,
        });
      }

      // Idempotency guard — decision already exists for this game
      if (match.games[0]?.map_decision) {
        return reply.code(409).send({
          error: 'Conflict',
          message: `Decision flow already started for game ${gameNumber}`,
          statusCode: 409,
        });
      }

      // Both players must be assigned
      if (!match.player1_id || !match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Match must have two players assigned before starting decision flow',
          statusCode: 422,
        });
      }

      let mapPool = (match.tournament?.map_pool ?? []).map((p) => p.map_id);
      const mode = (match.tournament?.map_decision_mode ?? 'RANDOM') as MapDecisionModeLiteral;

      // For Open Play matches (no tournament) fall back to the global map pool,
      // mirroring what createOpenPlayMatch does for game 1.
      if (!match.tournament && mapPool.length === 0) {
        const globalMaps = await fastify.prisma.map.findMany({
          where: { deleted_at: null },
          select: { id: true },
        });
        mapPool = globalMaps.map((m) => m.id);
      }

      // Preset-only modes don't require a tournament map pool
      const needsPool = mode === 'RANDOM' || mode === 'RANDOM_NO_REPEAT' || mode === 'RANDOM_PICK_BAN' || mode === 'PICK_BAN';
      if (needsPool && mapPool.length === 0) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament has no map pool configured',
          statusCode: 422,
        });
      }

      // Ensure a MatchGame row exists for the requested game number
      const gameId = match.games[0]?.id ?? await ensureMatchGame(fastify.prisma, matchId, gameNumber);

      // Coin flip: 0 = player1 is top, 1 = player2 is top
      const seed = randomBytes(16).toString('hex');
      const flip = randomInt(2);
      const topPlayerId = flip === 0 ? match.player1_id : match.player2_id;
      const bottomPlayerId = flip === 0 ? match.player2_id : match.player1_id;

      let pickedMapId: string | null = null;
      let activePool: string[] = [];

      // Normalize LB round to 1-indexed (LB rounds start at R_W+1 in the bracket generator).
      let presetRound = match.round;
      if (match.bracket_side === 'LOSERS' && match.tournament?.id) {
        const { _min } = await fastify.prisma.match.aggregate({
          where: { tournament_id: match.tournament.id, bracket_side: 'LOSERS', deleted_at: null },
          _min: { round: true },
        });
        presetRound = match.round - (_min.round ?? match.round) + 1;
      }

      switch (mode) {
        case 'RANDOM':
          pickedMapId = deterministicMapPick(mapPool, seed);
          break;

        case 'RANDOM_NO_REPEAT': {
          const playedInMatch = await getPlayedMapsInMatch(fastify.prisma, matchId, gameNumber);
          const drawn = await drawMapsWithNoRepeat(fastify.prisma, match.tournament?.id ?? '', mapPool, playedInMatch, 1);
          pickedMapId = drawn[0] ?? null;
          break;
        }

        case 'HOST_PRESET': {
          const preset = getPresetForRound(match.tournament?.map_preset_config ?? null, match.phase, match.bracket_side, presetRound);
          const mapForGame = preset?.[gameNumber - 1] as string | undefined;
          if (!mapForGame || typeof mapForGame !== 'string') {
            return reply.code(422).send({
              error: 'UnprocessableEntity',
              message: `No preset map configured for round ${presetRound}, game ${gameNumber}`,
              statusCode: 422,
            });
          }
          pickedMapId = mapForGame;
          break;
        }

        case 'HOST_PRESET_PICK_BAN': {
          const preset = getPresetForRound(match.tournament?.map_preset_config ?? null, match.phase, match.bracket_side, presetRound);
          const gameSets = preset as unknown[] | null;
          const setForGame = gameSets?.[gameNumber - 1];
          if (!Array.isArray(setForGame) || setForGame.length !== 3) {
            return reply.code(422).send({
              error: 'UnprocessableEntity',
              message: `No 3-map preset configured for round ${presetRound}, game ${gameNumber}`,
              statusCode: 422,
            });
          }
          activePool = setForGame as string[];
          break;
        }

        case 'RANDOM_PICK_BAN': {
          if (mapPool.length < 3) {
            return reply.code(422).send({
              error: 'UnprocessableEntity',
              message: 'Tournament map pool must have at least 3 maps for RANDOM_PICK_BAN mode',
              statusCode: 422,
            });
          }
          const playedInMatch = await getPlayedMapsInMatch(fastify.prisma, matchId, gameNumber);
          activePool = await drawMapsWithNoRepeat(fastify.prisma, match.tournament?.id ?? '', mapPool, playedInMatch, 3);
          break;
        }

        case 'PICK_BAN':
          // Legacy: Ban-Flow mit vollem Tournament-Pool, kein active_pool
          break;
      }

      const decision = await fastify.prisma.matchMapDecision.create({
        data: {
          game_id: gameId,
          mode,
          coin_flip_seed: seed,
          top_player_id: topPlayerId,
          bottom_player_id: bottomPlayerId,
          bans_top: [],
          bans_bottom: [],
          active_pool: activePool,
          picked_map_id: pickedMapId,
          decided_at: pickedMapId ? new Date() : null,
        },
      });

      const socketPayload = {
        matchId,
        mode,
        topPlayerId,
        bottomPlayerId,
        seed,
        pickedMapId: decision.picked_map_id,
        activePool: (decision.active_pool as string[]) ?? [],
      };

      // Emit to match-decision room (both players should join this room via Socket.IO)
      if (fastify.io) {
        fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.started', socketPayload);
      }

      // Also emit complete if resolved immediately (RANDOM, RANDOM_NO_REPEAT, HOST_PRESET)
      if (decision.picked_map_id && decision.decided_at) {
        if (fastify.io) {
          fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
            matchId,
            pickedMapId: decision.picked_map_id,
            decidedAt: decision.decided_at.toISOString(),
          });
        }
      }

      return reply.code(201).send(serializeDecisionState(matchId, decision, null));
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/ban
  // Handles alternating ban in PICK_BAN mode.
  // Ban order: Top bans first, then Bottom, then remaining map is picked.
  // With a pool of 3 maps and 2 bans (1 each), the last map is the picked one.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/ban',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const parsed = BanBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { map_id } = parsed.data;
      const userId = request.user.sub;

      // Load the current active game with its map decision and tournament pool
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          games: {
            where: { map_decision: { isNot: null }, status: { not: 'COMPLETED' } },
            orderBy: { game_number: 'desc' },
            select: { id: true, map_decision: true },
            take: 1,
          },
          tournament: {
            select: {
              map_pool: { select: { map_id: true } },
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

      const game = match.games[0];
      const decision = game?.map_decision ?? null;
      if (!decision) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Decision flow has not been started for this match',
          statusCode: 422,
        });
      }

      const banModes = new Set(['PICK_BAN', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']);
      if (!banModes.has(decision.mode)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Ban is only allowed in PICK_BAN, HOST_PRESET_PICK_BAN, or RANDOM_PICK_BAN mode',
          statusCode: 422,
        });
      }

      if (decision.picked_map_id) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Map has already been decided for this match',
          statusCode: 409,
        });
      }

      // Determine the active map set for this Ban round:
      // New modes (HOST_PRESET_PICK_BAN, RANDOM_PICK_BAN) use active_pool; legacy PICK_BAN uses tournament pool.
      const decisionActivePool = decision.active_pool as string[];
      const poolMapIds =
        decisionActivePool.length > 0
          ? decisionActivePool
          : (match.tournament?.map_pool ?? []).map((p) => p.map_id);

      // Validate map is in pool
      if (!poolMapIds.includes(map_id)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Map is not in the active map pool for this ban round',
          statusCode: 422,
        });
      }

      const bansTop = decision.bans_top as string[];
      const bansBottom = decision.bans_bottom as string[];
      const allBanned = [...bansTop, ...bansBottom];

      // Map already banned
      if (allBanned.includes(map_id)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Map has already been banned',
          statusCode: 422,
        });
      }

      // Top bans first, then bottom PICKS from the remaining two.
      const isTopTurn = bansTop.length === 0;
      const isBottomTurn = bansTop.length === 1 && bansBottom.length === 0;

      if (!isTopTurn && !isBottomTurn) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Ban/pick phase is already complete',
          statusCode: 422,
        });
      }

      const expectedPlayerId = isTopTurn ? decision.top_player_id : decision.bottom_player_id;
      if (userId !== expectedPlayerId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: isTopTurn ? 'It is not your turn to ban' : 'It is not your turn to pick',
          statusCode: 403,
        });
      }

      let newBansTop = bansTop;
      let newBansBottom = bansBottom;
      let pickedMapId: string | null = null;
      let decidedAt: Date | null = null;

      if (isTopTurn) {
        // P1 bans one map
        newBansTop = [...bansTop, map_id];
      } else {
        // P2 picks the map they want to play — must not be in bansTop
        if (bansTop.includes(map_id)) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'That map has already been banned',
            statusCode: 422,
          });
        }
        pickedMapId = map_id;
        decidedAt = new Date();
      }

      const updated = await fastify.prisma.matchMapDecision.update({
        where: { game_id: game!.id },
        data: {
          bans_top: newBansTop,
          bans_bottom: newBansBottom,
          picked_map_id: pickedMapId,
          decided_at: decidedAt,
        },
      });

      const updatePayload = {
        matchId,
        bansTop: newBansTop,
        bansBottom: newBansBottom,
        pickedMapId: updated.picked_map_id,
        decidedAt: updated.decided_at?.toISOString() ?? null,
      };

      if (fastify.io) {
        fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.update', updatePayload);
      }

      if (updated.picked_map_id && updated.decided_at) {
        if (fastify.io) {
          fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
            matchId,
            pickedMapId: updated.picked_map_id,
            decidedAt: updated.decided_at.toISOString(),
          });
        }
      }

      return reply.code(200).send(updatePayload);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/random
  // Idempotent confirmation for RANDOM mode — returns current decision state.
  // Called by the frontend after the coin-flip animation to confirm the picked map.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/random',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          games: {
            where: { map_decision: { isNot: null }, status: { not: 'COMPLETED' } },
            orderBy: { game_number: 'desc' },
            select: { map_decision: true, blind_pick: true },
            take: 1,
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

      // Authorization — only participants or staff may confirm the decision state.
      const actorId = request.user.sub;
      const isParticipant = actorId === match.player1_id || actorId === match.player2_id;
      const isStaff =
        request.user.role === 'ORGANIZER' ||
        request.user.role === 'MODERATOR' ||
        request.user.role === 'ADMIN';
      if (!isParticipant && !isStaff) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not a participant of this match',
          statusCode: 403,
        });
      }

      const game = match.games[0];
      if (!game?.map_decision) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Decision flow has not been started for this match. Call POST /decision/start first.',
          statusCode: 409,
        });
      }

      const randomModes = new Set(['RANDOM', 'RANDOM_NO_REPEAT', 'HOST_PRESET']);
      if (!randomModes.has(game.map_decision.mode)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'This endpoint is only available for RANDOM, RANDOM_NO_REPEAT, or HOST_PRESET mode matches',
          statusCode: 422,
        });
      }

      return reply.code(200).send(serializeDecisionState(matchId, game.map_decision, game.blind_pick));
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/blind-pick/lock
  // Player locks their faction choice. Reveal happens when both locked.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/blind-pick/lock',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const parsed = BlindPickLockBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { faction_id } = parsed.data;
      const userId = request.user.sub;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          games: {
            where: { map_decision: { isNot: null }, status: { not: 'COMPLETED' } },
            orderBy: { game_number: 'desc' },
            select: {
              id: true,
              map_decision: { select: { picked_map_id: true } },
              blind_pick: true,
            },
            take: 1,
          },
          tournament: { select: { mode: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Match not found',
          statusCode: 404,
        });
      }

      // Blind pick is allowed for BPT tournaments and for Open Play matches
      // (no tournament). Other tournament modes (SFT, etc.) do not use it.
      const mode = match.tournament?.mode as string | undefined;
      if (match.tournament !== null && mode !== 'BPT') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Blind pick is only available in BPT mode tournaments',
          statusCode: 422,
        });
      }

      const game = match.games[0];

      // Map decision must be resolved first
      if (!game?.map_decision?.picked_map_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Map decision must be completed before blind-pick phase',
          statusCode: 422,
        });
      }

      // Validate faction exists
      const faction = await fastify.prisma.faction.findUnique({
        where: { id: faction_id },
        select: { id: true },
      });
      if (!faction) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Faction "${faction_id}" does not exist`,
          statusCode: 422,
        });
      }

      // Determine if user is player1 or player2
      const isPlayer1 = userId === match.player1_id;
      const isPlayer2 = userId === match.player2_id;

      if (!isPlayer1 && !isPlayer2) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not a participant in this match',
          statusCode: 403,
        });
      }

      const now = new Date();
      const gameId = game.id;

      // Upsert MatchBlindPick
      let blindPick = game.blind_pick;

      if (!blindPick) {
        blindPick = await fastify.prisma.matchBlindPick.create({
          data: {
            game_id: gameId,
            player1_faction_id: isPlayer1 ? faction_id : null,
            player2_faction_id: isPlayer2 ? faction_id : null,
            player1_locked_at: isPlayer1 ? now : null,
            player2_locked_at: isPlayer2 ? now : null,
          },
        });
      } else {
        // Already exists — update the appropriate player's lock
        if (isPlayer1 && blindPick.player1_locked_at) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You have already locked your faction',
            statusCode: 409,
          });
        }
        if (isPlayer2 && blindPick.player2_locked_at) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You have already locked your faction',
            statusCode: 409,
          });
        }

        blindPick = await fastify.prisma.matchBlindPick.update({
          where: { game_id: gameId },
          data: {
            ...(isPlayer1 ? { player1_faction_id: faction_id, player1_locked_at: now } : {}),
            ...(isPlayer2 ? { player2_faction_id: faction_id, player2_locked_at: now } : {}),
          },
        });
      }

      const bothLocked = Boolean(blindPick.player1_locked_at && blindPick.player2_locked_at);

      if (bothLocked && !blindPick.revealed_at) {
        blindPick = await fastify.prisma.matchBlindPick.update({
          where: { game_id: gameId },
          data: { revealed_at: new Date() },
        });
      }

      const updatePayload = {
        matchId,
        player1Locked: Boolean(blindPick.player1_locked_at),
        player2Locked: Boolean(blindPick.player2_locked_at),
        revealedAt: blindPick.revealed_at?.toISOString() ?? null,
        // Only reveal faction IDs after both have locked
        player1FactionId: blindPick.revealed_at ? (blindPick.player1_faction_id ?? null) : null,
        player2FactionId: blindPick.revealed_at ? (blindPick.player2_faction_id ?? null) : null,
      };

      if (fastify.io) {
        fastify.io.to(matchDecisionRoom(matchId)).emit('match.blind-pick.update', updatePayload);
      }

      if (blindPick.revealed_at && game.map_decision?.picked_map_id) {
        if (fastify.io) {
          fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
            matchId,
            pickedMapId: game.map_decision.picked_map_id,
            decidedAt: blindPick.revealed_at.toISOString(),
          });
        }
      }

      return reply.code(200).send(updatePayload);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/force-resolve
  // Organizer / Moderator / Admin only: immediately resolve an in-progress
  // PICK_BAN decision by randomly selecting from the remaining (non-banned)
  // maps. Useful when a player goes AFK during the ban phase.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/force-resolve',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          games: {
            where: { map_decision: { isNot: null }, status: { not: 'COMPLETED' } },
            orderBy: { game_number: 'desc' },
            select: { id: true, map_decision: true },
            take: 1,
          },
          tournament: {
            select: {
              map_pool: { select: { map_id: true } },
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

      const game = match.games[0];
      const decision = game?.map_decision ?? null;

      if (!decision) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Decision flow has not been started for this match',
          statusCode: 422,
        });
      }

      if (decision.picked_map_id) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Map has already been decided for this match',
          statusCode: 409,
        });
      }

      const decisionActivePool = decision.active_pool as string[];
      const poolMapIds =
        decisionActivePool.length > 0
          ? decisionActivePool
          : (match.tournament?.map_pool ?? []).map((p) => p.map_id);
      const allBanned = [
        ...(decision.bans_top as string[]),
        ...(decision.bans_bottom as string[]),
      ];
      const remaining = poolMapIds.filter((id) => !allBanned.includes(id));

      if (remaining.length === 0) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'No maps remaining after bans — cannot force resolve',
          statusCode: 422,
        });
      }

      const pickedMapId = remaining[randomInt(remaining.length)]!;
      const decidedAt = new Date();

      const updated = await fastify.prisma.matchMapDecision.update({
        where: { game_id: game!.id },
        data: { picked_map_id: pickedMapId, decided_at: decidedAt },
      });

      if (fastify.io) {
        fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
          matchId,
          pickedMapId,
          decidedAt: decidedAt.toISOString(),
        });
      }

      return reply.code(200).send(serializeDecisionState(matchId, updated, null));
    },
  );
};

export default matchDecisionRoutes;
