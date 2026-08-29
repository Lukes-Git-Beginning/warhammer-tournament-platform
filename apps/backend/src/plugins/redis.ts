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

    // Without a listener ioredis reports connection trouble via console.error, which bypasses pino
    // and lands in the journal as unstructured text with no request context. Route it through the
    // app logger instead; the client keeps reconnecting on its own either way.
    for (const [name, client] of [['main', main], ['pub', pub], ['sub', sub]] as const) {
      client.on('error', (err) => fastify.log.error({ err, client: name }, 'redis client error'));
    }

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
