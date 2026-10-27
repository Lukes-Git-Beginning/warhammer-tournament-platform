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
  // GET /api/maps — public, all AVAILABLE maps (offered to hosts + Open Play), cached 5 min.
  // Optional ?battle_type=<battle type> filter — a map is built for one battle type.
  fastify.get('/api/maps', async (request, reply) => {
    const parsed = MapsQuerySchema.safeParse(request.query);
    // An unknown battle_type is an error, not "no filter": RizzOtto's Arena Mod's build reads the pools
    // from here and must be able to tell a missing pool apart from the full list.
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: 'Unknown battle_type', statusCode: 400 });
    }
    const bt = parsed.data.battle_type;

    const maps = await cached(
      fastify.redis,
      cacheKey('maps:list', { bt }),
      async () => {
        return fastify.prisma.map.findMany({
          where: {
            deleted_at: null,
            available: true,
            ...(bt !== undefined ? { battle_type: bt } : {}),
          },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            image_url: true,
            battle_type: true,
            available: true,
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
