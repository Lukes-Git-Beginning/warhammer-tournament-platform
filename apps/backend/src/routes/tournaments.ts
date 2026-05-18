import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { generateSlug, validateStatusTransition, TournamentStatus } from '../lib/tournament-utils.js';
import { emitStatusChange } from '../lib/emit.js';
import { finalizeTournament } from '../lib/finalize-tournament.js';
import { cached, invalidate, cacheKey } from '../lib/cache.js';
import type { TournamentStatusLiteral } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateTournamentSchema = z.object({
  name: z.string().min(3).max(120),
  format: z.enum(['SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN']),
  mode: z.enum(['ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'SFT']).optional(),
  start_date: z.string().datetime(),
  timezone: z.string().min(1).max(64),
  max_participants: z.number().int().min(2).max(512).optional(),
  registration_deadline: z.string().datetime().optional(),
  rules: z.string().max(20000).optional(),
  discord_link: z.string().url().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  counts_for_leaderboard: z.boolean().optional(),
  is_major: z.boolean().optional(),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
});

const PatchTournamentSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
  rules: z.string().max(20000).optional(),
  discord_link: z.string().url().optional().nullable(),
  start_date: z.string().datetime().optional(),
  timezone: z.string().min(1).max(64).optional(),
  registration_deadline: z.string().datetime().optional().nullable(),
  max_participants: z.number().int().min(2).max(512).optional().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  status: z.enum(['DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED']).optional(),
  draft_enabled: z.boolean().optional(),
  draft_preset_id: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Body must contain at least one field' });

// ---------------------------------------------------------------------------
// Helper: attempt slug generation with collision retry
// ---------------------------------------------------------------------------

async function resolveSlug(
  prisma: { tournament: { findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null> } },
  base: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.tournament.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  // Fallback: append timestamp fragment
  return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const tournamentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/tournaments
  fastify.get('/api/tournaments', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { page, pageSize } = parsed.data;
    const skip = (page - 1) * pageSize;

    const result = await cached(
      fastify.redis,
      cacheKey('tournaments:list', { page, pageSize }),
      async () => {
        const [tournaments, total] = await Promise.all([
          fastify.prisma.tournament.findMany({
            where: { deleted_at: null, visibility: 'PUBLIC' },
            select: {
              id: true,
              slug: true,
              name: true,
              format: true,
              mode: true,
              status: true,
              visibility: true,
              max_participants: true,
              start_date: true,
              timezone: true,
              registration_deadline: true,
              counts_for_leaderboard: true,
              is_major: true,
              created_at: true,
              organizer: { select: { id: true, username: true, avatar_url: true } },
              _count: { select: { participants: { where: { deleted_at: null } } } },
            },
            orderBy: { start_date: 'desc' },
            skip,
            take: pageSize,
          }),
          fastify.prisma.tournament.count({ where: { deleted_at: null, visibility: 'PUBLIC' } }),
        ]);
        return { data: tournaments, total, page, pageSize };
      },
      { ttlSeconds: 30 },
    );

    return result;
  });

  // POST /api/tournaments
  fastify.post(
    '/api/tournaments',
    { preHandler: [fastify.authenticate, fastify.requireRole('ORGANIZER', 'MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const parsed = CreateTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const data = parsed.data;

      // Semantic validation: draft_enabled requires draft_preset_id
      if (data.draft_enabled && !data.draft_preset_id) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament with draft enabled requires a preset_id',
          statusCode: 422,
        });
      }

      // Verify preset exists and access rights
      if (data.draft_preset_id) {
        const preset = await fastify.prisma.draftPreset.findUnique({
          where: { id: data.draft_preset_id },
          select: { id: true, is_public: true, created_by: true },
        });
        if (!preset) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'Preset not found',
            statusCode: 422,
          });
        }
        const user = request.user;
        const isAdmin = user.role === 'ADMIN';
        const isCreator = preset.created_by === user.sub;
        if (!preset.is_public && !isCreator && !isAdmin) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'Preset is private and not accessible to this user',
            statusCode: 422,
          });
        }
      }

      const baseSlug = generateSlug(data.name);
      const slug = await resolveSlug(fastify.prisma, baseSlug);

      const tournament = await fastify.prisma.tournament.create({
        data: {
          slug,
          name: data.name,
          format: data.format,
          mode: data.mode,
          status: TournamentStatus.DRAFT,
          visibility: data.visibility ?? 'PUBLIC',
          start_date: new Date(data.start_date),
          timezone: data.timezone,
          max_participants: data.max_participants,
          registration_deadline: data.registration_deadline
            ? new Date(data.registration_deadline)
            : undefined,
          rules: data.rules ?? '',
          discord_link: data.discord_link,
          counts_for_leaderboard: data.counts_for_leaderboard ?? true,
          is_major: data.is_major ?? false,
          draft_enabled: data.draft_enabled ?? false,
          draft_preset_id: data.draft_preset_id ?? null,
          description: data.description,
          organizer_id: request.user.sub,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          format: true,
          mode: true,
          status: true,
          visibility: true,
          organizer_id: true,
          created_at: true,
        },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Tournament',
          entity_id: tournament.slug,
          action: 'create',
          actor_id: request.user.sub,
          new_value: { id: tournament.id, slug: tournament.slug, name: tournament.name },
        },
      });

      await invalidate(fastify.redis, 'tournaments:list:*');
      request.log.info({ slug: tournament.slug }, 'Tournament created');
      return reply.code(201).send(tournament);
    },
  );

  // GET /api/tournaments/:slug
  fastify.get('/api/tournaments/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        format: true,
        mode: true,
        status: true,
        visibility: true,
        max_participants: true,
        start_date: true,
        timezone: true,
        registration_deadline: true,
        rules: true,
        discord_link: true,
        draft_enabled: true,
        counts_for_leaderboard: true,
        is_major: true,
        organizer_id: true,
        created_at: true,
        updated_at: true,
        organizer: { select: { id: true, username: true, avatar_url: true } },
        _count: {
          select: { participants: { where: { deleted_at: null } } },
        },
      },
    });

    if (!tournament) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Tournament "${slug}" not found`,
        statusCode: 404,
      });
    }

    // PRIVATE tournaments only visible to organizer or MODERATOR/ADMIN
    if (tournament.visibility === 'PRIVATE') {
      // Try to read auth from cookie — optional auth pattern
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'This tournament is private',
          statusCode: 403,
        });
      }
      const user = request.user;
      const isAllowed =
        user.sub === tournament.organizer_id ||
        user.role === 'MODERATOR' ||
        user.role === 'ADMIN';
      if (!isAllowed) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'This tournament is private',
          statusCode: 403,
        });
      }
    }

    return tournament;
  });

  // PATCH /api/tournaments/:slug
  fastify.patch(
    '/api/tournaments/:slug',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: {
          id: true,
          organizer_id: true,
          status: true,
          name: true,
          description: true,
          rules: true,
          discord_link: true,
          start_date: true,
          timezone: true,
          registration_deadline: true,
          max_participants: true,
          visibility: true,
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const user = request.user;
      const canEdit =
        user.sub === tournament.organizer_id ||
        user.role === 'MODERATOR' ||
        user.role === 'ADMIN';
      if (!canEdit) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to edit this tournament',
          statusCode: 403,
        });
      }

      const parsed = PatchTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { status: newStatus, ...rest } = parsed.data;

      // Semantic validation: draft_enabled requires draft_preset_id
      // Note: draft_preset_id can be undefined (not sent) or explicitly null (sent as null).
      // We use 'in' to distinguish "not provided" from "explicitly null".
      const patchDraftEnabled = rest.draft_enabled;
      const patchDraftPresetId = 'draft_preset_id' in rest ? rest.draft_preset_id : undefined;

      if (patchDraftEnabled === true && (patchDraftPresetId === null || patchDraftPresetId === undefined)) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament with draft enabled requires a preset_id',
          statusCode: 422,
        });
      }

      if (patchDraftPresetId !== undefined && patchDraftPresetId !== null) {
        const preset = await fastify.prisma.draftPreset.findUnique({
          where: { id: patchDraftPresetId },
          select: { id: true, is_public: true, created_by: true },
        });
        if (!preset) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'Preset not found',
            statusCode: 422,
          });
        }
        const isAdmin = user.role === 'ADMIN';
        const isCreator = preset.created_by === user.sub;
        if (!preset.is_public && !isCreator && !isAdmin) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'Preset is private and not accessible to this user',
            statusCode: 422,
          });
        }
      }

      // Validate status transition
      if (newStatus !== undefined) {
        if (!validateStatusTransition(tournament.status as TournamentStatus, newStatus as TournamentStatus)) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: `Status transition from ${tournament.status} to ${newStatus} is not allowed`,
            statusCode: 422,
          });
        }
      }

      // Build old_value / new_value for audit log (changed fields only)
      const changedOld: Record<string, unknown> = {};
      const changedNew: Record<string, unknown> = {};
      const updateData: Record<string, unknown> = {};

      const fieldMap: Record<string, unknown> = {
        ...rest,
        ...(newStatus !== undefined ? { status: newStatus } : {}),
      };

      for (const [key, value] of Object.entries(fieldMap)) {
        if (value !== undefined) {
          const oldVal = tournament[key as keyof typeof tournament];
          changedOld[key] = oldVal;
          changedNew[key] = value;
          updateData[key] =
            (key === 'start_date' || key === 'registration_deadline') && typeof value === 'string'
              ? value === null
                ? null
                : new Date(value)
              : value;
        }
      }

      const updated = await fastify.prisma.tournament.update({
        where: { id: tournament.id },
        data: updateData,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          visibility: true,
          updated_at: true,
        },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Tournament',
          entity_id: slug,
          action: 'update',
          actor_id: user.sub,
          old_value: changedOld as Record<string, string | number | boolean | null>,
          new_value: changedNew as Record<string, string | number | boolean | null>,
        },
      });

      request.log.info({ slug, changed: Object.keys(changedNew) }, 'Tournament updated');

      // Auto-finalize on COMPLETED transition
      if (newStatus === 'COMPLETED') {
        try {
          await finalizeTournament(fastify.prisma, tournament.id, request.user.sub);
          await Promise.all([
            invalidate(fastify.redis, 'leaderboard:*'),
            invalidate(fastify.redis, 'tournaments:list:*'),
            invalidate(fastify.redis, 'factions:*'),
            invalidate(fastify.redis, 'meta:*'),
          ]);
        } catch (err) {
          request.log.warn({ err, tournamentId: tournament.id }, 'finalize failed');
        }
      } else {
        const invalidations: Promise<number>[] = [
          invalidate(fastify.redis, 'tournaments:list:*'),
        ];
        // When draft config changes, also flush the preset caches so callers
        // see up-to-date "in use" state (e.g. preset-detail permission checks).
        const draftConfigChanged =
          'draft_enabled' in changedNew || 'draft_preset_id' in changedNew;
        if (draftConfigChanged) {
          invalidations.push(invalidate(fastify.redis, 'draft-presets:*'));
        }
        await Promise.all(invalidations);
      }

      // Emit socket event on status change
      if (newStatus !== undefined) {
        emitStatusChange(fastify.io, {
          tournamentId: tournament.id,
          status: newStatus as TournamentStatusLiteral,
        });
      }

      return updated;
    },
  );

  // DELETE /api/tournaments/:slug
  fastify.delete(
    '/api/tournaments/:slug',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, organizer_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const user = request.user;
      const canDelete =
        user.sub === tournament.organizer_id ||
        user.role === 'MODERATOR' ||
        user.role === 'ADMIN';
      if (!canDelete) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this tournament',
          statusCode: 403,
        });
      }

      await fastify.prisma.tournament.update({
        where: { id: tournament.id },
        data: { deleted_at: new Date() },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'Tournament',
          entity_id: slug,
          action: 'delete',
          actor_id: user.sub,
        },
      });

      await invalidate(fastify.redis, 'tournaments:list:*');
      request.log.info({ slug }, 'Tournament soft-deleted');
      return reply.code(204).send();
    },
  );
};

export default tournamentRoutes;
