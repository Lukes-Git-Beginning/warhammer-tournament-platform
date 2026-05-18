import fp from 'fastify-plugin';
import { prisma, type PrismaClient } from '@rizzotto/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(
  async (fastify) => {
    fastify.decorate('prisma', prisma);
    fastify.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'db' },
);
