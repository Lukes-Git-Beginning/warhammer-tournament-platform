import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BattleTypeSchema } from '@rizzotto/types';
import { cached, cacheKey } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Route plugin — public map listing
// Admin CRUD for maps is handled in routes/admin.ts (Plan 3 / SB3).
// ---------------------------------------------------------------------------

const MapsQuerySchema = z.object({
  battle_type: BattleTypeSchema.optional(),
});

const mapsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/maps — public, all active maps, cached 5 min
  // Optional ?battle_type=DOMINATION|CONQUEST|SIEGE filter — returns only maps valid for that type.
  fastify.get('/api/maps', async (request, _reply) => {
    const parsed = MapsQuerySchema.safeParse(request.query);
    // Silently ignore invalid battle_type values — treat as unfiltered.
    const bt = parsed.success ? parsed.data.battle_type : undefined;

    const maps = await cached(
      fastify.redis,
      cacheKey('maps:list', { bt }),
      async () => {
        return fastify.prisma.map.findMany({
          where: {
            deleted_at: null,
            ...(bt !== undefined ? { battle_types: { has: bt } } : {}),
          },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            image_url: true,
            battle_types: true,
            created_at: true,
          },
          orderBy: { name: 'asc' },
        });
      },
      { ttlSeconds: 300 }, // 5 min
    );

    return { data: maps, total: maps.length };
  });
};

export default mapsRoutes;
