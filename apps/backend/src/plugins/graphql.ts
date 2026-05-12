import fp from 'fastify-plugin';
import mercurius from 'mercurius';
import type { MercuriusContext } from 'mercurius';
import type { PrismaClient } from '@tww3/db';
import { schema } from '../graphql/schema.js';
import { resolvers } from '../graphql/resolvers.js';

// Extend MercuriusContext so TypeScript knows which extra fields we inject
// via the context factory below.
declare module 'mercurius' {
  interface MercuriusContext {
    prisma: PrismaClient;
    user: unknown | null;
  }
}

export default fp(
  async (fastify) => {
    await fastify.register(mercurius, {
      schema,
      resolvers: resolvers as never,
      context: async (request): Promise<Partial<MercuriusContext>> => {
        let user: unknown = null;
        try {
          await request.jwtVerify();
          user = (request as { user?: unknown }).user ?? null;
        } catch {
          // unauthenticated requests are allowed; resolvers decide what to expose
        }
        return { prisma: fastify.prisma, user };
      },
      graphiql: process.env.NODE_ENV !== 'production',
    });
  },
  { name: 'graphql', dependencies: ['db'] },
);
