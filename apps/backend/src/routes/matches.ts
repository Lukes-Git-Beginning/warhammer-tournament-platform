import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emitStatusChange, emitBracketUpdate } from '../lib/emit.js';
import { InvalidActionError } from '../lib/draft-service.js';
import { completeMatch } from '../lib/complete-match.js';
import { canManageTournament } from '../lib/tournament-utils.js';
import { notifyHostsOfMatchReport } from '../lib/discord-notify.js';
import { runBalancedPairingTick } from '../lib/balanced-liechtenstein-service.js';
import { computeSwissStandings, sortSwissStandings } from '../lib/swiss.js';
import {
  DEFAULT_BAND,
  formDivisionPools,
  targetPoolSizeFromFormat,
  type RankedPlayer,
} from '../lib/balanced-liechtenstein.js';
import { resolvePoolsFromPlan, bracketSeeds, type PlayoffPlan } from '../lib/bali-playoff-plan.js';
import { invalidate } from '../lib/cache.js';
import { recomputeFactionStats } from '../lib/recompute-faction-stats.js';

/**
 * Cascade a match's leaderboard eligibility onto its games and refresh global stats.
 * The game-level `counts_for_leaderboard` flag is authoritative for all statistics
 * (heatmaps, rating model, faction winrates), so voiding/cancelling a match must set
 * it on the games — not just the match row.
 */
async function cascadeGameEligibility(
  fastify: FastifyInstance,
  matchId: string,
  countsForLeaderboard: boolean,
): Promise<void> {
  await fastify.prisma.matchGame.updateMany({
    where: { match_id: matchId },
    data: { counts_for_leaderboard: countsForLeaderboard },
  });
  const activeSeason = await fastify.prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });
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
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ReportResultSchema = z.object({
  winnerId: z.string().uuid().nullable(),
  score: z.string().max(64).optional(),
  player1FactionId: z.string().min(1).optional(),
  player2FactionId: z.string().min(1).optional(),
  map_id: z.string().min(1).optional(),
});

const ReportIssueSchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const matchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/matches/:id/result — legacy host/player override endpoint
  fastify.post(
    '/api/matches/:id/result',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const parsed = ReportResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { winnerId, score, player1FactionId, player2FactionId, map_id } = parsed.data;

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          tournament: { select: { host_id: true, counts_for_leaderboard: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be updated`,
          statusCode: 422,
        });
      }

      const user = request.user;
      const isHost = match.tournament ? user.sub === match.tournament.host_id : false;
      const isModOrAdmin = user.role === 'MODERATOR' || user.role === 'ADMIN';
      const isPlayer1 = match.player1_id !== null && user.sub === match.player1_id;
      const isPlayer2 = match.player2_id !== null && user.sub === match.player2_id;

      if (!isHost && !isModOrAdmin && !isPlayer1 && !isPlayer2) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not authorized to report the result for this match',
          statusCode: 403,
        });
      }

      if (winnerId !== null && winnerId !== match.player1_id && winnerId !== match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'winnerId must be player1 or player2 of this match',
          statusCode: 422,
        });
      }

      await completeMatch(fastify, {
        matchId,
        winnerId,
        player1FactionId,
        player2FactionId,
        actorId: user.sub,
        score,
      });

      if (map_id && match.player1_id && match.player2_id) {
        // completeMatch already wrote game 1 (with factions) — just attach the map decision.
        const game = await fastify.prisma.matchGame.findUniqueOrThrow({
          where: { match_id_game_number: { match_id: matchId, game_number: 1 } },
          select: { id: true },
        });
        await fastify.prisma.matchMapDecision.upsert({
          where: { game_id: game.id },
          create: {
            game_id: game.id,
            mode: 'HOST_PRESET',
            coin_flip_seed: 'manual',
            top_player_id: match.player1_id,
            bottom_player_id: match.player2_id,
            bans_top: [],
            bans_bottom: [],
            active_pool: [],
            picked_map_id: map_id,
            decided_at: new Date(),
          },
          update: { picked_map_id: map_id },
        });
      }

      request.log.info({ matchId, winnerId }, 'Match result reported');
      return reply.code(200).send({ matchId, winnerId, score: score ?? null });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/matches/:id/start
  // Host / Moderator / Admin: set match PENDING→ONGOING, start draft if enabled.
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/matches/:id/start',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')],
    },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const user = request.user;

      // Load match with tournament + draft info
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        include: {
          tournament: {
            select: {
              id: true,
              host_id: true,
              status: true,
              draft_enabled: true,
              draft_preset_id: true,
            },
          },
          draft: {
            select: { id: true, status: true },
          },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      if (!match.tournament) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Cannot start an open play match via this endpoint',
          statusCode: 422,
        });
      }

      // HOST can only start matches in their own tournament (or be a co-host)
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', user.sub, user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not the host of this tournament',
          statusCode: 403,
        });
      }

      // Tournament must be ONGOING (bracket generated)
      if (match.tournament.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament not in ONGOING status',
          statusCode: 422,
        });
      }

      // Validate: draft_enabled with no preset
      if (match.tournament.draft_enabled && !match.tournament.draft_preset_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament has draft enabled but no preset configured',
          statusCode: 422,
        });
      }

      // Idempotency: if already ONGOING and draft exists, return existing
      if (match.status === 'ONGOING') {
        const draftId = match.draft?.id ?? null;
        return reply.code(200).send({
          match_id: matchId,
          status: 'ONGOING',
          draft_id: draftId,
        });
      }

      // Validate: match must be PENDING
      if (match.status !== 'PENDING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be started`,
          statusCode: 422,
        });
      }

      // Validate: both players must be assigned
      if (!match.player1_id || !match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Cannot start match without both players',
          statusCode: 422,
        });
      }

      // Update match status to ONGOING
      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'ONGOING' },
      });

      // Emit status change
      emitStatusChange(fastify.io, {
        tournamentId: match.tournament.id,
        status: 'ONGOING',
      });

      // Start draft if enabled
      let draftId: string | null = null;

      if (match.tournament.draft_enabled && match.tournament.draft_preset_id) {
        // Check idempotency: existing draft for this match?
        const existingDraft = await fastify.prisma.draft.findUnique({
          where: { match_id: matchId },
          select: { id: true },
        });

        if (existingDraft) {
          draftId = existingDraft.id;
        } else {
          try {
            const result = await fastify.draftService.startDraft({
              matchId,
              presetId: match.tournament.draft_preset_id,
              hostUserId: match.player1_id,
              guestUserId: match.player2_id,
              allFactionIds: [], // service caches faction IDs
            });
            draftId = result.draftId;
          } catch (err) {
            if (err instanceof InvalidActionError) {
              return reply.code(422).send({
                error: 'UnprocessableEntity',
                message: (err as Error).message,
                statusCode: 422,
              });
            }
            throw err;
          }
        }
      }

      request.log.info({ matchId, draftId }, 'Match started');

      return reply.code(200).send({
        match_id: matchId,
        status: 'ONGOING',
        draft_id: draftId,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/matches/:id
  // Optional auth — returns enriched match details including player/faction
  // relations, scoring fields, and timing. Raw ID fields are preserved for
  // backwards compatibility with existing callers.
  // -------------------------------------------------------------------------
  fastify.get('/api/matches/:id', async (request, reply) => {
    const { id: matchId } = request.params as { id: string };

    const match = await fastify.prisma.match.findFirst({
      where: { id: matchId, deleted_at: null },
      select: {
        id: true,
        round: true,
        match_number: true,
        player1_id: true,
        player2_id: true,
        winner_id: true,
        player1_faction_id: true,
        player2_faction_id: true,
        status: true,
        result: true,
        phase: true,
        bracket_side: true,
        scheduled_time: true,
        played_at: true,
        score: true,
        player1_points: true,
        player2_points: true,
        counts_for_leaderboard: true,
        tournament: { select: { id: true, slug: true } },
        player1: { select: { id: true, username: true, avatar_url: true } },
        player2: { select: { id: true, username: true, avatar_url: true } },
        winner: { select: { id: true, username: true, avatar_url: true } },
        player1_faction: { select: { id: true, name: true, icon_url: true } },
        player2_faction: { select: { id: true, name: true, icon_url: true } },
      },
    });

    if (!match) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
    }

    // Optional auth — compute whether the viewer may manage this match's
    // tournament (host, co-host, mod, admin), so the UI can scope management
    // controls to the owner instead of showing them to every HOST globally (B12).
    let can_manage = false;
    try {
      await request.jwtVerify();
      if (match.tournament?.id) {
        can_manage = await canManageTournament(fastify.prisma, match.tournament.id, request.user.sub, request.user.role);
      }
    } catch {
      // unauthenticated — fine, can_manage stays false
    }

    return reply.code(200).send({
      id: match.id,
      tournament_id: match.tournament?.id ?? null,
      tournament_slug: match.tournament?.slug ?? null,
      can_manage,
      round: match.round,
      match_number: match.match_number,
      status: match.status,
      result: match.result ?? null,
      phase: match.phase ?? null,
      bracket_side: match.bracket_side ?? null,
      scheduled_time: match.scheduled_time?.toISOString() ?? null,
      played_at: match.played_at?.toISOString() ?? null,
      score: match.score ?? null,
      player1_points: match.player1_points ?? null,
      player2_points: match.player2_points ?? null,
      counts_for_leaderboard: match.counts_for_leaderboard,
      // Raw ID fields — backwards compatible
      player1_id: match.player1_id,
      player2_id: match.player2_id,
      winner_id: match.winner_id,
      player1_faction_id: match.player1_faction_id,
      player2_faction_id: match.player2_faction_id,
      // Enriched relations
      player1: match.player1
        ? {
            id: match.player1.id,
            username: match.player1.username,
            avatar_url: match.player1.avatar_url ?? null,
          }
        : null,
      player2: match.player2
        ? {
            id: match.player2.id,
            username: match.player2.username,
            avatar_url: match.player2.avatar_url ?? null,
          }
        : null,
      winner: match.winner
        ? {
            id: match.winner.id,
            username: match.winner.username,
            avatar_url: match.winner.avatar_url ?? null,
          }
        : null,
      player1_faction: match.player1_faction
        ? {
            id: match.player1_faction.id,
            name: match.player1_faction.name,
            icon_url: match.player1_faction.icon_url ?? null,
          }
        : null,
      player2_faction: match.player2_faction
        ? {
            id: match.player2_faction.id,
            name: match.player2_faction.name,
            icon_url: match.player2_faction.icon_url ?? null,
          }
        : null,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/matches/:id/draft
  // Optional auth — lookup the current draft for a match (frontend convenience).
  // -------------------------------------------------------------------------
  fastify.get('/api/matches/:id/draft', async (request, reply) => {
    const { id: matchId } = request.params as { id: string };

    // Optional auth
    try {
      await request.jwtVerify();
    } catch {
      // anonymous — still allowed to look up draft metadata
    }

    // Check match exists
    const match = await fastify.prisma.match.findFirst({
      where: { id: matchId, deleted_at: null },
      select: { id: true },
    });

    if (!match) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Match "${matchId}" not found`,
        statusCode: 404,
      });
    }

    const draft = await fastify.prisma.draft.findUnique({
      where: { match_id: matchId },
      select: { id: true, status: true },
    });

    return reply.code(200).send({
      draft_id: draft?.id ?? null,
      status: draft?.status ?? null,
    });
  });
  // PATCH /api/matches/:id/void — admin/mod/host can exclude a match from the leaderboard
  fastify.patch(
    '/api/matches/:id/void',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ void: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { counts_for_leaderboard: !parsed.data.void },
      });
      // Cascade onto the games (the authoritative flag for all statistics) + refresh stats.
      await cascadeGameEligibility(fastify, matchId, !parsed.data.void);

      return reply.code(200).send({ matchId, void: parsed.data.void });
    },
  );

  // POST /api/matches/:id/restore — admin/mod/host: reset a FORFEIT match back to PENDING
  fastify.post(
    '/api/matches/:id/restore',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, status: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.status !== 'FORFEIT' && match.status !== 'CANCELLED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only FORFEIT or CANCELLED matches can be restored', statusCode: 422 });
      }
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      await fastify.prisma.match.update({
        where: { id: matchId },
        // Clear withdrawn_player_id too: a restored match is being replayed, so a lingering
        // "opponent withdrew" walkover marker must not survive (it otherwise blocks the picker
        // — e.g. after a withdrawn player was swapped out for a replacement).
        data: { status: 'PENDING', winner_id: null, result: null, score: null, player1_points: null, player2_points: null, played_at: null, withdrawn_player_id: null },
      });
      return reply.code(200).send({ matchId, status: 'PENDING' });
    },
  );

  // POST /api/matches/:id/cancel-match — admin/mod/host: cancel a match (excluded from standings)
  fastify.post(
    '/api/matches/:id/cancel-match',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', winner_id: null, result: null, score: null, player1_points: null, player2_points: null, played_at: null },
      });
      // A cancelled match's games count for nothing statistically.
      await cascadeGameEligibility(fastify, matchId, false);
      return reply.code(200).send({ matchId, status: 'CANCELLED' });
    },
  );

  // POST /api/matches/:id/full-reset — admin/mod/host: wipe a match node back to a clean,
  // unplayed placeholder. Unlike restore (which only clears the top-level result), this
  // DELETES the match's games + draft — with ALL their map / faction / lobby / pick data —
  // so nothing stale survives a reset (a swapped-in player never inherits the old map or
  // faction), clears the match's own result + factions + played time, and — crucially —
  // pulls any winner this match had already advanced back out of the NEXT bracket node
  // (→ TBD). The tournament-level (SFT-latched) faction on the participant is untouched.
  fastify.post(
    '/api/matches/:id/full-reset',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          winner_id: true,
          player2_id: true,
          tournament_id: true,
          next_match_id: true,
        },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      await fastify.prisma.$transaction(async (tx) => {
        // 1. Drop every per-game row (cascades map decisions + faction matrices) and the
        //    draft (cascades its picks) — no map/faction/lobby/pick choice survives.
        await tx.matchGame.deleteMany({ where: { match_id: matchId } });
        await tx.draft.deleteMany({ where: { match_id: matchId } });
        // 2. Cascade to the next bracket node: if this match had advanced a winner, pull
        //    them back out of that node's slot (→ TBD) so no stale finalist lingers.
        if (match.next_match_id && match.winner_id) {
          const nx = await tx.match.findUnique({
            where: { id: match.next_match_id },
            select: { id: true, player1_id: true, player2_id: true },
          });
          if (nx?.player1_id === match.winner_id) {
            await tx.match.update({ where: { id: nx.id }, data: { player1_id: null } });
          } else if (nx?.player2_id === match.winner_id) {
            await tx.match.update({ where: { id: nx.id }, data: { player2_id: null } });
          }
        }
        // 3. Reset the node itself. A structural bye (no opponent) stays a bye; a real
        //    pairing goes back to a clean PENDING.
        await tx.match.update({
          where: { id: matchId },
          data: {
            status: match.player2_id ? 'PENDING' : 'BYE',
            winner_id: match.player2_id ? null : match.winner_id,
            result: null,
            score: null,
            player1_points: null,
            player2_points: null,
            player1_faction_id: null,
            player2_faction_id: null,
            played_at: null,
            withdrawn_player_id: null,
          },
        });
      });

      // The deleted games no longer count anywhere → recompute derived stats + bust caches.
      await cascadeGameEligibility(fastify, matchId, false);
      emitBracketUpdate(fastify.io, match.tournament_id ?? '');
      return reply.code(200).send({ matchId, status: match.player2_id ? 'PENDING' : 'BYE' });
    },
  );

  // POST /api/matches/:id/backfill-next-seed — admin/mod/host: fill the OPEN slot of an
  // ENTRY-ROUND playoff node with the next group-standings seed that didn't qualify, instead
  // of walking the survivor over. "Open" = a null slot or one held by a WITHDREW player.
  // Guards: the match must be a PENDING playoff node whose slot is NOT fed by a previous
  // playoff match (a later round is filled by that round's winner, not a group seed). For
  // Balanced Liechtenstein the seed is drawn from the surviving player's own band (division).
  // Typical flow after a semis drop: Full Reset the walkover node first (→ PENDING, survivor
  // pulled back out of the final), then Backfill this slot.
  fastify.post(
    '/api/matches/:id/backfill-next-seed',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, phase: true, status: true, player1_id: true, player2_id: true, tournament_id: true },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      const role = request.user?.role ?? '';
      const userId = request.user?.sub ?? '';
      const tournamentId = match.tournament_id ?? '';
      if (!(await canManageTournament(fastify.prisma, tournamentId, userId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      if (!match.phase?.startsWith('PLAYOFF')) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Not a playoff match', statusCode: 422 });
      }
      if (match.status !== 'PENDING') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match must be PENDING — Full Reset it first if the survivor already advanced', statusCode: 422 });
      }

      // All non-deleted tournament matches — for entry-round detection, playoff membership, and standings.
      const allMatches = await fastify.prisma.match.findMany({
        where: { tournament_id: tournamentId, deleted_at: null },
        select: { id: true, phase: true, status: true, round: true, player1_id: true, player2_id: true, winner_id: true, next_match_id: true },
      });
      // Entry-round guard: a slot fed by a previous playoff match is filled by that winner, not a seed.
      if (allMatches.some((m) => m.next_match_id === matchId)) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'This slot is filled by a previous playoff winner, not a group seed', statusCode: 422 });
      }

      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] } },
        select: { user_id: true, status: true, skill_band: true },
      });
      const bandByUser = new Map(participants.map((p) => [p.user_id, p.skill_band ?? DEFAULT_BAND]));
      const withdrawnIds = new Set(participants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));

      // Identify the OPEN slot (null or held by a withdrawn player) and the SURVIVING player.
      const p1Open = match.player1_id === null || withdrawnIds.has(match.player1_id);
      const p2Open = match.player2_id === null || withdrawnIds.has(match.player2_id);
      let openSlot: 'player1_id' | 'player2_id';
      let survivorId: string | null;
      if (p1Open && !p2Open) { openSlot = 'player1_id'; survivorId = match.player2_id; }
      else if (p2Open && !p1Open) { openSlot = 'player2_id'; survivorId = match.player1_id; }
      else return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Need exactly one open (empty or withdrawn) slot and one valid surviving player', statusCode: 422 });
      if (!survivorId) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'No valid surviving player in the other slot', statusCode: 422 });

      // Players already anywhere in the playoffs are not eligible to be backfilled.
      const inPlayoffs = new Set<string>();
      for (const m of allMatches) {
        if (!m.phase?.startsWith('PLAYOFF')) continue;
        if (m.player1_id) inPlayoffs.add(m.player1_id);
        if (m.player2_id) inPlayoffs.add(m.player2_id);
      }

      // Group standings (non-playoff completed matches) = the seeding order.
      const groupCompleted = allMatches
        .filter((m) => !m.phase?.startsWith('PLAYOFF'))
        .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST')
        .map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id, status: m.status }));
      const participantIds = participants.map((p) => p.user_id);
      const ranked = sortSwissStandings(
        computeSwissStandings(participantIds, groupCompleted, withdrawnIds),
        groupCompleted,
        tournamentId,
      );

      const tournament = await fastify.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { format: true, rounds_count: true, playoff_format: true, playoff_plan: true },
      });
      const isBaLi = tournament?.format === 'BALANCED_LIECHTENSTEIN';

      // A live standings seat that is not already placed somewhere in the playoffs.
      const eligible = (userId: string, dropped: boolean) =>
        !dropped && !withdrawnIds.has(userId) && !inPlayoffs.has(userId);

      let seedUserId: string | undefined;
      if (isBaLi) {
        // Balanced Liechtenstein: draw the replacement from the SURVIVOR'S OWN DIVISION POOL. Once the
        // playoff plan is frozen, resolve that division from the plan (stable structure + neighbour-bench
        // borrow); before the freeze, fall back to a live formDivisionPools. Then walk the survivor's
        // pool in seed order (earners first) — the replacement must be live, unplaced, AND an earner
        // (a 0-point player counts for pool size but is never a bracket seat — see the plan freeze).
        const rankedPlayers: RankedPlayer[] = ranked.map((s, i) => ({
          userId: s.userId,
          band: bandByUser.get(s.userId) ?? DEFAULT_BAND,
          rank: i + 1,
          rawScore: s.score,
        }));
        const rounds = tournament?.rounds_count ?? 1;
        const frozenPlan = tournament?.playoff_plan as unknown as PlayoffPlan | null;
        const pools =
          frozenPlan && Array.isArray(frozenPlan.divisions) && frozenPlan.divisions.length > 0
            ? resolvePoolsFromPlan(frozenPlan, rankedPlayers, rounds)
            : formDivisionPools(rankedPlayers, rounds, targetPoolSizeFromFormat(tournament?.playoff_format)).map(
                (p) => ({ band: p.band, players: p.players, seeds: bracketSeeds(p.players) }),
              );
        const survivorPool = pools.find((p) => p.seeds.includes(survivorId));
        seedUserId = survivorPool?.seeds.find((uid) => {
          const st = ranked.find((s) => s.userId === uid);
          return st ? eligible(uid, st.dropped) && st.score > 0 : false;
        });
      } else {
        seedUserId = ranked.find((s) => eligible(s.userId, s.dropped))?.userId;
      }
      if (!seedUserId) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'No eligible next seed available to backfill', statusCode: 422 });
      }
      const seed = { userId: seedUserId };

      // Clear withdrawn_player_id: filling the open slot with a live replacement resolves the
      // withdrawal, so the "opponent withdrew" marker must not linger (it would keep blocking
      // the picker on the re-seeded match).
      await fastify.prisma.match.update({ where: { id: matchId }, data: { [openSlot]: seed.userId, withdrawn_player_id: null } });
      emitBracketUpdate(fastify.io, tournamentId);
      return reply.code(200).send({ matchId, filledSlot: openSlot, seedUserId: seed.userId });
    },
  );

  // POST /api/matches/:id/report — a match participant flags an issue with their
  // match (wrong result, wrong factions, …). DMs the host + co-hosts and writes an
  // audit log entry. Player-only: staff use the edit modal instead.
  fastify.post(
    '/api/matches/:id/report',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = ReportIssueSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: { id: true, player1_id: true, player2_id: true, tournament_id: true },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const userId = request.user.sub;
      const isParticipant = match.player1_id === userId || match.player2_id === userId;
      if (!isParticipant) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the match participants can report an issue', statusCode: 403 });
      }

      const { comment } = parsed.data;
      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Match',
          entity_id: matchId,
          action: 'match_issue_report',
          actor_id: userId,
          new_value: { comment, tournamentId: match.tournament_id },
        },
      });

      if (match.tournament_id) {
        const tournamentId = match.tournament_id;
        setImmediate(() => void notifyHostsOfMatchReport(tournamentId, matchId, userId, comment));
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // PATCH /api/matches/:id/fill-bye — assign a late joiner to a BYE slot, converting it to a real match
  fastify.patch(
    '/api/matches/:id/fill-bye',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId, deleted_at: null },
        select: { id: true, status: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const role = request.user?.role ?? '';
      const callerId = request.user?.sub ?? '';
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', callerId, role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }
      if (match.status !== 'BYE') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Only BYE matches can be filled', statusCode: 422 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findUnique({
        where: { tournament_id_user_id: { tournament_id: match.tournament_id!, user_id: parsed.data.userId } },
        select: { id: true },
      });
      if (!participant) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'User is not a participant in this tournament', statusCode: 422 });
      }

      await fastify.prisma.match.update({
        where: { id: matchId },
        data: { player2_id: parsed.data.userId, status: 'PENDING', winner_id: null },
      });

      if (fastify.io && match.tournament_id) {
        fastify.io.to(`bracket_${match.tournament_id}`).emit('bracket_update', { tournamentId: match.tournament_id! });
      }

      return reply.code(200).send({ matchId, status: 'PENDING' });
    },
  );
  // PATCH /api/matches/:id/swap-player — canManage: replace one player in a PENDING match
  fastify.patch(
    '/api/matches/:id/swap-player',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ oldPlayerId: z.string().uuid(), newPlayerId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, status: true, player1_id: true, player2_id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      if (match.status !== 'PENDING') return reply.code(409).send({ error: 'Conflict', message: 'Can only swap players in PENDING matches', statusCode: 409 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      const { oldPlayerId, newPlayerId } = parsed.data;
      let updateData: { player1_id?: string; player2_id?: string };
      if (match.player1_id === oldPlayerId) updateData = { player1_id: newPlayerId };
      else if (match.player2_id === oldPlayerId) updateData = { player2_id: newPlayerId };
      else return reply.code(400).send({ error: 'BadRequest', message: 'oldPlayerId is not in this match', statusCode: 400 });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.match.update({ where: { id: matchId }, data: updateData });
        await tx.matchMapDecision.updateMany({ where: { game: { match_id: matchId }, top_player_id: oldPlayerId }, data: { top_player_id: newPlayerId } });
        await tx.matchMapDecision.updateMany({ where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId }, data: { bottom_player_id: newPlayerId } });
        await tx.matchFactionMatrix.updateMany({ where: { game: { match_id: matchId }, top_player_id: oldPlayerId }, data: { top_player_id: newPlayerId } });
        await tx.matchFactionMatrix.updateMany({ where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId }, data: { bottom_player_id: newPlayerId } });
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // DELETE /api/matches/:id — canManage: soft-delete a match
  fastify.delete(
    '/api/matches/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      await fastify.prisma.match.update({ where: { id: matchId }, data: { deleted_at: new Date() } });
      return reply.code(200).send({ ok: true });
    },
  );

  // POST /api/matches/:id/forfeit — canManage: forfeit a PENDING match in favour of the opponent
  fastify.post(
    '/api/matches/:id/forfeit',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const parsed = z.object({ droppedPlayerId: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId required', statusCode: 400 });

      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, player1_id: true, player2_id: true, status: true, tournament: { select: { host_id: true } } },
      });
      if (!match || !match.tournament_id) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      const { droppedPlayerId } = parsed.data;
      const winnerId = match.player1_id === droppedPlayerId ? match.player2_id : match.player2_id === droppedPlayerId ? match.player1_id : null;
      if (!winnerId) return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId is not in this match', statusCode: 400 });

      // B1: a match forfeit (match-drop) is match-scoped — it must NOT withdraw the
      // player from the whole tournament. They keep playing future rounds; only this
      // match is awarded to the opponent. (Withdraw is a separate explicit action.)
      await fastify.prisma.$transaction([
        fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'FORFEIT', winner_id: winnerId } }),
        fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } }),
      ]);
      // A forfeit completes this match — for Balanced Liechtenstein that may be the final piece
      // that lets the next round / division playoffs generate. The tick no-ops for other formats.
      void runBalancedPairingTick(fastify, match.tournament_id);
      return reply.code(200).send({ ok: true, winnerId });
    },
  );

  // POST /api/matches/:id/void-dropped — survivor or canManage: resolve an open match
  // where withdrawn_player_id is set. The survivor chooses "not played → void it".
  //   BaLi → CANCELLED + re-pair (runBalancedPairingTick).
  //   Swiss / Auto Swiss / Liechtenstein → FORFEIT to the survivor (walkover +1).
  fastify.post(
    '/api/matches/:id/void-dropped',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };

      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          player1_id: true,
          player2_id: true,
          winner_id: true,
          status: true,
          phase: true,
          withdrawn_player_id: true,
          games: { select: { reported_winner_id: true, winner_id: true } },
          tournament: { select: { host_id: true, format: true } },
        },
      });
      if (!match || !match.tournament_id) {
        return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
      }

      const { role, sub: callerId } = request.user;
      const canManage = await canManageTournament(fastify.prisma, match.tournament_id, callerId, role);

      // The survivor is the player in the match who is NOT the withdrawn one.
      const withdrawnId = match.withdrawn_player_id;
      const isSurvivor =
        withdrawnId !== null &&
        (callerId === match.player1_id || callerId === match.player2_id) &&
        callerId !== withdrawnId;

      if (!isSurvivor && !canManage) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the surviving player or a tournament manager can void this match', statusCode: 403 });
      }

      // Guard: must have a withdrawn player set (or one participant is WITHDREW),
      // and no confirmed result yet.
      const hasResult = match.games.some((g) => g.reported_winner_id !== null || g.winner_id !== null);
      const hasWithdrawnFlag = withdrawnId !== null;

      // Also accept if a participant is WITHDREW even without the flag (fallback for
      // hosts who drop a player after the match exists without the flag being set).
      let droppedParticipant: string | null = withdrawnId;
      if (!hasWithdrawnFlag) {
        const p1Status = match.player1_id
          ? await fastify.prisma.tournamentParticipant.findFirst({
              where: { tournament_id: match.tournament_id, user_id: match.player1_id, deleted_at: null },
              select: { status: true },
            })
          : null;
        const p2Status = match.player2_id
          ? await fastify.prisma.tournamentParticipant.findFirst({
              where: { tournament_id: match.tournament_id, user_id: match.player2_id, deleted_at: null },
              select: { status: true },
            })
          : null;
        if (p1Status?.status === 'WITHDREW') droppedParticipant = match.player1_id;
        else if (p2Status?.status === 'WITHDREW') droppedParticipant = match.player2_id;
      }

      if (!droppedParticipant || hasResult) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Match cannot be voided: no withdrawn player or result already reported', statusCode: 422 });
      }

      const survivorId = match.player1_id === droppedParticipant ? match.player2_id : match.player1_id;
      const format = match.tournament?.format ?? '';

      const isPlayoffPhase =
        match.phase === 'PLAYOFF_QF' ||
        match.phase === 'PLAYOFF_SF' ||
        match.phase === 'PLAYOFF_FINAL' ||
        match.phase === 'PLAYOFF_THIRD_PLACE';

      if (isPlayoffPhase) {
        // Playoff bracket match: the bracket is fixed, so a drop is a walkover — the
        // survivor takes the win and ADVANCES. completeMatch runs the bracket progression
        // (a plain FORFEIT update would leave the next match unfilled). No re-pairing here
        // regardless of format (a BaLi playoff match must not fall into the re-pair branch).
        if (!survivorId) {
          return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot determine survivor for walkover', statusCode: 422 });
        }
        await fastify.prisma.match.update({ where: { id: matchId }, data: { withdrawn_player_id: droppedParticipant } });
        await fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } });
        await completeMatch(fastify, { matchId, winnerId: survivorId, actorId: callerId, walkover: true });
      } else if (format === 'BALANCED_LIECHTENSTEIN') {
        // BaLi group phase: CANCELLED → re-pair the survivor.
        await fastify.prisma.match.update({
          where: { id: matchId },
          data: { status: 'CANCELLED', winner_id: null, withdrawn_player_id: droppedParticipant },
        });
        void runBalancedPairingTick(fastify, match.tournament_id);
      } else {
        // Swiss / Auto Swiss / Liechtenstein: FORFEIT to the survivor (walkover).
        if (!survivorId) {
          return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot determine survivor for forfeit', statusCode: 422 });
        }
        await fastify.prisma.$transaction([
          fastify.prisma.match.update({
            where: { id: matchId },
            data: { status: 'FORFEIT', winner_id: survivorId, withdrawn_player_id: droppedParticipant },
          }),
          fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } }),
        ]);
      }

      emitBracketUpdate(fastify.io, match.tournament_id);
      return reply.code(200).send({ ok: true });
    },
  );

  // POST /api/matches/:id/no-contest — canManage: B10 technical-abort double-bye.
  // Both players receive a bye point (1.0, no BH, see computeSwissStandings); the
  // match is awarded to no one and its games are voided. NOT a withdraw.
  fastify.post(
    '/api/matches/:id/no-contest',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: matchId } = request.params as { id: string };
      const match = await fastify.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, tournament_id: true, tournament: { select: { host_id: true } } },
      });
      if (!match || !match.tournament_id) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });

      const { role, sub: userId } = request.user;
      if (!(await canManageTournament(fastify.prisma, match.tournament_id ?? '', userId, role))) return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });

      await fastify.prisma.$transaction([
        fastify.prisma.match.update({ where: { id: matchId }, data: { status: 'NO_CONTEST', winner_id: null } }),
        fastify.prisma.matchGame.deleteMany({ where: { match_id: matchId } }),
      ]);
      return reply.code(200).send({ ok: true });
    },
  );
};

export default matchRoutes;
