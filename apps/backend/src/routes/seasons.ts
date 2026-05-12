import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const CreateSeasonSchema = z.object({
  name: z.string().min(1).max(120),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  is_active: z.boolean().optional().default(false),
  dlc_tag: z.string().optional(),
});

const PatchSeasonSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    is_active: z.boolean().optional(),
    dlc_tag: z.string().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Body must contain at least one field',
  });

const seasonRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/seasons — public
  fastify.get('/api/seasons', async (_request, _reply) => {
    const seasons = await fastify.prisma.season.findMany({
      orderBy: { start_date: 'desc' },
    });
    return { data: seasons };
  });

  // GET /api/seasons/active — MUST be before /api/seasons/:id
  fastify.get('/api/seasons/active', async (_request, reply) => {
    const season = await fastify.prisma.season.findFirst({
      where: { is_active: true },
    });
    if (!season) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'No active season found',
        statusCode: 404,
      });
    }
    return season;
  });

  // GET /api/seasons/:id — public
  fastify.get('/api/seasons/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const season = await fastify.prisma.season.findUnique({ where: { id } });
    if (!season) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Season "${id}" not found`,
        statusCode: 404,
      });
    }
    return season;
  });

  // POST /api/seasons — MODERATOR or ADMIN
  fastify.post(
    '/api/seasons',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const parsed = CreateSeasonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const data = parsed.data;

      let season;
      if (data.is_active) {
        season = await fastify.prisma.$transaction(async (tx) => {
          await tx.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
          return tx.season.create({
            data: {
              name: data.name,
              start_date: new Date(data.start_date),
              end_date: new Date(data.end_date),
              is_active: true,
              dlc_tag: data.dlc_tag,
            },
          });
        });
      } else {
        season = await fastify.prisma.season.create({
          data: {
            name: data.name,
            start_date: new Date(data.start_date),
            end_date: new Date(data.end_date),
            is_active: false,
            dlc_tag: data.dlc_tag,
          },
        });
      }

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Season',
          entity_id: season.id,
          action: 'create',
          actor_id: request.user.sub,
          new_value: { id: season.id, name: season.name } as Record<string, string | number | boolean | null>,
        },
      });

      return reply.code(201).send(season);
    },
  );

  // PATCH /api/seasons/:id — MODERATOR or ADMIN
  fastify.patch(
    '/api/seasons/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.season.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Season "${id}" not found`,
          statusCode: 404,
        });
      }

      const parsed = PatchSeasonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const data = parsed.data;
      const updatePayload: Record<string, unknown> = {};
      if (data.name !== undefined) updatePayload.name = data.name;
      if (data.start_date !== undefined) updatePayload.start_date = new Date(data.start_date);
      if (data.end_date !== undefined) updatePayload.end_date = new Date(data.end_date);
      if (data.dlc_tag !== undefined) updatePayload.dlc_tag = data.dlc_tag;
      if (data.is_active !== undefined) updatePayload.is_active = data.is_active;

      let updated;
      if (data.is_active === true && !existing.is_active) {
        updated = await fastify.prisma.$transaction(async (tx) => {
          await tx.season.updateMany({ where: { is_active: true }, data: { is_active: false } });
          return tx.season.update({ where: { id }, data: updatePayload });
        });
      } else {
        updated = await fastify.prisma.season.update({ where: { id }, data: updatePayload });
      }

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Season',
          entity_id: id,
          action: 'update',
          actor_id: request.user.sub,
          new_value: updatePayload as Record<string, string | number | boolean | null>,
        },
      });

      return updated;
    },
  );

  // DELETE /api/seasons/:id — ADMIN only
  fastify.delete(
    '/api/seasons/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.season.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Season "${id}" not found`,
          statusCode: 404,
        });
      }

      await fastify.prisma.season.delete({ where: { id } });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Season',
          entity_id: id,
          action: 'delete',
          actor_id: request.user.sub,
        },
      });

      return reply.code(204).send();
    },
  );
};

export default seasonRoutes;
