import type { FastifyPluginAsync } from 'fastify';
import { cached } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Route plugin — public map listing
// Admin CRUD for maps is handled in routes/admin.ts (Plan 3 / SB3).
// ---------------------------------------------------------------------------

const mapsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/maps — public, all active maps, cached 5 min
  fastify.get('/api/maps', async (_request, _reply) => {
    const maps = await cached(
      fastify.redis,
      'maps:list',
      async () => {
        return fastify.prisma.map.findMany({
          where: { deleted_at: null },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            image_url: true,
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
