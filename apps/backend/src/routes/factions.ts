import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import {
  asFactionDto,
  asFactionStatsDto,
  getFactionsWithStats,
} from '../lib/factions.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const SeasonQuerySchema = z.object({
  seasonId: z.string().uuid().optional(),
});

const FactionParamSchema = z.object({
  id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

const factionsRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/factions?seasonId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/factions', async (request, reply) => {
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
        return reply.code(404).send({ error: 'NotFound', message: 'No active season', statusCode: 404 });
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('factions:list', { seasonId: resolvedSeasonId }),
      async () => {
        const data = await getFactionsWithStats(fastify.prisma, resolvedSeasonId);
        return {
          data,
          season: {
            id: season!.id,
            name: season!.name,
            start_date: season!.start_date.toISOString(),
            end_date: season!.end_date.toISOString(),
            is_active: season!.is_active,
            dlc_tag: season!.dlc_tag ?? null,
          },
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/factions/:id?seasonId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/:id', async (request, reply) => {
    const paramParsed = FactionParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: paramParsed.error.message,
        statusCode: 400,
      });
    }

    const queryParsed = SeasonQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: queryParsed.error.message,
        statusCode: 400,
      });
    }

    const { id } = paramParsed.data;
    const { seasonId } = queryParsed.data;

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
        return reply.code(404).send({ error: 'NotFound', message: 'No active season', statusCode: 404 });
      }
    }

    const resolvedSeasonId = season.id;

    // Check faction existence before caching
    const faction = await fastify.prisma.faction.findUnique({ where: { id } });
    if (!faction) {
      return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });
    }

    return cached(
      fastify.redis,
      cacheKey('factions:detail', { id, seasonId: resolvedSeasonId }),
      async () => {
        const stats = await fastify.prisma.factionStats.findUnique({
          where: { faction_id_season_id: { faction_id: id, season_id: resolvedSeasonId } },
        });

        // 30-day snapshot trend
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const snapshots = await fastify.prisma.factionStatsSnapshot.findMany({
          where: {
            faction_id: id,
            season_id: resolvedSeasonId,
            snapshot_date: { gte: thirtyDaysAgo },
          },
          orderBy: { snapshot_date: 'asc' },
        });

        const trend = snapshots.map((s) => ({
          date: s.snapshot_date.toISOString().split('T')[0]!,
          matches_played: s.matches_played,
          win_rate: s.matches_played > 0 ? s.wins / s.matches_played : null,
        }));

        return {
          faction: asFactionDto(faction),
          stats: stats ? asFactionStatsDto(stats) : null,
          trend,
        };
      },
      { ttlSeconds: 60 },
    );
  });
};

export default factionsRoutes;
