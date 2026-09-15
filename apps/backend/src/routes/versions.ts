import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listQuartersSinceLaunch, loadQuarterOverrides, applyQuarterOverride, parseQuarter } from '../lib/competition.js';

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

  // -------------------------------------------------------------------------
  // Quarters — calendar quarters with admin-editable name / boundary overrides.
  // -------------------------------------------------------------------------

  // GET /api/quarters — public: launch→now quarters, calendar defaults merged with overrides.
  fastify.get('/api/quarters', async () => {
    const overrides = await loadQuarterOverrides(fastify.prisma);
    // Include a couple of upcoming quarters so admins can configure name/boundaries ahead of time.
    const ahead = new Date();
    ahead.setUTCMonth(ahead.getUTCMonth() + 6);
    const data = listQuartersSinceLaunch(ahead).map((base) => {
      const ov = overrides.get(base.value) ?? null;
      const eff = applyQuarterOverride(base, ov ?? undefined);
      return {
        period: base.value,
        defaultLabel: base.label,
        defaultFrom: base.from,
        defaultTo: base.to,
        label: eff.label,
        from: eff.from,
        to: eff.to,
        override: ov ? { name: ov.name, start_date: ov.start_date, end_date: ov.end_date } : null,
      };
    });
    return { data };
  });

  const QuarterPatchSchema = z
    .object({
      name: z.string().max(120).nullable().optional(),
      start_date: z.string().datetime().nullable().optional(),
      end_date: z.string().datetime().nullable().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'Body must contain at least one field' });

  // PATCH /api/quarters/:period — MODERATOR or ADMIN: set/clear the override (null = calendar default).
  fastify.patch(
    '/api/quarters/:period',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { period } = request.params as { period: string };
      if (!parseQuarter(period)) {
        return reply.code(400).send({ error: 'BadRequest', message: `Invalid quarter period "${period}"`, statusCode: 400 });
      }
      const parsed = QuarterPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }
      const d = parsed.data;
      const start = d.start_date !== undefined ? (d.start_date ? new Date(d.start_date) : null) : undefined;
      const end = d.end_date !== undefined ? (d.end_date ? new Date(d.end_date) : null) : undefined;
      if (start && end && end.getTime() <= start.getTime()) {
        return reply.code(400).send({ error: 'BadRequest', message: 'end_date must be after start_date', statusCode: 400 });
      }
      const upd: Record<string, unknown> = {};
      if (d.name !== undefined) upd.name = d.name;
      if (start !== undefined) upd.start_date = start;
      if (end !== undefined) upd.end_date = end;
      const saved = await fastify.prisma.quarterConfig.upsert({
        where: { period },
        update: upd,
        create: {
          period,
          name: (upd.name as string | null | undefined) ?? null,
          start_date: (upd.start_date as Date | null | undefined) ?? null,
          end_date: (upd.end_date as Date | null | undefined) ?? null,
        },
      });
      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'QuarterConfig',
          entity_id: period,
          action: 'update',
          actor_id: request.user.sub,
          new_value: {
            name: d.name ?? null,
            start_date: d.start_date ?? null,
            end_date: d.end_date ?? null,
          },
        },
      });
      return saved;
    },
  );
};

export default versionRoutes;
