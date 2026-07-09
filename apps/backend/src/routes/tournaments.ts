import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Prisma } from '@rizzotto/db';
import { z } from 'zod';
import ical from 'ical-generator';
import { generateSlug, validateStatusTransition, TournamentStatus, canManageTournament } from '../lib/tournament-utils.js';
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

// Map decision modes that draw from the shared tournament map pool. Host-preset
// modes define their maps per round instead, so the shared-pool minimum does
// not apply to them.
const POOL_MAP_MODES = new Set(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'RANDOM_PICK_BAN']);

function matchFormatGames(fmt?: string): number {
  if (fmt === 'BO3') return 3;
  if (fmt === 'BO5') return 5;
  return 1;
}

/**
 * Worst-case number of games a single player can play in the tournament — i.e.
 * the map-pool size needed so that one player never repeats a map
 * (RANDOM_NO_REPEAT). Exact for Swiss/Liechtenstein (rounds known); estimated
 * for elimination / round-robin from max_participants (defaults when unset).
 */
function maxPlayerGames(data: {
  format?: string;
  rounds_count?: number;
  playoff_format?: string;
  max_participants?: number | null;
  swiss_match_format?: string;
  playoff_match_format?: string;
  finale_match_format?: string;
}): number {
  const swissGames = matchFormatGames(data.swiss_match_format);
  const playoffGames = matchFormatGames(data.playoff_match_format);
  const finaleGames = matchFormatGames(data.finale_match_format);
  const participants = data.max_participants ?? 0;
  const playoffExtra =
    data.playoff_format === 'TOP4'
      ? playoffGames + finaleGames
      : data.playoff_format === 'TOP8'
        ? 2 * playoffGames + finaleGames
        : 0;
  switch (data.format) {
    case 'SWISS':
    case 'LIECHTENSTEIN':
    case 'BALANCED_LIECHTENSTEIN':
      return (data.rounds_count ?? 5) * swissGames + playoffExtra;
    case 'ROUND_ROBIN':
      return (participants > 1 ? participants - 1 : 7) * swissGames + playoffExtra;
    case 'SINGLE_ELIMINATION':
      return (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    case 'DOUBLE_ELIMINATION':
      return 2 * (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    default:
      return (data.rounds_count ?? 5) * swissGames;
  }
}

/**
 * Enforce the shared map-pool minimum only for pool-based modes (host-preset
 * modes define maps per round). RANDOM_NO_REPEAT needs enough maps so no player
 * repeats a map across their games; other pool modes only need to cover the
 * longest single match. Skipped when map_pool is not part of the request.
 */
function refineMapPool(
  data: {
    format?: string;
    rounds_count?: number;
    playoff_format?: string;
    max_participants?: number | null;
    map_decision_mode?: string;
    map_pool?: string[];
    swiss_match_format?: string;
    playoff_match_format?: string;
    finale_match_format?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.map_pool === undefined) return;
  const mode = data.map_decision_mode ?? 'RANDOM_PICK_BAN';
  if (!POOL_MAP_MODES.has(mode)) return;
  const min =
    mode === 'RANDOM_NO_REPEAT'
      ? Math.max(3, maxPlayerGames(data))
      : Math.max(
          3,
          matchFormatGames(data.swiss_match_format),
          matchFormatGames(data.playoff_match_format),
          matchFormatGames(data.finale_match_format),
        );
  if (data.map_pool.length < min) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['map_pool'],
      message: `Map pool must have at least ${min} maps for this map decision mode.`,
    });
  }
}

