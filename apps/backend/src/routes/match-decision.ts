import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';

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
// Route plugin
// ---------------------------------------------------------------------------

const matchDecisionRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /api/matches/:id/decision/start
  // Initializes the match-decision flow: coin-flip, persist MatchMapDecision.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/decision/start',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      // Load match with tournament info
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          tournament: {
            select: {
              id: true,
              map_decision_mode: true,
              map_pool: { select: { map_id: true } },
            },
          },
          map_decision: { select: { match_id: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Match not found',
          statusCode: 404,
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

      // Idempotency guard
      if (match.map_decision) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Decision flow already started for this match',
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

      const mapPool = match.tournament.map_pool.map((p) => p.map_id);
      if (mapPool.length === 0) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament has no map pool configured',
          statusCode: 422,
        });
      }

      // Coin flip: 0 = player1 is top, 1 = player2 is top
      const seed = randomBytes(16).toString('hex');
      const flip = randomInt(2);
      const topPlayerId = flip === 0 ? match.player1_id : match.player2_id;
      const bottomPlayerId = flip === 0 ? match.player2_id : match.player1_id;

      const mode = match.tournament.map_decision_mode as 'RANDOM' | 'PICK_BAN';

      // For RANDOM mode: pick map deterministically from seed
      const pickedMapId =
        mode === 'RANDOM' ? deterministicMapPick(mapPool, seed) : null;

      const decision = await fastify.prisma.matchMapDecision.create({
        data: {
          match_id: matchId,
          mode,
          coin_flip_seed: seed,
          top_player_id: topPlayerId,
          bottom_player_id: bottomPlayerId,
          bans_top: [],
          bans_bottom: [],
          picked_map_id: pickedMapId,
          decided_at: pickedMapId ? new Date() : null,
        },
      });

      const payload = {
        matchId,
        mode,
        topPlayerId,
        bottomPlayerId,
        seed,
        pickedMapId: decision.picked_map_id,
      };

      // Emit to match-decision room (both players should join this room via Socket.IO)
      if (fastify.io) {
        fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.started', payload);
      }

      // Also emit complete if RANDOM resolved immediately
      if (decision.picked_map_id && decision.decided_at) {
        if (fastify.io) {
          fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
            matchId,
            pickedMapId: decision.picked_map_id,
            decidedAt: decision.decided_at.toISOString(),
          });
        }
      }

      return reply.code(201).send(payload);
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

      // Load decision with tournament pool
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          map_decision: true,
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

      const decision = match.map_decision;
      if (!decision) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Decision flow has not been started for this match',
          statusCode: 422,
        });
      }

      if (decision.mode !== 'PICK_BAN') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Ban is only allowed in PICK_BAN mode',
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

      const poolMapIds = match.tournament.map_pool.map((p) => p.map_id);

      // Validate map is in pool
      if (!poolMapIds.includes(map_id)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Map is not in the tournament map pool',
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

      // Determine whose turn it is
      // Top bans first (bans_top empty), then bottom (bans_bottom empty)
      const isTopTurn = bansTop.length === 0;
      const isBottomTurn = bansTop.length === 1 && bansBottom.length === 0;

      if (!isTopTurn && !isBottomTurn) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Both players have already banned',
          statusCode: 422,
        });
      }

      const expectedPlayerId = isTopTurn ? decision.top_player_id : decision.bottom_player_id;
      if (userId !== expectedPlayerId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: "It is not your turn to ban",
          statusCode: 403,
        });
      }

      // Apply ban
      const newBansTop = isTopTurn ? [...bansTop, map_id] : bansTop;
      const newBansBottom = !isTopTurn ? [...bansBottom, map_id] : bansBottom;

      // After both bans, determine the remaining map
      const newAllBanned = [...newBansTop, ...newBansBottom];
      const remaining = poolMapIds.filter((id) => !newAllBanned.includes(id));

      let pickedMapId: string | null = null;
      let decidedAt: Date | null = null;

      if (newBansTop.length >= 1 && newBansBottom.length >= 1 && remaining.length === 1) {
        pickedMapId = remaining[0] ?? null;
        decidedAt = new Date();
      } else if (remaining.length === 0 && newBansTop.length >= 1 && newBansBottom.length >= 1) {
        // Edge case: pool size = 2, both banned → pick first from pool as tiebreak
        pickedMapId = poolMapIds[0] ?? null;
        decidedAt = new Date();
      }

      const updated = await fastify.prisma.matchMapDecision.update({
        where: { match_id: matchId },
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
          map_decision: { select: { picked_map_id: true } },
          blind_pick: true,
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

      // Validate tournament mode supports blind pick
      const mode = match.tournament.mode as string;
      if (mode !== 'BPT' && mode !== 'OPEN') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Blind pick is only available in BPT or OPEN mode tournaments',
          statusCode: 422,
        });
      }

      // Map decision must be resolved first
      if (!match.map_decision?.picked_map_id) {
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

      // Upsert MatchBlindPick
      let blindPick = match.blind_pick;

      if (!blindPick) {
        blindPick = await fastify.prisma.matchBlindPick.create({
          data: {
            match_id: matchId,
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
          where: { match_id: matchId },
          data: {
            ...(isPlayer1 ? { player1_faction_id: faction_id, player1_locked_at: now } : {}),
            ...(isPlayer2 ? { player2_faction_id: faction_id, player2_locked_at: now } : {}),
          },
        });
      }

      const bothLocked = Boolean(blindPick.player1_locked_at && blindPick.player2_locked_at);

      if (bothLocked && !blindPick.revealed_at) {
        blindPick = await fastify.prisma.matchBlindPick.update({
          where: { match_id: matchId },
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

      if (blindPick.revealed_at && match.map_decision?.picked_map_id) {
        if (fastify.io) {
          fastify.io.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
            matchId,
            pickedMapId: match.map_decision.picked_map_id,
            decidedAt: match.map_decision.picked_map_id ? blindPick.revealed_at.toISOString() : '',
          });
        }
      }

      return reply.code(200).send(updatePayload);
    },
  );
};

export default matchDecisionRoutes;
