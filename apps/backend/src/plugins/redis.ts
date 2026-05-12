import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    redisPub: Redis;
    redisSub: Redis;
  }
}

export default fp(
  async (fastify) => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');

    const main = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    const pub = main.duplicate();
    const sub = main.duplicate();

    await Promise.all([main.connect(), pub.connect(), sub.connect()]);
    fastify.log.info({ url }, 'redis connected');

    fastify.decorate('redis', main);
    fastify.decorate('redisPub', pub);
    fastify.decorate('redisSub', sub);

    fastify.addHook('onClose', async () => {
      await Promise.allSettled([main.quit(), pub.quit(), sub.quit()]);
    });
  },
  { name: 'redis' },
);
