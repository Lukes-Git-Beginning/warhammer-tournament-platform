import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CreateDraftPresetSchema,
  UpdateDraftPresetSchema,
  DraftTurnSchema,
  CategoryLimitSchema,
  type DraftTurn,
  type CategoryLimit,
} from '@tww3/types';
import { cached, invalidate } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Param / query schemas
// ---------------------------------------------------------------------------

const PresetParamSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

function toPresetDto(row: {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  is_public: boolean;
  category_limits: unknown;
  turns: unknown;
  turn_seconds: number;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    created_by: row.created_by,
    is_public: row.is_public,
    category_limits: CategoryLimitSchema.array().parse(row.category_limits) as CategoryLimit[],
    turns: DraftTurnSchema.array().parse(row.turns) as DraftTurn[],
    turn_seconds: row.turn_seconds,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Semantic validation helpers
// ---------------------------------------------------------------------------

function validateTurnOrders(turns: DraftTurn[]): string | null {
  const orders = turns.map((t) => t.order);
  const unique = new Set(orders);
  if (unique.size !== orders.length) {
    return 'turn.order values must be unique within a preset';
  }
  return null;
}

function validateTurnCategories(
  turns: DraftTurn[],
  categoryLimits: CategoryLimit[],
): string | null {
  const definedCategories = new Set(categoryLimits.map((c) => c.category_name));
  definedCategories.add('default'); // 'default' is always valid

  for (const turn of turns) {
    if (!definedCategories.has(turn.category)) {
      return `Turn category "${turn.category}" is not defined in category_limits`;
    }
  }
  return null;
}

async function validateFactionIds(
  factions: string[],
  prisma: { faction: { findMany: (args: { where: { id: { in: string[] } }; select: { id: true } }) => Promise<{ id: string }[]> } },
): Promise<string | null> {
  if (factions.length === 0) return null;

  const found = await prisma.faction.findMany({
    where: { id: { in: factions } },
    select: { id: true },
  });
  const foundIds = new Set(found.map((f) => f.id));
  const unknown = factions.filter((f) => !foundIds.has(f));
  if (unknown.length > 0) {
    return `Unknown faction IDs: ${unknown.join(', ')}`;
  }
  return null;
}

async function runSemanticValidation(
  turns: DraftTurn[],
  categoryLimits: CategoryLimit[],
  prisma: Parameters<typeof validateFactionIds>[1],
): Promise<string | null> {
  // 1. Unique turn orders
  const orderError = validateTurnOrders(turns);
  if (orderError) return orderError;

  // 2. Turn categories must be defined
  const categoryError = validateTurnCategories(turns, categoryLimits);
  if (categoryError) return categoryError;

  // 3. Faction IDs in category_limits must be valid
  const allFactionIds = categoryLimits.flatMap((c) => c.factions);
  const factionError = await validateFactionIds(allFactionIds, prisma);
  if (factionError) return factionError;

  return null;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const draftPresetRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = fastify.hasDecorator('redis')
    ? (fastify as unknown as { redis: import('ioredis').Redis }).redis
    : undefined;

  // -------------------------------------------------------------------------
  // GET /api/draft-presets  — public + own
  // -------------------------------------------------------------------------
  fastify.get('/api/draft-presets', async (request, reply) => {
    // Optional auth: try to verify, don't fail if missing
    let userId: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user.sub;
    } catch {
      // anonymous — only public presets
    }

    if (userId === null) {
      // Anonymous: serve only public presets, cacheable
      const result = await cached(
        redis,
        'draft-presets:public',
        async () => {
          const rows = await fastify.prisma.draftPreset.findMany({
            where: { is_public: true },
            orderBy: [{ created_at: 'desc' }],
          });
          return { presets: rows.map(toPresetDto) };
        },
        { ttlSeconds: 60 },
      );
      return result;
    }

    // Authenticated: public OR own
    const result = await cached(
      redis,
      `draft-presets:user:${userId}`,
      async () => {
        const rows = await fastify.prisma.draftPreset.findMany({
          where: {
            OR: [{ is_public: true }, { created_by: userId! }],
          },
          orderBy: [{ created_at: 'desc' }],
        });
        return { presets: rows.map(toPresetDto) };
      },
      { ttlSeconds: 60 },
    );
    return result;
  });

  // -------------------------------------------------------------------------
  // GET /api/draft-presets/:id
  // -------------------------------------------------------------------------
  fastify.get('/api/draft-presets/:id', async (request, reply) => {
    const paramParsed = PresetParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: paramParsed.error.message,
        statusCode: 400,
      });
    }
    const { id } = paramParsed.data;

    // Optional auth
    let userId: string | null = null;
    let userRole: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user.sub;
      userRole = request.user.role;
    } catch {
      // anonymous
    }

    const preset = await cached(
      redis,
      `draft-presets:detail:${id}`,
      async () => {
        const row = await fastify.prisma.draftPreset.findUnique({ where: { id } });
        return row ? toPresetDto(row) : null;
      },
      { ttlSeconds: 60 },
    );

    if (preset === null) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'DraftPreset not found',
        statusCode: 404,
      });
    }

    // Access control for private presets
    if (!preset.is_public) {
      if (userId === null) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid auth token',
          statusCode: 401,
        });
      }
      const isAdmin = userRole === 'ADMIN';
      const isCreator = preset.created_by === userId;
      if (!isAdmin && !isCreator) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'DraftPreset not found',
          statusCode: 404,
        });
      }
    }

    return preset;
  });

  // -------------------------------------------------------------------------
  // POST /api/draft-presets  — ORGANIZER / MODERATOR / ADMIN
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/draft-presets',
    { preHandler: [fastify.authenticate, fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const parsed = CreateDraftPresetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }
      const data = parsed.data;

      const semanticError = await runSemanticValidation(
        data.turns,
        data.category_limits,
        fastify.prisma,
      );
      if (semanticError) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: semanticError,
          statusCode: 422,
        });
      }

      const row = await fastify.prisma.draftPreset.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          created_by: request.user.sub,
          is_public: data.is_public,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category_limits: data.category_limits as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          turns: data.turns as any,
          turn_seconds: data.turn_seconds,
        },
      });

      await invalidate(redis, 'draft-presets:*');

      return reply.code(201).send(toPresetDto(row));
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/draft-presets/:id  — creator or ADMIN
  // -------------------------------------------------------------------------
  fastify.put(
    '/api/draft-presets/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const paramParsed = PresetParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: paramParsed.error.message,
          statusCode: 400,
        });
      }
      const { id } = paramParsed.data;

      const existing = await fastify.prisma.draftPreset.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'DraftPreset not found',
          statusCode: 404,
        });
      }

      const user = request.user;
      const isAdmin = user.role === 'ADMIN';
      const isCreator = existing.created_by === user.sub;
      if (!isAdmin && !isCreator) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the creator or an ADMIN may update this preset',
          statusCode: 403,
        });
      }

      const parsed = UpdateDraftPresetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }
      const data = parsed.data;

      // Merge with existing for semantic validation
      const mergedTurns =
        data.turns !== undefined
          ? data.turns
          : (DraftTurnSchema.array().parse(existing.turns) as DraftTurn[]);
      const mergedLimits =
        data.category_limits !== undefined
          ? data.category_limits
          : (CategoryLimitSchema.array().parse(existing.category_limits) as CategoryLimit[]);

      const semanticError = await runSemanticValidation(mergedTurns, mergedLimits, fastify.prisma);
      if (semanticError) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: semanticError,
          statusCode: 422,
        });
      }

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.is_public !== undefined) updateData.is_public = data.is_public;
      if (data.turn_seconds !== undefined) updateData.turn_seconds = data.turn_seconds;
      if (data.turns !== undefined) updateData.turns = data.turns;
      if (data.category_limits !== undefined) updateData.category_limits = data.category_limits;

      const updated = await fastify.prisma.draftPreset.update({
        where: { id },
        data: updateData,
      });

      await invalidate(redis, 'draft-presets:*');

      return toPresetDto(updated);
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/draft-presets/:id  — creator or ADMIN
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/draft-presets/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const paramParsed = PresetParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: paramParsed.error.message,
          statusCode: 400,
        });
      }
      const { id } = paramParsed.data;

      const existing = await fastify.prisma.draftPreset.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'DraftPreset not found',
          statusCode: 404,
        });
      }

      const user = request.user;
      const isAdmin = user.role === 'ADMIN';
      const isCreator = existing.created_by === user.sub;
      if (!isAdmin && !isCreator) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the creator or an ADMIN may delete this preset',
          statusCode: 403,
        });
      }

      // Tournament-reference check — ON DELETE RESTRICT
      const inUse = await fastify.prisma.tournament.findFirst({
        where: { draft_preset_id: id },
        select: { id: true },
      });
      if (inUse) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Preset is in use by tournament(s)',
          statusCode: 422,
        });
      }

      await fastify.prisma.draftPreset.delete({ where: { id } });
      await invalidate(redis, 'draft-presets:*');

      return reply.code(204).send();
    },
  );
};

export default draftPresetRoutes;
