import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitMatchResult, emitBracketUpdate, emitStatusChange } from '../lib/emit.js';
import { invalidate } from '../lib/cache.js';
import { InvalidActionError } from '../lib/draft-service.js';
import { decideProgressionSlot } from '../lib/bracket.js';
import { Prisma, type BracketSide } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ReportResultSchema = z.object({
  winnerId: z.string().uuid().nullable(),
  score: z.string().max(64).optional(),
  player1FactionId: z.string().min(1).optional(),
  player2FactionId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DE progression helpers (defined at module scope, receive tx as parameter)
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient;

interface AdvanceSrc {
  tournamentFormat: string;
  bracket_side: BracketSide | null;
  match_number: number;
}

async function advanceToSlot(
  tx: TxClient,
  targetId: string,
  playerId: string | null,
  src: AdvanceSrc,
  role: 'winner' | 'loser',
): Promise<void> {
  if (playerId === null) return;
  const t = await tx.match.findUnique({
    where: { id: targetId },
    select: { id: true, player1_id: true, player2_id: true, bracket_side: true },
  });
  if (!t) return;
  const slot = decideProgressionSlot({
    format: src.tournamentFormat,
    targetBracketSide: t.bracket_side,
    targetP1IsNull: t.player1_id === null,
    srcBracketSide: src.bracket_side,
    srcMatchNumber: src.match_number,
    role,
  });
  await tx.match.update({ where: { id: targetId }, data: { [slot]: playerId } });
}

async function checkAndPromoteBye(
  tx: TxClient,
  matchId: string,
): Promise<void> {
  const m = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      player1_id: true,
      player2_id: true,
      next_match_id: true,
      bracket_side: true,
      match_number: true,
      tournament_id: true,
    },
  });
  if (!m || m.status !== 'PENDING') return;
  // GF and Reset matches are never auto-BYE'd
  if (m.bracket_side === 'GRAND_FINAL') return;
  // Both slots filled → real match, no BYE
  if (m.player1_id !== null && m.player2_id !== null) return;
  const present = m.player1_id ?? m.player2_id;
  // Both empty → not yet decidable
  if (present === null) return;
  // Check if any non-terminal feeder match can still fill the empty slot
  const pendingFeeders = await tx.match.count({
    where: {
      tournament_id: m.tournament_id,
      deleted_at: null,
      status: { notIn: ['COMPLETED', 'BYE', 'FORFEIT'] },
      OR: [{ next_match_id: matchId }, { loser_next_match_id: matchId }],
    },
  });
  if (pendingFeeders > 0) return;
  // Promote to BYE
  await tx.match.update({ where: { id: matchId }, data: { status: 'BYE', winner_id: present } });
  if (m.next_match_id) {
    await advanceToSlot(
      tx,
      m.next_match_id,
      present,
      { tournamentFormat: 'DOUBLE_ELIMINATION', bracket_side: m.bracket_side, match_number: m.match_number },
      'winner',
    );
    await checkAndPromoteBye(tx, m.next_match_id);
  }
}

