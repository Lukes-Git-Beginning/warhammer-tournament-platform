import type { FastifyPluginAsync } from 'fastify';
import { UpdateMeSchema } from '@tww3/types';

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/users/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: {
          id: true,
          discord_id: true,
          username: true,
          email: true,
          avatar_url: true,
          timezone: true,
          role: true,
          preferred_factions: true,
          last_login: true,
          created_at: true,
        },
      });
      if (!user) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'User not found',
          statusCode: 404,
        });
      }
      return {
        ...user,
        last_login: user.last_login?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
      };
    },
  );

  fastify.patch(
    '/api/users/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = UpdateMeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }
      const user = await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: parsed.data,
        select: {
          id: true,
          discord_id: true,
          username: true,
          email: true,
          avatar_url: true,
          timezone: true,
          role: true,
          preferred_factions: true,
          last_login: true,
          created_at: true,
        },
      });
      return {
        ...user,
        last_login: user.last_login?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
      };
    },
  );
};

export default userRoutes;
