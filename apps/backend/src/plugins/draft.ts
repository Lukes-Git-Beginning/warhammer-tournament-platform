import fp from 'fastify-plugin';
import { DraftService } from '../lib/draft-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    draftService: DraftService;
  }
}

export default fp(
  async (fastify) => {
    const service = new DraftService(
      fastify.prisma,
      fastify.redis,
      // io is optional — socket plugin may not be registered (e.g. in tests)
      fastify.hasDecorator('io') ? (fastify as any).io : undefined,
    );

    fastify.decorate('draftService', service);

    fastify.addHook('onReady', async () => {
      const count = await service.initActiveDrafts().catch((err: unknown) => {
        fastify.log.error({ err }, 'Failed to init active drafts');
        return 0;
      });
      if (count > 0) {
        fastify.log.info({ count }, 'Rehydrated active drafts from DB/Redis');
      }
    });

    fastify.addHook('onClose', async () => {
      service.shutdown();
    });
  },
  { name: 'draft', dependencies: ['db', 'redis'] },
);
