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

/** Resolve the version id from an optional query value, else the active version. */
async function resolveVersionId(
  fastify: FastifyInstance,
  versionId: string | undefined,
): Promise<{ id: string } | { error: { code: number; message: string } }> {
  // 'all' (All-Time) has no decay in the RATING-MODEL views yet → fall back to the active version so
  // the model matchup matrix / proficiency stay functional when the meta tab is in All-Time mode.
  if (versionId && versionId !== 'all') {
    const version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
    if (!version) return { error: { code: 404, message: 'Version not found' } };
    return { id: version.id };
  }
  const active = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
  if (!active) return { error: { code: 404, message: 'No active version' } };
  return { id: active.id };
}

const VersionQuerySchema = z.object({ versionId: z.union([z.string().uuid(), z.literal('all')]).optional() });
const AntiFarmingQuerySchema = VersionQuerySchema.extend({
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
        message: 'Match not found or not scoreable (must be confirmed, decisive, with both factions and a version)',
        statusCode: 404,
      });
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // #3 — GET /api/leaderboard/anti-farming?playerId=&opponentId=&versionId=
  // -------------------------------------------------------------------------
  fastify.get('/api/leaderboard/anti-farming', async (request, reply) => {
    const parsed = AntiFarmingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { playerId, opponentId, versionId } = parsed.data;

    const resolved = await resolveVersionId(fastify, versionId);
    if ('error' in resolved) {
      return reply.code(resolved.error.code).send({ error: 'NotFound', message: resolved.error.message, statusCode: resolved.error.code });
    }

    return cached(
      fastify.redis,
      cacheKey('leaderboard:anti-farming', { versionId: resolved.id, playerId, opponentId }),
      () => playerOpponentBreakdown(fastify.prisma, fastify.redis, resolved.id, playerId, opponentId),
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // #4 — GET /api/factions/matchup-matrix?versionId=
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/matchup-matrix', async (request, reply) => {
    const parsed = VersionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    // 'all' / omitted → the timeless all-games model (All-Time); a specific version → that version.
    // Mirrors the faction-proficiency endpoint below. (The old resolveVersionId fell 'all' back to the
    // ACTIVE version, so the model matchup matrix + faction "model strength" showed the current version
    // regardless of the selector — the timeless model is the correct All-Time view, with full samples.)
    const raw = parsed.data.versionId;
    const scoped = raw && raw !== 'all' ? raw : null;

    return cached(
      fastify.redis,
      cacheKey('factions:matchup-matrix', { versionId: scoped ?? 'all' }),
      async () => ({
        versionId: scoped,
        entries: await factionMatchupMatrix(fastify.prisma, fastify.redis, scoped),
        factionStrengths: await factionStrengths(fastify.prisma, fastify.redis, scoped),
      }),
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // #5 — GET /api/players/:id/faction-proficiency?versionId=&battleType=
  // -------------------------------------------------------------------------
  fastify.get('/api/players/:id/faction-proficiency', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = VersionQuerySchema.extend({
      battleType: z.enum(['OVERALL', 'DOMINATION', 'CONQUEST', 'SIEGE']).default('OVERALL'),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    // Faction proficiency is offered as a version- and battle-type-filterable VIEW on the profile
    // (default All-Time + Overall). 'all'/omitted version = All-Time (null). A battle type runs its
    // own fit over that type's games (genuinely per-type faction skills).
    const raw = parsed.data.versionId;
    const scoped = raw && raw !== 'all' ? raw : null;
    const battleType = parsed.data.battleType === 'OVERALL' ? undefined : parsed.data.battleType;
    return cached(
      fastify.redis,
      cacheKey('leaderboard:proficiency', { scope: scoped ?? 'all', bt: battleType ?? 'OVERALL', playerId: id }),
      async () => ({
        playerId: id,
        versionId: scoped,
        battleType: battleType ?? 'OVERALL',
        entries: await playerFactionProficiency(fastify.prisma, fastify.redis, scoped, id, battleType),
      }),
      { ttlSeconds: 60 },
    );
  });
};

export default ratingRoutes;
