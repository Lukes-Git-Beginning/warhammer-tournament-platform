import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';
import { ensureOneVThreeDecision } from '../lib/one-v-three.js';

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

type MatrixRecord = {
  p1_locked_at: Date | null; p2_locked_at: Date | null; first_locked_at: Date | null;
  revealed_at: Date | null; p1_factions: string[]; p2_factions: string[]; bans: unknown;
  picked_cell: string | null; last_action_at: Date | null; decided_at: Date | null;
  top_player_id: string; bottom_player_id: string;
};

/** Broadcast a faction-matrix record to the match decision room (shared by the
 * 3×3 matrix and the Free Pick mini-pick, which reuse the same record). */
function emitMatrixUpdate(fastify: FastifyInstance, matchId: string, m: MatrixRecord): void {
  if (!fastify.io) return;
  const pickedRow = m.picked_cell ? Number(m.picked_cell.split(',')[0]) : null;
  const pickedCol = m.picked_cell ? Number(m.picked_cell.split(',')[1]) : null;
  fastify.io.to(matchDecisionRoom(matchId)).emit('match.matrix.update', {
    matchId,
    p1Locked: Boolean(m.p1_locked_at),
    p2Locked: Boolean(m.p2_locked_at),
    firstLockedAt: m.first_locked_at?.toISOString() ?? null,
    revealedAt: m.revealed_at?.toISOString() ?? null,
    p1Factions: m.revealed_at ? m.p1_factions : [],
    p2Factions: m.revealed_at ? m.p2_factions : [],
    bans: (m.bans as string[]) ?? [],
    pickedCell: m.picked_cell,
    lastActionAt: m.last_action_at?.toISOString() ?? null,
    decidedAt: m.decided_at?.toISOString() ?? null,
    p1FactionId: m.decided_at && pickedRow !== null ? (m.p1_factions[pickedRow] ?? null) : null,
    p2FactionId: m.decided_at && pickedCol !== null ? (m.p2_factions[pickedCol] ?? null) : null,
    topPlayerId: m.top_player_id,
    bottomPlayerId: m.bottom_player_id,
  });
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
            },
          },
          games: {
            // No map-first precondition: the faction step can run before the map
            // (Free Pick is faction-first). The step order is enforced by the
            // frontend per mode; the faction pick never depends on the map.
            where: {
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
      if (match.tournament?.mode !== 'MATRIX' && match.tournament?.mode !== 'FREE_PICK') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in a faction-matrix mode', statusCode: 422 });
      }

      // Validate faction picks against the tournament allowlist. Note: restricted_factions
      // are NOT banned — they remain playable but don't count for the leaderboard (enforced
      // at game finalization in match-games.ts). Only a non-empty allowlist is a hard ban.
      const allowlist = (match.tournament?.faction_allowlist ?? []).map((f) => f.faction_id);
      for (const factionId of factions) {
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
  // POST /api/matches/:id/free-pick/offer
  // Free Pick mixed matchup (one fixed faction, one pick-later): the pick-later
  // player submits 3 factions for the fixed opponent to choose from. Stored in the
  // faction_matrix record — fixed side = [their faction] — so the game finalization
  // resolves it via picked_cell exactly like the 3×3 matrix.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/free-pick/offer',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;
      const body = LockBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'BadRequest', message: body.error.issues[0]?.message ?? 'Invalid body', statusCode: 400 });
      }
      const { factions } = body.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true, player1_id: true, player2_id: true, tournament_id: true,
          tournament: { select: { mode: true, faction_allowlist: { select: { faction_id: true } } } },
          games: {
            where: { OR: [{ faction_matrix: null }, { faction_matrix: { decided_at: null } }] },
            orderBy: { game_number: 'asc' }, select: { id: true, faction_matrix: true }, take: 1,
          },
        },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.tournament?.mode !== 'FREE_PICK') return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in Free Pick mode', statusCode: 422 });
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (actorId !== match.player1_id && actorId !== match.player2_id && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }
      const game = match.games[0];
      if (!game) return reply.code(404).send({ error: 'NotFound', message: 'No active game awaiting factions', statusCode: 404 });

      const parts = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: match.tournament_id ?? '', user_id: { in: [match.player1_id, match.player2_id].filter((x): x is string => x != null) } },
        select: { user_id: true, faction_id: true },
      });
      const p1Fixed = parts.find((p) => p.user_id === match.player1_id)?.faction_id ?? null;
      const p2Fixed = parts.find((p) => p.user_id === match.player2_id)?.faction_id ?? null;
      const isMixed = (p1Fixed == null) !== (p2Fixed == null);
      if (!isMixed) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Offering only applies to a fixed vs pick-later match', statusCode: 422 });
      const fixedIsP1 = p1Fixed != null;
      const pickLaterPlayerId = fixedIsP1 ? match.player2_id : match.player1_id;
      const fixedFaction = (fixedIsP1 ? p1Fixed : p2Fixed) as string;
      if (actorId !== pickLaterPlayerId && !isStaff) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only the pick-later player offers factions', statusCode: 422 });
      }

      const allowlist = (match.tournament?.faction_allowlist ?? []).map((f) => f.faction_id);
      for (const f of factions) {
        if (allowlist.length > 0 && !allowlist.includes(f)) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${f}" is not permitted in this tournament`, statusCode: 400 });
        }
      }

      const now = new Date();
      const sides = fixedIsP1
        ? { p1_factions: [fixedFaction], p2_factions: factions }
        : { p1_factions: factions, p2_factions: [fixedFaction] };
      const updated = game.faction_matrix
        ? await fastify.prisma.matchFactionMatrix.update({ where: { game_id: game.id }, data: { ...sides, p1_locked_at: now, p2_locked_at: now, revealed_at: now, last_action_at: now } })
        : await fastify.prisma.matchFactionMatrix.create({ data: { game_id: game.id, ...sides, p1_locked_at: now, p2_locked_at: now, first_locked_at: now, revealed_at: now, last_action_at: now } });

      emitMatrixUpdate(fastify, matchId, updated);
      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/free-pick/select
  // The fixed-faction player chooses one of the opponent's 3 offered factions.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/free-pick/select',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;
      const body = z.object({ factionId: z.string().min(1) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'BadRequest', message: 'Invalid body', statusCode: 400 });
      const { factionId } = body.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true, player1_id: true, player2_id: true, tournament_id: true,
          tournament: { select: { mode: true } },
          games: {
            where: { faction_matrix: { decided_at: null } },
            orderBy: { game_number: 'asc' }, select: { id: true, faction_matrix: true }, take: 1,
          },
        },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.tournament?.mode !== 'FREE_PICK') return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in Free Pick mode', statusCode: 422 });
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (actorId !== match.player1_id && actorId !== match.player2_id && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }
      const game = match.games[0];
      const matrix = game?.faction_matrix;
      if (!game || !matrix || !matrix.revealed_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'No offered factions to choose from yet', statusCode: 404 });
      }

      const parts = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: match.tournament_id ?? '', user_id: { in: [match.player1_id, match.player2_id].filter((x): x is string => x != null) } },
        select: { user_id: true, faction_id: true },
      });
      const p1Fixed = parts.find((p) => p.user_id === match.player1_id)?.faction_id ?? null;
      const p2Fixed = parts.find((p) => p.user_id === match.player2_id)?.faction_id ?? null;
      const isMixed = (p1Fixed == null) !== (p2Fixed == null);
      if (!isMixed) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Choosing only applies to a fixed vs pick-later match', statusCode: 422 });
      const fixedIsP1 = p1Fixed != null;
      const fixedPlayerId = fixedIsP1 ? match.player1_id : match.player2_id;
      if (actorId !== fixedPlayerId && !isStaff) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only the fixed-faction player chooses', statusCode: 422 });
      }

      const offered = (fixedIsP1 ? matrix.p2_factions : matrix.p1_factions) as string[];
      const idx = offered.indexOf(factionId);
      if (idx < 0) return reply.code(400).send({ error: 'BadRequest', message: 'That faction is not among the three offered', statusCode: 400 });

      const now = new Date();
      const pickedCell = fixedIsP1 ? cellKey(0, idx) : cellKey(idx, 0);
      const updated = await fastify.prisma.matchFactionMatrix.update({
        where: { game_id: game.id },
        data: { picked_cell: pickedCell, decided_at: now, last_action_at: now },
      });
      // Write the resolved factions onto the game so they show on the tile /
      // bracket immediately: the fixed player keeps their registration faction,
      // the pick-later player plays the chosen one.
      await fastify.prisma.matchGame.update({
        where: { id: game.id },
        data: {
          player1_faction_id: fixedIsP1 ? p1Fixed : factionId,
          player2_faction_id: fixedIsP1 ? factionId : p2Fixed,
        },
      });
      emitMatrixUpdate(fastify, matchId, updated);
      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/one-v-three/offer
  // 1v3 mode: the Picker (coin-flip loser, bottom_player_id) offers 3 factions for
  // the Runner to choose from. The Runner plays the tournament's set faction; the
  // three must be distinct, allow-listed, and must NOT include the set faction
  // (no mirror). Reuses the faction_matrix record established by the coin flip.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/one-v-three/offer',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;
      const body = LockBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'BadRequest', message: body.error.issues[0]?.message ?? 'Invalid body', statusCode: 400 });
      }
      const { factions } = body.data;

      // Establish the coin-flip roles first (idempotent) so the record exists.
      await ensureOneVThreeDecision(fastify.prisma, matchId);

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true, player1_id: true, player2_id: true, tournament_id: true,
          tournament: { select: { mode: true, set_faction_id: true, faction_allowlist: { select: { faction_id: true } } } },
          games: {
            where: { faction_matrix: { decided_at: null } },
            orderBy: { game_number: 'desc' }, select: { id: true, faction_matrix: true }, take: 1,
          },
        },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.tournament?.mode !== 'ONE_V_THREE') return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in 1v3 mode', statusCode: 422 });
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (actorId !== match.player1_id && actorId !== match.player2_id && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }
      const game = match.games[0];
      const matrix = game?.faction_matrix;
      if (!game || !matrix) return reply.code(404).send({ error: 'NotFound', message: 'No active game awaiting factions', statusCode: 404 });
      const setFaction = match.tournament.set_faction_id;
      if (!setFaction) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'This tournament has no set faction configured', statusCode: 422 });

      const pickerId = matrix.bottom_player_id;
      if (actorId !== pickerId && !isStaff) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only the Picker offers factions', statusCode: 422 });
      }

      if (new Set(factions).size !== 3) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Offer 3 distinct factions', statusCode: 400 });
      }
      if (factions.includes(setFaction)) {
        return reply.code(400).send({ error: 'BadRequest', message: 'You cannot offer the set faction — no mirror match', statusCode: 400 });
      }
      const allowlist = (match.tournament?.faction_allowlist ?? []).map((f) => f.faction_id);
      for (const f of factions) {
        if (allowlist.length > 0 && !allowlist.includes(f)) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${f}" is not permitted in this tournament`, statusCode: 400 });
        }
      }

      const now = new Date();
      const runnerIsP1 = matrix.top_player_id === match.player1_id;
      // Runner's side keeps [set faction]; the Picker's side receives the 3 offered.
      const sides = runnerIsP1 ? { p2_factions: factions } : { p1_factions: factions };
      const updated = await fastify.prisma.matchFactionMatrix.update({
        where: { game_id: game.id },
        data: { ...sides, p1_locked_at: now, p2_locked_at: now, revealed_at: now, last_action_at: now },
      });

      emitMatrixUpdate(fastify, matchId, updated);
      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/one-v-three/select
  // 1v3 mode: the Runner (coin-flip winner, top_player_id) chooses which of the 3
  // offered factions the Picker will field.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/matches/:id/one-v-three/select',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const actorId = request.user.sub;
      const body = z.object({ factionId: z.string().min(1) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'BadRequest', message: 'Invalid body', statusCode: 400 });
      const { factionId } = body.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true, player1_id: true, player2_id: true, tournament_id: true,
          tournament: { select: { mode: true, set_faction_id: true } },
          games: {
            where: { faction_matrix: { decided_at: null } },
            orderBy: { game_number: 'desc' }, select: { id: true, faction_matrix: true }, take: 1,
          },
        },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.tournament?.mode !== 'ONE_V_THREE') return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in 1v3 mode', statusCode: 422 });
      const isStaff = ['HOST', 'MODERATOR', 'ADMIN'].includes(request.user.role);
      if (actorId !== match.player1_id && actorId !== match.player2_id && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You are not a participant of this match', statusCode: 403 });
      }
      const game = match.games[0];
      const matrix = game?.faction_matrix;
      if (!game || !matrix || !matrix.revealed_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'No offered factions to choose from yet', statusCode: 404 });
      }
      const setFaction = match.tournament.set_faction_id;
      if (!setFaction) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'This tournament has no set faction configured', statusCode: 422 });

      const runnerId = matrix.top_player_id;
      if (actorId !== runnerId && !isStaff) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only the Runner chooses', statusCode: 422 });
      }
      const runnerIsP1 = runnerId === match.player1_id;
      const offered = (runnerIsP1 ? matrix.p2_factions : matrix.p1_factions) as string[];
      const idx = offered.indexOf(factionId);
      if (idx < 0) return reply.code(400).send({ error: 'BadRequest', message: 'That faction is not among the three offered', statusCode: 400 });

      const now = new Date();
      // Runner's side holds [set faction] at index 0; the Picker's side holds the 3.
      const pickedCell = runnerIsP1 ? cellKey(0, idx) : cellKey(idx, 0);
      const updated = await fastify.prisma.matchFactionMatrix.update({
        where: { game_id: game.id },
        data: { picked_cell: pickedCell, decided_at: now, last_action_at: now },
      });
      // Write resolved factions onto the game: Runner = set faction, Picker = chosen.
      await fastify.prisma.matchGame.update({
        where: { id: game.id },
        data: {
          player1_faction_id: runnerIsP1 ? setFaction : factionId,
          player2_faction_id: runnerIsP1 ? factionId : setFaction,
        },
      });
      emitMatrixUpdate(fastify, matchId, updated);
      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/matches/:id/matrix/ban
  // Ban a cell (first 7 actions) or pick from remaining (8th action by the top player).
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
      if (match.tournament?.mode !== 'MATRIX' && match.tournament?.mode !== 'FREE_PICK') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match is not in a faction-matrix mode', statusCode: 422 });
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

      // Determine whose turn it is.
      // Balanced 1-2-2-2 ban order (bans.length → actor): Top (coin-toss winner) bans 1,
      // then Bottom 2 / Top 2 / Bottom 2 — Bottom makes the last ban. Top then PICKS the
      // final matchup, so one player never bans-last AND picks.
      const BAN_ACTOR_IS_TOP = [true, false, false, true, true, false, false] as const; // by bans.length 0..6
      let expectedActorId: string;
      if (isPick) {
        expectedActorId = topPlayer; // coin-toss winner picks from the remaining 2
      } else {
        expectedActorId = BAN_ACTOR_IS_TOP[bans.length] ? topPlayer : bottomPlayer;
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
