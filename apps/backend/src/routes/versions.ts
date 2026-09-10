import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const CreateVersionSchema = z.object({
  name: z.string().min(1).max(120),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  is_active: z.boolean().optional().default(false),
  dlc_tag: z.string().optional(),
});

const PatchVersionSchema = z
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

const versionRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/versions — public
  fastify.get('/api/versions', async (_request, _reply) => {
    const versions = await fastify.prisma.gameVersion.findMany({
      orderBy: { start_date: 'desc' },
    });
    return { data: versions };
  });

  // GET /api/versions/active — MUST be before /api/versions/:id
  fastify.get('/api/versions/active', async (_request, reply) => {
    const version = await fastify.prisma.gameVersion.findFirst({
      where: { is_active: true },
    });
    if (!version) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'No active version found',
        statusCode: 404,
      });
    }
    return version;
  });

  // GET /api/versions/:id — public
  fastify.get('/api/versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await fastify.prisma.gameVersion.findUnique({ where: { id } });
    if (!version) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Version "${id}" not found`,
        statusCode: 404,
      });
    }
    return version;
  });

  // POST /api/versions — MODERATOR or ADMIN
  fastify.post(
    '/api/versions',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const parsed = CreateVersionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const data = parsed.data;

      let version;
      if (data.is_active) {
        version = await fastify.prisma.$transaction(async (tx) => {
          await tx.gameVersion.updateMany({ where: { is_active: true }, data: { is_active: false } });
          return tx.gameVersion.create({
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
        version = await fastify.prisma.gameVersion.create({
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
          entity_type: 'GameVersion',
          entity_id: version.id,
          action: 'create',
          actor_id: request.user.sub,
          new_value: { id: version.id, name: version.name } as Record<string, string | number | boolean | null>,
        },
      });

      return reply.code(201).send(version);
    },
  );

  // PATCH /api/versions/:id — MODERATOR or ADMIN
  fastify.patch(
    '/api/versions/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.gameVersion.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Version "${id}" not found`,
          statusCode: 404,
        });
      }

      const parsed = PatchVersionSchema.safeParse(request.body);
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
          await tx.gameVersion.updateMany({ where: { is_active: true }, data: { is_active: false } });
          return tx.gameVersion.update({ where: { id }, data: updatePayload });
        });
      } else {
        updated = await fastify.prisma.gameVersion.update({ where: { id }, data: updatePayload });
      }

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'GameVersion',
          entity_id: id,
          action: 'update',
          actor_id: request.user.sub,
          new_value: updatePayload as Record<string, string | number | boolean | null>,
        },
      });

      return updated;
    },
  );

  // DELETE /api/versions/:id — ADMIN only
  fastify.delete(
    '/api/versions/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.gameVersion.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Version "${id}" not found`,
          statusCode: 404,
        });
      }

      await fastify.prisma.gameVersion.delete({ where: { id } });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'GameVersion',
          entity_id: id,
          action: 'delete',
          actor_id: request.user.sub,
        },
      });

      return reply.code(204).send();
    },
  );
};

export default versionRoutes;
