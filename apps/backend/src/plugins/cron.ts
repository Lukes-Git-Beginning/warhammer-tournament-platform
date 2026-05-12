import fp from 'fastify-plugin';
import cron from 'node-cron';
import { takeFactionsSnapshot } from '../lib/faction-snapshot.js';

declare module 'fastify' {
  interface FastifyInstance {
    cronTasks?: cron.ScheduledTask[];
  }
}

export default fp(
  async (fastify) => {
    const task = cron.schedule(
      '5 0 * * *',
      async () => {
        fastify.log.info('Running daily faction stats snapshot');
        try {
          const count = await takeFactionsSnapshot(fastify.prisma);
          fastify.log.info({ count }, 'Faction snapshot completed');
        } catch (err) {
          fastify.log.error({ err }, 'Faction snapshot failed');
        }
      },
      { timezone: 'UTC' },
    );

    fastify.decorate('cronTasks', [task]);

    fastify.addHook('onClose', async () => {
      task.stop();
    });
  },
  { name: 'cron', dependencies: ['db'] },
);
