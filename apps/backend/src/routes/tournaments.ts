import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@rizzotto/db';
import { z } from 'zod';
import ical from 'ical-generator';
import { generateSlug, validateStatusTransition, TournamentStatus } from '../lib/tournament-utils.js';
import { emitStatusChange } from '../lib/emit.js';
import { finalizeTournament } from '../lib/finalize-tournament.js';
import { cached, invalidate, cacheKey } from '../lib/cache.js';
import type { TournamentStatusLiteral } from '@rizzotto/types';
import {
  CalendarQuerySchema,
  CalendarTournamentSchema,
  TournamentStatusSchema,
} from '@rizzotto/types';
import { notifyTournamentAnnounce } from '../lib/discord-notify.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: TournamentStatusSchema.optional(),
  // NB: z.coerce.boolean() is wrong for query strings — Boolean("false") === true.
  is_major: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

const CreateTournamentSchema = z.object({
  name: z.string().min(3).max(120),
  format: z.enum(['SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'LIECHTENSTEIN']),
  mode: z.enum(['ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'BPT', 'SFT', 'SLT']).optional(),
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
  // Welle 2 — Tournament mechanics
  rounds_count: z.number().int().min(3).max(6).optional(),
  playoff_format: z.enum(['NONE', 'TOP4', 'TOP8']).optional(),
  swiss_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  playoff_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  finale_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']).optional(),
  map_pool: z.array(z.string().min(1)).min(3).max(36).optional(),
  map_preset_config: z.record(z.string(), z.unknown()).nullable().optional(),
  faction_pool: z.array(z.string().min(1)).max(24).optional(),
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
  // Welle 2 — Tournament mechanics
  rounds_count: z.number().int().min(3).max(6).optional(),
  playoff_format: z.enum(['NONE', 'TOP4', 'TOP8']).optional(),
  swiss_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  playoff_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  finale_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']).optional(),
  map_pool: z.array(z.string().min(1)).min(3).max(36).optional(),
  map_preset_config: z.record(z.string(), z.unknown()).nullable().optional(),
  is_major: z.boolean().optional(),
  // Fields added for full edit-form support
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN', 'LIECHTENSTEIN']).optional(),
  mode: z.enum(['BPT', 'SFT', 'SLT']).optional(),
  has_third_place_match: z.boolean().optional(),
  counts_for_leaderboard: z.boolean().optional(),
  faction_pool: z.array(z.string().min(1)).optional(),
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
    const { page, pageSize, status, is_major, date_from, date_to } = parsed.data;
    const skip = (page - 1) * pageSize;

    const result = await cached(
      fastify.redis,
      cacheKey('tournaments:list', { page, pageSize, status, is_major, date_from, date_to }),
      async () => {
        const where = {
          deleted_at: null,
          visibility: 'PUBLIC' as const,
          ...(status !== undefined ? { status } : {}),
          ...(is_major !== undefined ? { is_major } : {}),
          ...(date_from !== undefined || date_to !== undefined
            ? {
                start_date: {
                  ...(date_from !== undefined ? { gte: new Date(date_from) } : {}),
                  ...(date_to !== undefined ? { lte: new Date(date_to) } : {}),
                },
              }
            : {}),
        };
        const [tournaments, total] = await Promise.all([
          fastify.prisma.tournament.findMany({
            where,
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
          fastify.prisma.tournament.count({ where }),
        ]);
        const data = tournaments.map(({ _count, ...rest }) => ({
          ...rest,
          participantCount: _count.participants,
        }));
        return { data, total, page, pageSize };
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

      // Validate map_pool IDs exist in the master pool
      if (data.map_pool && data.map_pool.length > 0) {
        const existingMaps = await fastify.prisma.map.findMany({
          where: { id: { in: data.map_pool }, deleted_at: null },
          select: { id: true },
        });
        if (existingMaps.length !== data.map_pool.length) {
          const foundIds = existingMaps.map((m) => m.id);
          const missing = data.map_pool.filter((id) => !foundIds.includes(id));
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: `Map IDs not found in master pool: ${missing.join(', ')}`,
            statusCode: 422,
          });
        }
      }

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
          // Welle 2
          rounds_count: data.rounds_count,
          playoff_format: data.playoff_format,
          swiss_match_format: data.swiss_match_format,
          playoff_match_format: data.playoff_match_format,
          finale_match_format: data.finale_match_format,
          map_decision_mode: data.map_decision_mode,
          map_preset_config: data.map_preset_config != null ? (data.map_preset_config as Prisma.InputJsonValue) : undefined,
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
          rounds_count: true,
          playoff_format: true,
          swiss_match_format: true,
          playoff_match_format: true,
          finale_match_format: true,
          map_decision_mode: true,
          map_preset_config: true,
          created_at: true,
        },
      });

      // Persist map pool snapshot
      if (data.map_pool && data.map_pool.length > 0) {
        await fastify.prisma.tournamentMapPool.createMany({
          data: data.map_pool.map((mapId) => ({
            tournament_id: tournament.id,
            map_id: mapId,
          })),
          skipDuplicates: true,
        });
      }

      // Persist faction allowlist (empty = all factions allowed)
      if (data.faction_pool && data.faction_pool.length > 0) {
        await fastify.prisma.tournamentFactionAllowlist.createMany({
          data: data.faction_pool.map((factionId) => ({
            tournament_id: tournament.id,
            faction_id: factionId,
          })),
          skipDuplicates: true,
        });
      }

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

  // ---------------------------------------------------------------------------
  // GET /api/tournaments/calendar
  // JSON calendar feed — array of CalendarTournament.
  // NOTE: registered BEFORE /:slug so static path wins.
  // ---------------------------------------------------------------------------
  fastify.get('/api/tournaments/calendar', async (request, reply) => {
    const parsed = CalendarQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { status, is_major, date_from, date_to } = parsed.data;

    const result = await cached(
      fastify.redis,
      cacheKey('tournaments:calendar', { status, is_major, date_from, date_to }),
      async () => {
        const where = {
          deleted_at: null,
          ...(status !== undefined ? { status } : {}),
          ...(is_major !== undefined ? { is_major } : {}),
          ...(date_from !== undefined || date_to !== undefined
            ? {
                start_date: {
                  ...(date_from !== undefined ? { gte: new Date(date_from) } : {}),
                  ...(date_to !== undefined ? { lte: new Date(date_to) } : {}),
                },
              }
            : {}),
        };

        const tournaments = await fastify.prisma.tournament.findMany({
          where,
          select: {
            id: true,
            slug: true,
            name: true,
            start_date: true,
            format: true,
            is_major: true,
            status: true,
            timezone: true,
            rounds_count: true,
          },
          orderBy: { start_date: 'asc' },
        });

        return tournaments.map((t) => {
          const roundsCount = t.rounds_count ?? 5;
          const endDate = new Date(t.start_date.getTime() + roundsCount * 2 * 60 * 60 * 1000);
          const entry = {
            id: t.id,
            slug: t.slug,
            name: t.name,
            start_date: t.start_date.toISOString(),
            end_date: endDate.toISOString(),
            format: t.format,
            is_major: t.is_major,
            status: t.status,
            timezone: t.timezone,
          };
          // Validate shape matches CalendarTournamentSchema
          return CalendarTournamentSchema.parse(entry);
        });
      },
      { ttlSeconds: 60 },
    );

    return result;
  });

  // ---------------------------------------------------------------------------
  // GET /api/tournaments/calendar.ics
  // iCal feed — same filters as /calendar.
  // NOTE: registered BEFORE /:slug so static path wins.
  // ---------------------------------------------------------------------------
  fastify.get('/api/tournaments/calendar.ics', async (request, reply) => {
    const parsed = CalendarQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { status, is_major, date_from, date_to } = parsed.data;

    const where = {
      deleted_at: null,
      ...(status !== undefined ? { status } : {}),
      ...(is_major !== undefined ? { is_major } : {}),
      ...(date_from !== undefined || date_to !== undefined
        ? {
            start_date: {
              ...(date_from !== undefined ? { gte: new Date(date_from) } : {}),
              ...(date_to !== undefined ? { lte: new Date(date_to) } : {}),
            },
          }
        : {}),
    };

    const tournaments = await fastify.prisma.tournament.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        start_date: true,
        is_major: true,
        rounds_count: true,
      },
      orderBy: { start_date: 'asc' },
    });

    const cal = ical({
      name: "RizzOtto's Arena Tournaments",
      prodId: { company: "RizzOtto's Arena", product: 'tournaments' },
    });

    for (const t of tournaments) {
      const roundsCount = t.rounds_count ?? 5;
      const endDate = new Date(t.start_date.getTime() + roundsCount * 2 * 60 * 60 * 1000);
      cal.createEvent({
        id: t.id,
        start: t.start_date,
        end: endDate,
        summary: t.name,
        description: `Geschätztes Ende (start + rounds*2h). Major: ${t.is_major ? 'ja' : 'nein'}`,
        url: `https://rizzotto.gg/tournaments/${t.slug}`,
      });
    }

    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition', 'inline; filename="rizzotto-tournaments.ics"');
    return reply.send(cal.toString());
  });

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
        playoff_format: true,
        swiss_match_format: true,
        playoff_match_format: true,
        finale_match_format: true,
        map_decision_mode: true,
        map_preset_config: true,
        created_at: true,
        updated_at: true,
        organizer: { select: { id: true, username: true, avatar_url: true } },
        _count: {
          select: { participants: { where: { deleted_at: null } } },
        },
        faction_allowlist: { select: { faction_id: true } },
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

    const { _count, faction_allowlist, ...rest } = tournament;
    return {
      ...rest,
      participantCount: _count.participants,
      faction_allowlist: faction_allowlist.map((fa) => fa.faction_id),
    };
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
          format: true,
          mode: true,
          name: true,
          description: true,
          rules: true,
          discord_link: true,
          start_date: true,
          timezone: true,
          registration_deadline: true,
          max_participants: true,
          visibility: true,
          map_preset_config: true,
          has_third_place_match: true,
          counts_for_leaderboard: true,
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

      const { status: newStatus, map_pool: newMapPool, faction_pool: newFactionPool, ...rest } = parsed.data;

      // Validate map_pool change: only allowed before tournament starts (DRAFT or ANNOUNCED)
      if (newMapPool !== undefined) {
        const allowedStatuses = ['DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED'];
        if (!allowedStatuses.includes(tournament.status)) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: 'Map pool can only be changed before the tournament starts',
            statusCode: 422,
          });
        }

        // Validate all map IDs exist
        const existingMaps = await fastify.prisma.map.findMany({
          where: { id: { in: newMapPool }, deleted_at: null },
          select: { id: true },
        });
        if (existingMaps.length !== newMapPool.length) {
          const foundIds = existingMaps.map((m) => m.id);
          const missing = newMapPool.filter((id) => !foundIds.includes(id));
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: `Map IDs not found in master pool: ${missing.join(', ')}`,
            statusCode: 422,
          });
        }
      }

      // Validate draft-only fields: format, mode, visibility, faction_pool
      // These can only be changed while the tournament is still in DRAFT.
      if (tournament.status !== 'DRAFT') {
        const draftOnlyAttempted = (['format', 'mode', 'visibility'] as const).filter(
          (f) => rest[f] !== undefined,
        );
        if (draftOnlyAttempted.length > 0) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: `${draftOnlyAttempted.map((f) => `"${f}"`).join(', ')} can only be changed while the tournament is in draft`,
            statusCode: 422,
          });
        }
        if (newFactionPool !== undefined) {
          return reply.code(422).send({
            error: 'UnprocessableEntity',
            message: '"faction_pool" can only be changed while the tournament is in draft',
            statusCode: 422,
          });
        }
      }

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

      // map_pool and faction_pool are relations — exclude from the scalar updateData loop
      const RELATION_FIELDS = new Set(['map_pool', 'faction_pool']);

      for (const [key, value] of Object.entries(fieldMap)) {
        if (value !== undefined && !RELATION_FIELDS.has(key)) {
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

      // Update map pool snapshot (replace all rows)
      if (newMapPool !== undefined) {
        await fastify.prisma.tournamentMapPool.deleteMany({
          where: { tournament_id: tournament.id },
        });
        if (newMapPool.length > 0) {
          await fastify.prisma.tournamentMapPool.createMany({
            data: newMapPool.map((mapId) => ({
              tournament_id: tournament.id,
              map_id: mapId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Update faction allowlist (replace all rows)
      if (newFactionPool !== undefined) {
        await fastify.prisma.tournamentFactionAllowlist.deleteMany({
          where: { tournament_id: tournament.id },
        });
        if (newFactionPool.length > 0) {
          await fastify.prisma.tournamentFactionAllowlist.createMany({
            data: newFactionPool.map((factionId) => ({
              tournament_id: tournament.id,
              faction_id: factionId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Notify Discord when tournament is published (OPEN_REGISTRATION)
      if (newStatus === 'OPEN_REGISTRATION') {
        const fullTournament = await fastify.prisma.tournament.findUnique({
          where: { id: tournament.id },
          select: { id: true, name: true, slug: true, start_date: true },
        });
        if (fullTournament) {
          notifyTournamentAnnounce(fullTournament).catch((err) => {
            request.log.warn({ err }, 'Discord tournament announce failed (non-fatal)');
          });
        }
      }

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

  // ---------------------------------------------------------------------------
  // GET /api/tournaments/:slug/maps
  // Public — returns the map pool snapshot for a specific tournament.
  // Cached 5 min (maps are immutable after tournament start).
  // ---------------------------------------------------------------------------
  fastify.get('/api/tournaments/:slug/maps', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true },
    });

    if (!tournament) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Tournament "${slug}" not found`,
        statusCode: 404,
      });
    }

    return cached(
      fastify.redis,
      cacheKey('tournament:maps', { tournamentId: tournament.id }),
      async () => {
        const pool = await fastify.prisma.tournamentMapPool.findMany({
          where: { tournament_id: tournament.id },
          select: {
            map: {
              select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                image_url: true,
              },
            },
          },
          orderBy: { map: { name: 'asc' } },
        });

        return { data: pool.map((p) => p.map) };
      },
      { ttlSeconds: 300 },
    );
  });
};

export default tournamentRoutes;