const CreateTournamentSchema = z.object({
  name: z.string().min(3).max(120),
  format: z.enum(['SWISS', 'AUTO_SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'LIECHTENSTEIN', 'BALANCED_LIECHTENSTEIN']),
  mode: z.enum(['ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'BPT', 'SFT', 'SLT', 'MATRIX', 'TWO_D_THREE', 'FREE_PICK']).optional(),
  start_date: z.string().datetime(),
  timezone: z.string().min(1).max(64),
  max_participants: z.number().int().min(2).max(512).optional(),
  registration_deadline: z.string().datetime().optional(),
  rules: z.string().max(20000).optional(),
  discord_link: z.string().url().optional(),
  stream_url: z.string().url().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  counts_for_leaderboard: z.boolean().optional(),
  is_major: z.boolean().optional(),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  standard_rules_enabled: z.boolean().optional(),
  restrictions: z.string().max(20000).optional(),
  // Welle 2 — Tournament mechanics
  rounds_count: z.number().int().min(3).max(8).optional(),
  playoff_format: z.enum(['NONE', 'TOP2', 'TOP4', 'TOP8']).optional(),
  auto_sizing: z.boolean().optional(),
  auto_advance: z.boolean().optional(),
  allow_late_join_requests: z.boolean().optional(),
  swiss_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  playoff_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  finale_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']).optional(),
  map_pool: z.array(z.string().min(1)).max(36).optional(),
  map_preset_config: z.record(z.string(), z.unknown()).nullable().optional(),
  faction_pool: z.array(z.string().min(1)).max(24).optional(),
  restricted_factions: z.array(z.string().min(1)).max(24).optional(),
}).superRefine(refineMapPool);

const PatchTournamentSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  rules: z.string().max(20000).optional(),
  standard_rules_enabled: z.boolean().optional(),
  restrictions: z.string().max(20000).optional(),
  discord_link: z.string().url().optional().nullable(),
  stream_url: z.string().url().optional().nullable(),
  start_date: z.string().datetime().optional(),
  timezone: z.string().min(1).max(64).optional(),
  registration_deadline: z.string().datetime().optional().nullable(),
  max_participants: z.number().int().min(2).max(512).optional().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  status: z.enum(['DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED']).optional(),
  draft_enabled: z.boolean().optional(),
  draft_preset_id: z.string().uuid().nullable().optional(),
  // Welle 2 — Tournament mechanics
  rounds_count: z.number().int().min(3).max(8).optional(),
  playoff_format: z.enum(['NONE', 'TOP2', 'TOP4', 'TOP8']).optional(),
  auto_sizing: z.boolean().optional(),
  auto_advance: z.boolean().optional(),
  allow_late_join_requests: z.boolean().optional(),
  swiss_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  playoff_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  finale_match_format: z.enum(['BO1', 'BO3', 'BO5']).optional(),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']).optional(),
  map_pool: z.array(z.string().min(1)).max(36).optional(),
  map_preset_config: z.record(z.string(), z.unknown()).nullable().optional(),
  is_major: z.boolean().optional(),
  // Fields added for full edit-form support
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN', 'LIECHTENSTEIN', 'BALANCED_LIECHTENSTEIN']).optional(),
  mode: z.enum(['BPT', 'SFT', 'SLT', 'MATRIX', 'TWO_D_THREE', 'FREE_PICK']).optional(),
  has_third_place_match: z.boolean().optional(),
  counts_for_leaderboard: z.boolean().optional(),
  faction_pool: z.array(z.string().min(1)).optional(),
  restricted_factions: z.array(z.string().min(1)).optional(),
})
  .superRefine(refineMapPool)
  .refine((d) => Object.keys(d).length > 0, { message: 'Body must contain at least one field' });

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

    // Optional auth: identify the viewer so a host or co-host (and staff) can see
    // their own unpublished drafts in the normal list. Anonymous → published only.
    let viewerId: string | null = null;
    let isStaff = false;
    try {
      await request.jwtVerify();
      viewerId = request.user.sub;
      isStaff = request.user.role === 'ADMIN' || request.user.role === 'MODERATOR';
    } catch {
      /* anonymous viewer — sees only published public tournaments */
    }
    const viewerKey = isStaff ? 'staff' : (viewerId ?? 'anon');

    const result = await cached(
      fastify.redis,
      cacheKey('tournaments:list', { page, pageSize, status, is_major, date_from, date_to, viewer: viewerKey }),
      async () => {
        const dateFilter =
          date_from !== undefined || date_to !== undefined
            ? {
                start_date: {
                  ...(date_from !== undefined ? { gte: new Date(date_from) } : {}),
                  ...(date_to !== undefined ? { lte: new Date(date_to) } : {}),
                },
              }
            : {};
        // Everyone sees published PUBLIC tournaments; a signed-in host/co-host also
        // sees their own (any status, incl. DRAFT); staff see everything.
        const visibility = isStaff
          ? {}
          : {
              OR: [
                { visibility: 'PUBLIC' as const, status: { not: 'DRAFT' as const } },
                ...(viewerId
                  ? [{ host_id: viewerId }, { co_hosts: { some: { user_id: viewerId } } }]
                  : []),
              ],
            };
        const where = {
          deleted_at: null,
          ...(status !== undefined ? { status } : {}),
          ...(is_major !== undefined ? { is_major } : {}),
          ...dateFilter,
          ...visibility,
        };
        const [tournaments, total] = await Promise.all([
          fastify.prisma.tournament.findMany({
            where,
            select: {
              id: true,
              slug: true,
              poster_url: true,
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
              rounds_count: true,
              host: { select: { id: true, username: true, avatar_url: true } },
              _count: { select: { participants: { where: { deleted_at: null } } } },
              faction_allowlist: { select: { faction: { select: { name: true } } } },
            },
            orderBy: { start_date: 'desc' },
            skip,
            take: pageSize,
          }),
          fastify.prisma.tournament.count({ where }),
        ]);
        const data = tournaments.map(({ _count, faction_allowlist, ...rest }) => ({
          ...rest,
          participantCount: _count.participants,
          faction_allowlist: faction_allowlist.map((fa) => fa.faction.name),
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
    { preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')] },
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

      const isAutoSwiss = data.format === 'AUTO_SWISS';
      const isBalanced = data.format === 'BALANCED_LIECHTENSTEIN';
      // Balanced Liechtenstein auto-sizes its round count + playoff size from the
      // check-in count at start (applyBalancedStartConfig), unless the host opts
      // out via auto_sizing=false for a fixed-round tournament. Auto-sizing
      // defaults ON for Balanced. Match format is host-configurable (unlike Auto
      // Swiss, which forces BO1). Its playoff bracket is always per-division, so
      // the stored playoff_format is only a cosmetic "playoffs exist" flag.
      // Map decision stays host-configurable for Balanced (unlike Auto Swiss).
      const balancedAutoSized = isBalanced && (data.auto_sizing ?? true);
      const autoSized = isAutoSwiss || balancedAutoSized;

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
          stream_url: data.stream_url,
          counts_for_leaderboard: data.counts_for_leaderboard ?? true,
          is_major: data.is_major ?? false,
          draft_enabled: data.draft_enabled ?? false,
          draft_preset_id: data.draft_preset_id ?? null,
          description: data.description,
          standard_rules_enabled: data.standard_rules_enabled ?? false,
          restrictions: data.restrictions ?? '',
          host_id: request.user.sub,
          // Welle 2
          rounds_count: autoSized ? undefined : data.rounds_count,
          playoff_format: autoSized ? undefined : isBalanced ? 'TOP4' : data.playoff_format,
          // #37: opt-in auto-sizing / auto-advancement (any format). Balanced
          // defaults auto-sizing ON; every other format defaults OFF.
          auto_sizing: isBalanced ? (data.auto_sizing ?? true) : (data.auto_sizing ?? false),
          auto_advance: data.auto_advance ?? false,
          allow_late_join_requests: data.allow_late_join_requests ?? false,
          swiss_match_format: isAutoSwiss ? 'BO1' : data.swiss_match_format,
          playoff_match_format: isAutoSwiss ? 'BO1' : data.playoff_match_format,
          finale_match_format: isAutoSwiss ? 'BO1' : (data.finale_match_format ?? (data.format === 'DOUBLE_ELIMINATION' ? 'BO3' : undefined)),
          map_decision_mode: isAutoSwiss ? 'RANDOM_PICK_BAN' : data.map_decision_mode,
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
          host_id: true,
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

      // Persist restricted factions (games with these factions excluded from leaderboard)
      if (data.restricted_factions && data.restricted_factions.length > 0) {
        await fastify.prisma.tournamentRestrictedFaction.createMany({
          data: data.restricted_factions.map((factionId) => ({
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

    // Optional auth — read the user if a valid cookie is present (for can_manage).
    let authedUser: { sub: string; role: string } | null = null;
    try {
      await request.jwtVerify();
      authedUser = { sub: request.user.sub, role: request.user.role };
    } catch {
      // unauthenticated — fine for public tournaments
    }

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: {
        id: true,
        slug: true,
        poster_url: true,
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
        standard_rules_enabled: true,
        restrictions: true,
        discord_link: true,
        stream_url: true,
        draft_enabled: true,
        counts_for_leaderboard: true,
        is_major: true,
        host_id: true,
        rounds_count: true,
        playoff_format: true,
        has_third_place_match: true,
        swiss_match_format: true,
        playoff_match_format: true,
        finale_match_format: true,
        auto_sizing: true,
        auto_advance: true,
        allow_late_join_requests: true,
        map_decision_mode: true,
        map_preset_config: true,
        created_at: true,
        updated_at: true,
        host: { select: { id: true, username: true, avatar_url: true } },
        _count: {
          select: { participants: { where: { deleted_at: null } } },
        },
        faction_allowlist: { select: { faction_id: true } },
        restricted_factions: { select: { faction_id: true } },
        map_pool: {
          select: {
            map: { select: { id: true, slug: true, name: true, description: true, image_url: true } },
          },
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

    // Whether the viewer may manage this tournament (host, co-host, mod, admin).
    const can_manage = authedUser
      ? await canManageTournament(fastify.prisma, tournament.id, authedUser.sub, authedUser.role)
      : false;

    // PRIVATE tournaments are only visible to those who can manage them.
    if (tournament.visibility === 'PRIVATE' && !can_manage) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'This tournament is private',
        statusCode: 403,
      });
    }

    const { _count, faction_allowlist, restricted_factions, map_pool, ...rest } = tournament;
    return {
      ...rest,
      can_manage,
      participantCount: _count.participants,
      faction_allowlist: faction_allowlist.map((fa) => fa.faction_id),
      restricted_factions: restricted_factions.map((rf) => rf.faction_id),
      map_pool: map_pool.map((entry) => entry.map),
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
          host_id: true,
          status: true,
          format: true,
          mode: true,
          name: true,
          description: true,
          rules: true,
          standard_rules_enabled: true,
          restrictions: true,
          discord_link: true,
          stream_url: true,
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
      if (!(await canManageTournament(fastify.prisma, tournament.id, user.sub, user.role))) {
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

      const { status: newStatus, map_pool: newMapPool, faction_pool: newFactionPool, restricted_factions: newRestrictedFactions, ...rest } = parsed.data;

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

      // map_pool, faction_pool and restricted_factions are relations — exclude from the scalar updateData loop
      const RELATION_FIELDS = new Set(['map_pool', 'faction_pool', 'restricted_factions']);

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

      // When counts_for_leaderboard changes, re-stamp all existing MatchGame rows
      // so the game-level flag stays consistent with the tournament setting.
      if ('counts_for_leaderboard' in changedNew) {
        await fastify.prisma.matchGame.updateMany({
          where: { match: { tournament_id: tournament.id } },
          data: { counts_for_leaderboard: changedNew.counts_for_leaderboard as boolean },
        });
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

      // Update restricted factions (replace all rows)
      if (newRestrictedFactions !== undefined) {
        await fastify.prisma.tournamentRestrictedFaction.deleteMany({
          where: { tournament_id: tournament.id },
        });
        if (newRestrictedFactions.length > 0) {
          await fastify.prisma.tournamentRestrictedFaction.createMany({
            data: newRestrictedFactions.map((factionId) => ({
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
        select: { id: true, host_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const user = request.user;
      if (!(await canManageTournament(fastify.prisma, tournament.id, user.sub, user.role))) {
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

  // ---------------------------------------------------------------------------
  // GET /api/users/eligible-owners — Admin: list HOST + ADMIN users for ownership transfer
  // ---------------------------------------------------------------------------
  fastify.get(
    '/api/users/eligible-owners',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')] },
    async (_request, reply) => {
      const users = await fastify.prisma.user.findMany({
        where: {
          role: { in: ['HOST', 'ADMIN'] },
          deleted_at: null,
        },
        select: { id: true, username: true, avatar_url: true, role: true },
        orderBy: { username: 'asc' },
      });
      return reply.send(users);
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/tournaments/:slug/transfer-owner — transfer tournament host
  // Access: current HOST of the tournament, MODERATOR, or ADMIN
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { slug: string }; Body: { new_host_id: string } }>(
    '/api/tournaments/:slug/transfer-owner',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['new_host_id'],
          properties: { new_host_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params;
      const { new_host_id } = request.body;
      const { sub: userId, role } = request.user;

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, host_id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }

      const isOwner = tournament.host_id === userId;
      const isModOrAdmin = role === 'MODERATOR' || role === 'ADMIN';
      if (!isOwner && !isModOrAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the tournament host, moderators, or admins can transfer ownership', statusCode: 403 });
      }

      // Verify target user exists and can host tournaments
      const targetUser = await fastify.prisma.user.findUnique({
        where: { id: new_host_id },
        select: { id: true, role: true, deleted_at: true },
      });
      if (!targetUser || targetUser.deleted_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'Target user not found', statusCode: 404 });
      }
      if (targetUser.role !== 'HOST' && targetUser.role !== 'ADMIN') {
        return reply.code(400).send({ error: 'BadRequest', message: 'New host must have HOST or ADMIN role', statusCode: 400 });
      }

      await fastify.prisma.tournament.update({
        where: { id: tournament.id },
        data: { host_id: new_host_id },
      });

      await invalidate(fastify.redis, `tournament:${slug}`);

      return reply.send({ ok: true });
    },
  );

  // ---------------------------------------------------------------------------
  // Co-hosts — users who manage a tournament alongside the host (full host
  // parity via canManageTournament). Editing the roster itself stays with the
  // owner + MODERATOR/ADMIN, so a co-host can't seize control.
  // ---------------------------------------------------------------------------

  // Load tournament and assert the caller may edit its co-host roster.
  async function loadTournamentForRoster(
    slug: string,
    userId: string,
    role: string,
    reply: FastifyReply,
  ): Promise<{ id: string; host_id: string } | null> {
    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true, host_id: true },
    });
    if (!tournament) {
      reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      return null;
    }
    const isOwner = tournament.host_id === userId;
    const isModOrAdmin = role === 'MODERATOR' || role === 'ADMIN';
    if (!isOwner && !isModOrAdmin) {
      reply.code(403).send({ error: 'Forbidden', message: 'Only the tournament owner can manage co-hosts', statusCode: 403 });
      return null;
    }
    return tournament;
  }

  // GET co-host roster (any authenticated user may view it)
  fastify.get<{ Params: { slug: string } }>(
    '/api/tournaments/:slug/co-hosts',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug: request.params.slug, deleted_at: null },
        select: { id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      const hosts = await fastify.prisma.tournamentHost.findMany({
        where: { tournament_id: tournament.id },
        select: { user: { select: { id: true, username: true, avatar_url: true } } },
        orderBy: { user: { username: 'asc' } },
      });
      return reply.send(hosts.map((h) => h.user));
    },
  );

  // GET co-host candidates — owner + mod/admin user search to add
  fastify.get<{ Params: { slug: string }; Querystring: { q?: string } }>(
    '/api/tournaments/:slug/co-host-candidates',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const tournament = await loadTournamentForRoster(request.params.slug, userId, role, reply);
      if (!tournament) return;
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return reply.send([]);
      const existing = await fastify.prisma.tournamentHost.findMany({
        where: { tournament_id: tournament.id },
        select: { user_id: true },
      });
      const excludeIds = [tournament.host_id, ...existing.map((h) => h.user_id)];
      const users = await fastify.prisma.user.findMany({
        where: {
          deleted_at: null,
          id: { notIn: excludeIds },
          username: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, username: true, avatar_url: true },
        orderBy: { username: 'asc' },
        take: 10,
      });
      return reply.send(users);
    },
  );

  // POST add co-host — owner + mod/admin
  fastify.post<{ Params: { slug: string }; Body: { user_id: string } }>(
    '/api/tournaments/:slug/co-hosts',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['user_id'],
          properties: { user_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const tournament = await loadTournamentForRoster(request.params.slug, userId, role, reply);
      if (!tournament) return;
      const { user_id } = request.body;
      if (user_id === tournament.host_id) {
        return reply.code(400).send({ error: 'BadRequest', message: 'The owner is already a host', statusCode: 400 });
      }
      const target = await fastify.prisma.user.findUnique({
        where: { id: user_id },
        select: { id: true, deleted_at: true, username: true, avatar_url: true },
      });
      if (!target || target.deleted_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
      }
      await fastify.prisma.tournamentHost.upsert({
        where: { tournament_id_user_id: { tournament_id: tournament.id, user_id } },
        create: { tournament_id: tournament.id, user_id },
        update: {},
      });
      return reply.send({ id: target.id, username: target.username, avatar_url: target.avatar_url });
    },
  );

  // DELETE remove co-host — owner + mod/admin
  fastify.delete<{ Params: { slug: string; userId: string } }>(
    '/api/tournaments/:slug/co-hosts/:userId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const tournament = await loadTournamentForRoster(request.params.slug, userId, role, reply);
      if (!tournament) return;
      await fastify.prisma.tournamentHost.deleteMany({
        where: { tournament_id: tournament.id, user_id: request.params.userId },
      });
      return reply.send({ ok: true });
    },
  );
};

export default tournamentRoutes;
