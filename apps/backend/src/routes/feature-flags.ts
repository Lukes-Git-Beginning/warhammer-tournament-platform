import type { FastifyPluginAsync } from 'fastify';
import { cached, cacheKey } from '../lib/cache.js';

const FEATURE_FLAGS_KEY = 'feature_flags';

/** Defaults — kept in sync with the admin FeatureFlagsPanel. Everything OFF by default. */
const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  arena: false,
  slt: false,
  bpt: false,
  sft: false,
  enable_majors: false,
};

const featureFlagsRoutes: FastifyPluginAsync = async (fastify) => {
  // Public — the frontend gates UI on these (e.g. the Champions board, the "Majors only" filter
  // and the is_major tournament option are all hidden unless `enable_majors` is on).
  fastify.get('/api/feature-flags', async () => {
    return cached(
      fastify.redis,
      cacheKey('feature-flags', {}),
      async () => {
        const row = await fastify.prisma.adminConfig.findUnique({ where: { key: FEATURE_FLAGS_KEY } });
        const raw =
          row && typeof row.value === 'object' && row.value !== null
            ? (row.value as Record<string, unknown>)
            : {};
        const flags: Record<string, boolean> = { ...DEFAULT_FEATURE_FLAGS };
        for (const k of Object.keys(raw)) if (typeof raw[k] === 'boolean') flags[k] = raw[k] as boolean;
        return flags;
      },
      { ttlSeconds: 30 },
    );
  });
};

export default featureFlagsRoutes;
