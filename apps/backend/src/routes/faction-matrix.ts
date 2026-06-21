import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const LockBodySchema = z.object({
  factions: z.array(z.string().min(1)).length(3),
});

const BanBodySchema = z.object({
  row: z.number().int().min(0).max(2),
  col: z.number().int().min(0).max(2),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchDecisionRoom(matchId: string): string {
  return `match_decision_${matchId}`;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const factionMatrixRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /api/matches/:id/matrix/lock
  // Lock 3 faction picks for the current game.  First call creates the matrix
  // row; second call (both locked) sets revealed_at and coin-flip order.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/matrix/lock',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;

      const body = LockBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: body.error.issues[0]?.message ?? 'Invalid body',
          statusCode: 400,
        });
      }
      const { factions } = body.data;

      // Load match + current active game (map decided, matrix not yet finalized)
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          tournament: {
            select: {
              mode: true,
              faction_allowlist: { select: { faction_id: true } },
              restricted_factions: { select: { faction_id: true } },
            },
          },
          games: {
            where: {
              map_decision: { picked_map_id: { not: null } },
              OR: [
                { faction_matrix: null },
                { faction_matrix: { decided_at: null } },
              ],
            },
            orderBy: { game_number: 'asc' },
            select: {
              id: true,
              faction_matrix: true,
            },
            take: 1,
          },
        },
      });

      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }
      if (match.tournament?.mode !== 'MATRIX') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in MATRIX mode', statusCode: 422 });
      }

      // Validate faction picks against tournament restrictions
      const allowlist = (match.tournament?.faction_allowlist ?? []).map((f) => f.faction_id);
      const restricted = (match.tournament?.restricted_factions ?? []).map((f) => f.faction_id);
      for (const factionId of factions) {
        if (restricted.includes(factionId)) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${factionId}" is banned in this tournament`, statusCode: 400 });
        }
        if (allowlist.length > 0 && !allowlist.includes(factionId)) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${factionId}" is not permitted in this tournament`, statusCode: 400 });
        }
      }

      const isParticipant = actorId === match.player1_id || actorId === match.player2_id;
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (!isParticipant && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }

      const game = match.games[0];
      if (!game) {
        return reply.code(404).send({ error: 'NotFound', message: 'No active game awaiting faction selection', statusCode: 404 });
      }

      const isPlayer1 = actorId === match.player1_id;
      const now = new Date();
      const existingMatrix = game.faction_matrix;

      // Idempotency: if this side already locked, return 200 without re-writing
      if (existingMatrix) {
        const alreadyLocked = isPlayer1 ? existingMatrix.p1_locked_at : existingMatrix.p2_locked_at;
        if (alreadyLocked) {
          return reply.code(200).send({ ok: true });
        }
      }

      let updatedMatrix;

      if (!existingMatrix) {
        // First lock — create the row
        updatedMatrix = await fastify.prisma.matchFactionMatrix.create({
          data: {
            game_id: game.id,
            p1_factions: isPlayer1 ? factions : [],
            p2_factions: isPlayer1 ? [] : factions,
            p1_locked_at: isPlayer1 ? now : null,
            p2_locked_at: isPlayer1 ? null : now,
            first_locked_at: now,
          },
        });
      } else {
        // Second lock — fill the missing side and reveal
        const seed = randomBytes(16).toString('hex');
        const flip = randomInt(2);
        const topPlayerId = flip === 0 ? match.player1_id : match.player2_id;
        const bottomPlayerId = flip === 0 ? match.player2_id : match.player1_id;

        updatedMatrix = await fastify.prisma.matchFactionMatrix.update({
          where: { game_id: game.id },
          data: {
            p1_factions: isPlayer1 ? factions : existingMatrix.p1_factions,
            p2_factions: isPlayer1 ? existingMatrix.p2_factions : factions,
            p1_locked_at: isPlayer1 ? now : existingMatrix.p1_locked_at,
            p2_locked_at: isPlayer1 ? existingMatrix.p2_locked_at : now,
            coin_flip_seed: seed,
            top_player_id: topPlayerId ?? '',
            bottom_player_id: bottomPlayerId ?? '',
            revealed_at: now,
            last_action_at: now,
          },
        });
      }

      const room = matchDecisionRoom(matchId);
      if (fastify.io && updatedMatrix) {
        const pickedRow = updatedMatrix.picked_cell ? Number(updatedMatrix.picked_cell.split(',')[0]) : null;
        const pickedCol = updatedMatrix.picked_cell ? Number(updatedMatrix.picked_cell.split(',')[1]) : null;
        fastify.io.to(room).emit('match.matrix.update', {
          matchId,
          p1Locked: Boolean(updatedMatrix.p1_locked_at),
          p2Locked: Boolean(updatedMatrix.p2_locked_at),
          firstLockedAt: updatedMatrix.first_locked_at?.toISOString() ?? null,
          revealedAt: updatedMatrix.revealed_at?.toISOString() ?? null,
          p1Factions: updatedMatrix.revealed_at ? (updatedMatrix.p1_factions as string[]) : [],
          p2Factions: updatedMatrix.revealed_at ? (updatedMatrix.p2_factions as string[]) : [],
          bans: (updatedMatrix.bans as string[]) ?? [],
          pickedCell: updatedMatrix.picked_cell,
          lastActionAt: updatedMatrix.last_action_at?.toISOString() ?? null,
          decidedAt: updatedMatrix.decided_at?.toISOString() ?? null,
          p1FactionId: updatedMatrix.decided_at && pickedRow !== null ? ((updatedMatrix.p1_factions as string[])[pickedRow] ?? null) : null,
          p2FactionId: updatedMatrix.decided_at && pickedCol !== null ? ((updatedMatrix.p2_factions as string[])[pickedCol] ?? null) : null,
          topPlayerId: updatedMatrix.top_player_id,
          bottomPlayerId: updatedMatrix.bottom_player_id,
        });
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/matrix/ban
  // Ban a cell (first 7 actions) or pick from remaining (8th action by bottom player).
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/matrix/ban',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;

      const body = BanBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: body.error.issues[0]?.message ?? 'Invalid body',
          statusCode: 400,
        });
      }
      const { row, col } = body.data;
      const cell = cellKey(row, col);

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          player1_id: true,
          player2_id: true,
          tournament: { select: { mode: true } },
          games: {
            where: {
              faction_matrix: {
                revealed_at: { not: null },
                decided_at: null,
              },
            },
            orderBy: { game_number: 'asc' },
            select: {
              id: true,
              faction_matrix: true,
              map_decision: { select: { picked_map_id: true } },
            },
            take: 1,
          },
        },
      });

      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }
      if (match.tournament?.mode !== 'MATRIX') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in MATRIX mode', statusCode: 422 });
      }

      const isParticipant = actorId === match.player1_id || actorId === match.player2_id;
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (!isParticipant && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }

      const game = match.games[0];
      const matrix = game?.faction_matrix;
      if (!game || !matrix) {
        return reply.code(404).send({ error: 'NotFound', message: 'No active matrix awaiting ban/pick', statusCode: 404 });
      }

      const bans = (matrix.bans as string[]) ?? [];

      // Guard: cell already banned
      if (bans.includes(cell)) {
        return reply.code(409).send({ error: 'Conflict', message: 'Cell already banned', statusCode: 409 });
      }

      // Guard: row/col in valid range (0-2)
      if (row < 0 || row > 2 || col < 0 || col > 2) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Row and col must be 0-2', statusCode: 400 });
      }

      const topPlayer = matrix.top_player_id;
      const bottomPlayer = matrix.bottom_player_id;
      const isPick = bans.length === 7;

      // Determine whose turn it is
      let expectedActorId: string;
      if (isPick) {
        expectedActorId = bottomPlayer; // loser picks from remaining 2
      } else {
        expectedActorId = bans.length % 2 === 0 ? topPlayer : bottomPlayer;
      }

      if (!isStaff && actorId !== expectedActorId) {
        return reply.code(403).send({ error: 'Forbidden', message: 'It is not your turn', statusCode: 403 });
      }

      const now = new Date();
      let updatedMatrix;

      if (isPick) {
        // 8th action = pick: set picked_cell and finalize
        const p1Factions = matrix.p1_factions as string[];
        const p2Factions = matrix.p2_factions as string[];
        const p1FactionId = p1Factions[row] ?? null;
        const p2FactionId = p2Factions[col] ?? null;

        updatedMatrix = await fastify.prisma.$transaction(async (tx) => {
          const m = await tx.matchFactionMatrix.update({
            where: { game_id: game.id },
            data: {
              picked_cell: cell,
              decided_at: now,
              last_action_at: now,
            },
          });
          // Write resolved factions directly onto the game row so finalizeGameResult
          // can read them without parsing picked_cell again.
          await tx.matchGame.update({
            where: { id: game.id },
            data: {
              player1_faction_id: p1FactionId,
              player2_faction_id: p2FactionId,
            },
          });
          return m;
        });
      } else {
        // Ban action
        updatedMatrix = await fastify.prisma.matchFactionMatrix.update({
          where: { game_id: game.id },
          data: {
            bans: [...bans, cell],
            last_action_at: now,
          },
        });
      }

      const room = matchDecisionRoom(matchId);
      if (fastify.io && updatedMatrix) {
        const pickedRow = updatedMatrix.picked_cell ? Number(updatedMatrix.picked_cell.split(',')[0]) : null;
        const pickedCol = updatedMatrix.picked_cell ? Number(updatedMatrix.picked_cell.split(',')[1]) : null;
        fastify.io.to(room).emit('match.matrix.update', {
          matchId,
          p1Locked: Boolean(updatedMatrix.p1_locked_at),
          p2Locked: Boolean(updatedMatrix.p2_locked_at),
          firstLockedAt: updatedMatrix.first_locked_at?.toISOString() ?? null,
          revealedAt: updatedMatrix.revealed_at?.toISOString() ?? null,
          p1Factions: (updatedMatrix.p1_factions as string[]),
          p2Factions: (updatedMatrix.p2_factions as string[]),
          bans: (updatedMatrix.bans as string[]) ?? [],
          pickedCell: updatedMatrix.picked_cell,
          lastActionAt: updatedMatrix.last_action_at?.toISOString() ?? null,
          decidedAt: updatedMatrix.decided_at?.toISOString() ?? null,
          p1FactionId: updatedMatrix.decided_at && pickedRow !== null ? ((updatedMatrix.p1_factions as string[])[pickedRow] ?? null) : null,
          p2FactionId: updatedMatrix.decided_at && pickedCol !== null ? ((updatedMatrix.p2_factions as string[])[pickedCol] ?? null) : null,
          topPlayerId: updatedMatrix.top_player_id,
          bottomPlayerId: updatedMatrix.bottom_player_id,
        });

        // Emit decision.complete so MatchDecisionPage transitions to 'ready'
        if (updatedMatrix.decided_at && game.map_decision?.picked_map_id) {
          fastify.io.to(room).emit('match.decision.complete', {
            matchId,
            pickedMapId: game.map_decision.picked_map_id,
            decidedAt: updatedMatrix.decided_at.toISOString(),
          });
        }
      }

      return reply.code(200).send({ ok: true });
    },
  );

};

export default factionMatrixRoutes;
