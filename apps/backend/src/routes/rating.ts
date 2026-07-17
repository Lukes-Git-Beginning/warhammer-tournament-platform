// ---------------------------------------------------------------------------
// Rating / Explainability Routes (Alex-Spec dynamic leaderboard)
//
//   GET /api/matches/:id/scoring-breakdown          — per-match derivation (#2)
//   GET /api/leaderboard/anti-farming               — player/opponent share (#3)
//   GET /api/factions/matchup-matrix                — fitted matchup matrix (#4)
//   GET /api/players/:id/faction-proficiency        — per-faction skill table (#5)
//
// All values are derived live from confirmed match facts + the current model.
// Cache keys live under `leaderboard:*` / `factions:*` so they are invalidated
// by the existing post-match-completion invalidation.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import {
  matchBreakdown,
  playerOpponentBreakdown,
  factionMatchupMatrix,
  factionStrengths,
  playerFactionProficiency,
} from '../lib/breakdown-service.js';

/** Resolve the season id from an optional query value, else the active season. */
async function resolveSeasonId(
  fastify: FastifyInstance,
  seasonId: string | undefined,
): Promise<{ id: string } | { error: { code: number; message: string } }> {
  if (seasonId) {
    const season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) return { error: { code: 404, message: 'Season not found' } };
    return { id: season.id };
  }
  const active = await fastify.prisma.season.findFirst({ where: { is_active: true } });
  if (!active) return { error: { code: 404, message: 'No active season' } };
  return { id: active.id };
}

const SeasonQuerySchema = z.object({ seasonId: z.string().uuid().optional() });
const AntiFarmingQuerySchema = SeasonQuerySchema.extend({
  playerId: z.string().uuid(),
  opponentId: z.string().uuid(),
});

const ratingRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // #2 — GET /api/matches/:id/scoring-breakdown
  // -------------------------------------------------------------------------
  fastify.get('/api/matches/:id/scoring-breakdown', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await cached(
      fastify.redis,
      cacheKey('leaderboard:breakdown:match', { id }),
      () => matchBreakdown(fastify.prisma, fastify.redis, id),
      { ttlSeconds: 60 },
    );

    if (!result) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'Match not found or not scoreable (must be confirmed, decisive, with both factions and a season)',
        statusCode: 404,
      });
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // #3 — GET /api/leaderboard/anti-farming?playerId=&opponentId=&seasonId=
  // -------------------------------------------------------------------------
  fastify.get('/api/leaderboard/anti-farming', async (request, reply) => {
    const parsed = AntiFarmingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { playerId, opponentId, seasonId } = parsed.data;

    const resolved = await resolveSeasonId(fastify, seasonId);
    if ('error' in resolved) {
      return reply.code(resolved.error.code).send({ error: 'NotFound', message: resolved.error.message, statusCode: resolved.error.code });
    }

    return cached(
      fastify.redis,
      cacheKey('leaderboard:anti-farming', { seasonId: resolved.id, playerId, opponentId }),
      () => playerOpponentBreakdown(fastify.prisma, fastify.redis, resolved.id, playerId, opponentId),
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // #4 — GET /api/factions/matchup-matrix?seasonId=
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/matchup-matrix', async (request, reply) => {
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const resolved = await resolveSeasonId(fastify, parsed.data.seasonId);
    if ('error' in resolved) {
      return reply.code(resolved.error.code).send({ error: 'NotFound', message: resolved.error.message, statusCode: resolved.error.code });
    }

    return cached(
      fastify.redis,
      cacheKey('factions:matchup-matrix', { seasonId: resolved.id }),
      async () => ({
        seasonId: resolved.id,
        entries: await factionMatchupMatrix(fastify.prisma, fastify.redis, resolved.id),
        factionStrengths: await factionStrengths(fastify.prisma, fastify.redis, resolved.id),
      }),
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // #5 — GET /api/players/:id/faction-proficiency?seasonId=
  // -------------------------------------------------------------------------
  fastify.get('/api/players/:id/faction-proficiency', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const resolved = await resolveSeasonId(fastify, parsed.data.seasonId);
    if ('error' in resolved) {
      return reply.code(resolved.error.code).send({ error: 'NotFound', message: resolved.error.message, statusCode: resolved.error.code });
    }

    return cached(
      fastify.redis,
      cacheKey('leaderboard:proficiency', { seasonId: resolved.id, playerId: id }),
      async () => ({
        playerId: id,
        seasonId: resolved.id,
        entries: await playerFactionProficiency(fastify.prisma, fastify.redis, resolved.id, id),
      }),
      { ttlSeconds: 60 },
    );
  });
};

export default ratingRoutes;