async function handleGrandFinalProgression(
  tx: TxClient,
  gf: { id: string; next_match_id: string | null; player1_id: string | null },
  winnerId: string | null,
  loserId: string | null,
): Promise<void> {
  // gf IS the Reset match (next_match_id=null) → already the final game
  if (gf.next_match_id === null) return;
  if (winnerId === gf.player1_id) {
    // WB champion wins GF → no Reset needed; mark Reset as FORFEIT
    await tx.match.update({
      where: { id: gf.next_match_id },
      data: {
        status: 'FORFEIT',
        player1_id: winnerId,
        player2_id: loserId,
        winner_id: winnerId,
      },
    });
  } else {
    // LB champion wins GF → Reset match must be played
    // WB champion (original player1 of GF) takes player1 slot; LB champion takes player2 slot
    await tx.match.update({
      where: { id: gf.next_match_id },
      data: { player1_id: gf.player1_id, player2_id: winnerId },
    });
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const matchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/matches/:id/result
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

      const { winnerId, score, player1FactionId, player2FactionId } = parsed.data;

      // Load match + tournament
      const match = await fastify.prisma.match.findFirst({
        where: { id: matchId, deleted_at: null },
        select: {
          id: true,
          tournament_id: true,
          status: true,
          player1_id: true,
          player2_id: true,
          next_match_id: true,
          loser_next_match_id: true,
          bracket_side: true,
          match_number: true,
          player1_faction_id: true,
          player2_faction_id: true,
          tournament: { select: { organizer_id: true, format: true } },
        },
      });

      if (!match) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Match "${matchId}" not found`,
          statusCode: 404,
        });
      }

      // Status check
      if (match.status !== 'PENDING' && match.status !== 'ONGOING') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Match is already ${match.status} and cannot be updated`,
          statusCode: 422,
        });
      }

      // Authorization check
      const user = request.user;
      const isOrganizer = user.sub === match.tournament.organizer_id;
      const isModOrAdmin = user.role === 'MODERATOR' || user.role === 'ADMIN';
      const isPlayer1 = match.player1_id !== null && user.sub === match.player1_id;
      const isPlayer2 = match.player2_id !== null && user.sub === match.player2_id;

      if (!isOrganizer && !isModOrAdmin && !isPlayer1 && !isPlayer2) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not authorized to report the result for this match',
          statusCode: 403,
        });
      }

      // Winner must be one of the two players (null = draw)
      if (winnerId !== null && winnerId !== match.player1_id && winnerId !== match.player2_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'winnerId must be player1 or player2 of this match',
          statusCode: 422,
        });
      }

      const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

      // Determine faction IDs to use (passed or from existing match data)
      const effectiveP1FactionId = player1FactionId ?? match.player1_faction_id ?? null;
      const effectiveP2FactionId = player2FactionId ?? match.player2_faction_id ?? null;

      // Winner/loser faction IDs for stats (null for draw)
      const winnerFactionId =
        winnerId === null
          ? null
          : winnerId === match.player1_id
            ? effectiveP1FactionId
            : effectiveP2FactionId;
      const loserFactionId =
        winnerId === null
          ? null
          : loserId === match.player1_id
            ? effectiveP1FactionId
            : effectiveP2FactionId;

      // Find active season (optional — FactionStats update only when season exists)
      const activeSeason = await fastify.prisma.season.findFirst({
        where: { is_active: true },
        select: { id: true },
      });

      // Execute transaction
      await fastify.prisma.$transaction(async (tx) => {
        // a) Update match
        await tx.match.update({
          where: { id: matchId },
          data: {
            winner_id: winnerId,
            score: score ?? null,
            status: 'COMPLETED',
            // Dynamic leaderboard: stamp the season + play time at completion.
            season_id: activeSeason?.id ?? null,
            played_at: new Date(),
            ...(player1FactionId ? { player1_faction_id: player1FactionId } : {}),
            ...(player2FactionId ? { player2_faction_id: player2FactionId } : {}),
          },
        });

        // b) Advance winner / drop loser to next match(es)
        const isDE = match.tournament.format === 'DOUBLE_ELIMINATION';
        const isGFSource = isDE && match.bracket_side === 'GRAND_FINAL';
        const src: AdvanceSrc = {
          tournamentFormat: match.tournament.format,
          bracket_side: match.bracket_side,
          match_number: match.match_number,
        };

        // Winner-advance — GF-source is handled exclusively by handleGrandFinalProgression
        // to avoid premature BYE promotion of the Reset match before both slots are filled.
        if (match.next_match_id && !isGFSource) {
          await advanceToSlot(tx, match.next_match_id, winnerId, src, 'winner');
          await checkAndPromoteBye(tx, match.next_match_id);
        }

        // Loser-drop (DE only, requires a decisive result)
        if (isDE && match.loser_next_match_id && winnerId !== null && loserId !== null) {
          await advanceToSlot(tx, match.loser_next_match_id, loserId, src, 'loser');
          await checkAndPromoteBye(tx, match.loser_next_match_id);
        }

        // Grand Final / Reset semantics
        if (isGFSource) {
          await handleGrandFinalProgression(tx, match, winnerId, loserId);
        }

        // c) FactionStats update (only when active season exists)
        if (activeSeason) {
          const seasonId = activeSeason.id;

          // Both factions: increment matches_played
          const factionIdsToUpdate = [winnerFactionId, loserFactionId].filter(
            (f): f is string => f !== null,
          );

          for (const factionId of factionIdsToUpdate) {
            const isWinner = factionId === winnerFactionId;
            await tx.factionStats.upsert({
              where: { faction_id_season_id: { faction_id: factionId, season_id: seasonId } },
              create: {
                faction_id: factionId,
                season_id: seasonId,
                matches_played: 1,
                wins: isWinner ? 1 : 0,
                losses: isWinner ? 0 : 1,
                draws: 0,
                pick_count: 1,
                ban_count: 0,
              },
              update: {
                matches_played: { increment: 1 },
                pick_count: { increment: 1 },
                ...(isWinner ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
              },
            });
          }
        }

        // e) MatchupStats update (alphabetical symmetry: faction_a_id < faction_b_id by string sort)
        if (activeSeason && effectiveP1FactionId && effectiveP2FactionId) {
          const sorted = [effectiveP1FactionId, effectiveP2FactionId].sort();
          const aId = sorted[0]!;
          const bId = sorted[1]!;
          const isDraw = winnerId === null;
          const winnerIsA = winnerFactionId === aId;

          await tx.matchupStats.upsert({
            where: {
              faction_a_id_faction_b_id_season_id: {
                faction_a_id: aId,
                faction_b_id: bId,
                season_id: activeSeason.id,
              },
            },
            create: {
              faction_a_id: aId,
              faction_b_id: bId,
              season_id: activeSeason.id,
              faction_a_wins: !isDraw && winnerIsA ? 1 : 0,
              faction_b_wins: !isDraw && !winnerIsA ? 1 : 0,
              draws: isDraw ? 1 : 0,
            },
            update: isDraw
              ? { draws: { increment: 1 } }
              : winnerIsA
                ? { faction_a_wins: { increment: 1 } }
                : { faction_b_wins: { increment: 1 } },
          });
        }

        // d) Audit log
        await tx.auditLog.create({
          data: {
            entity_type: 'Match',
            entity_id: matchId,
            action: 'match_result',
            actor_id: user.sub,
            new_value: {
              winnerId,
              loserId,
              score: score ?? null,
              player1FactionId: player1FactionId ?? null,
              player2FactionId: player2FactionId ?? null,
            },
          },
        });
      });

      // NOTE: The Welle-2 incremental MMR hook (season_points / FactionMastery /
      // FactionMatchupStat / AntiFarmCap) was removed here. The leaderboard is
      // now derived on read from confirmed match facts by the dynamic rating
      // model (lib/rating-model.ts, lib/leaderboard-service.ts). FactionStats +
      // MatchupStats above stay (they power faction analytics, not scoring).

      // Invalidate faction, meta, leaderboard, rating-model + h2h caches after commit
      if (fastify.redis) {
        await Promise.all([
          invalidate(fastify.redis, 'factions:*'),
          invalidate(fastify.redis, 'meta:*'),
          invalidate(fastify.redis, 'leaderboard:*'),
          invalidate(fastify.redis, 'rating-model:*'),
          invalidate(fastify.redis, 'h2h:*'),
        ]);
      }

      // Emit socket events after successful transaction
      emitMatchResult(fastify.io, {
        tournamentId: match.tournament_id,
        matchId,
        winnerId,
        score: score ?? null,
        nextMatchId: match.next_match_id ?? null,
      });

      emitBracketUpdate(fastify.io, match.tournament_id);

      request.log.info({ matchId, winnerId }, 'Match result reported');
      return reply.code(200).send({ matchId, winnerId, score: score ?? null });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/matches/:id/start
  // Organizer / Moderator / Admin: set match PENDING→ONGOING, start draft if enabled.
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/matches/:id/start',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN')],
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
              organizer_id: true,
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

      // ORGANIZER can only start matches in their own tournament
      const isModOrAdmin = user.role === 'MODERATOR' || user.role === 'ADMIN';
      const isOwnOrganizer = user.sub === match.tournament.organizer_id;

      if (!isModOrAdmin && !isOwnOrganizer) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not the organizer of this tournament',
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

    return reply.code(200).send({
      id: match.id,
      tournament_id: match.tournament.id,
      tournament_slug: match.tournament.slug,
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
};

export default matchRoutes;
