import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { asFactionDto, getFactionsWithStats } from '../lib/factions.js';
import { getMatchupMatrix } from '../lib/heatmap.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const SeasonQuerySchema = z.object({
  seasonId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

const metaRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/meta/overview?seasonId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/overview', async (request, reply) => {
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { seasonId } = parsed.data;

    // Resolve season
    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      }
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) {
        return {
          season: null,
          top_factions_by_winrate: [],
          top_factions_by_pickrate: [],
          total_matches: 0,
          faction_diversity: 0,
        };
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('meta:overview', { seasonId: resolvedSeasonId }),
      async () => {
        const allFactions = await getFactionsWithStats(fastify.prisma, resolvedSeasonId);

        // total_matches: sum of matches_played / 2 (each match counts 2 factions)
        const totalMatchesSummed = allFactions.reduce(
          (sum, f) => sum + (f.stats?.matches_played ?? 0),
          0,
        );
        const total_matches = Math.floor(totalMatchesSummed / 2);

        // faction_diversity: factions with at least 1 match played / 24
        const activeCount = allFactions.filter((f) => (f.stats?.matches_played ?? 0) > 0).length;
        const faction_diversity = activeCount / 24;

        // top 5 by winrate — minimum 10 matches played
        const eligibleForWinrate = allFactions
          .filter((f) => (f.stats?.matches_played ?? 0) >= 10)
          .sort((a, b) => {
            const wrA = a.stats?.win_rate ?? 0;
            const wrB = b.stats?.win_rate ?? 0;
            return wrB - wrA;
          });
        const top_factions_by_winrate = eligibleForWinrate.slice(0, 5);

        // top 5 by pickrate — sorted by matches_played desc
        const byPickrate = [...allFactions]
          .filter((f) => (f.stats?.matches_played ?? 0) > 0)
          .sort((a, b) => (b.stats?.matches_played ?? 0) - (a.stats?.matches_played ?? 0));
        const top_factions_by_pickrate = byPickrate.slice(0, 5);

        return {
          season: {
            id: season!.id,
            name: season!.name,
            start_date: season!.start_date.toISOString(),
            end_date: season!.end_date.toISOString(),
            is_active: season!.is_active,
            dlc_tag: season!.dlc_tag ?? null,
          },
          top_factions_by_winrate,
          top_factions_by_pickrate,
          total_matches,
          faction_diversity,
        };
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/meta/matchups?seasonId=<uuid>
  // Stub for M3.5 — returns empty cells with faction lookup list
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/matchups', async (request, reply) => {
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { seasonId } = parsed.data;

    // Resolve season
    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      }
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) {
        return {
          season_id: null,
          cells: [],
          factions: [],
        };
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('meta:matchups', { seasonId: resolvedSeasonId }),
      async () => {
        const [cells, factions] = await Promise.all([
          getMatchupMatrix(fastify.prisma, resolvedSeasonId),
          fastify.prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
        ]);

        return {
          season_id: resolvedSeasonId,
          cells,
          factions: factions.map(asFactionDto),
        };
      },
      { ttlSeconds: 120 },
    );
  });
};

export default metaRoutes;
