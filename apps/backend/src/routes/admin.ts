import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { TournamentFormat, Prisma } from '@rizzotto/db';
import { ImportLogListResponseSchema } from '@rizzotto/types';
import { cached, cacheKey, invalidate } from '../lib/cache.js';
import { advanceAutoSwissRound } from '../lib/auto-swiss-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Faction sigil uploads go to the frontend's public/icons/factions/ directory
const FACTION_ICONS_DIR = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'icons', 'factions');

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const AuditLogQuerySchema = PaginationSchema.extend({
  entity_type: z.string().optional(),
  actor_id: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const FactionWinRatesQuerySchema = z.object({
  season: z.string().uuid().optional(),
  format: z.enum(['SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'LIECHTENSTEIN']).optional(),
  mode: z.enum(['ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'BPT', 'SFT', 'SLT']).optional(),
  period: z.enum(['last_30d', 'last_90d', 'season']).optional(),
});


const DropoffFunnelQuerySchema = z.object({
  tournament_id: z.string().uuid().optional(),
  season: z.string().uuid().optional(),
});

const PickBanStatsQuerySchema = z.object({
  season: z.string().uuid().optional(),
  entity: z.enum(['maps', 'factions']).default('factions'),
});

const MapCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).optional(),
  image_url: z.string().url().optional(),
});

const MapUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  image_url: z.string().url().optional(),
});

const FactionCreateSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(200),
  race: z.string().min(1).max(100),
  category: z.enum(['ORDER', 'DESTRUCTION', 'CHAOS_GODS', 'UNDEAD', 'DEFAULT']),
  color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  display_order: z.number().int().min(1),
  icon_url: z.string().optional(),
});

const FactionUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  race: z.string().min(1).max(100).optional(),
  category: z.enum(['ORDER', 'DESTRUCTION', 'CHAOS_GODS', 'UNDEAD', 'DEFAULT']).optional(),
  color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  display_order: z.number().int().min(1).optional(),
});

const ConfigValueSchema = z.object({
  // Accept any JSON-serializable value
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
  ]),
});

const RepairAutoSwissSchema = z.object({
  playoff_format: z.enum(['TOP2', 'TOP4', 'TOP8']),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply requireRole('ADMIN') to all routes in this scope
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole('ADMIN'));

  // GET /api/admin/audit-log
  fastify.get('/api/admin/audit-log', async (request, reply) => {
    const parsed = AuditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { page, pageSize, entity_type, actor_id } = parsed.data;

    const where: Record<string, unknown> = {};
    if (entity_type) where.entity_type = entity_type;
    if (actor_id) where.actor_id = actor_id;

    const [total, entries] = await Promise.all([
      fastify.prisma.auditLog.count({ where }),
      fastify.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, username: true, avatar_url: true } },
        },
      }),
    ]);

    return {
      entries: entries.map((e) => ({
        id: e.id,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        action: e.action,
        actor_id: e.actor?.id ?? null,
        actor_username: e.actor?.username ?? null,
        actor_avatar_url: e.actor?.avatar_url ?? null,
        old_value: e.old_value,
        new_value: e.new_value,
        created_at: e.created_at.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });

  // GET /api/admin/stats — aggregate KPIs (cached 60s)
  fastify.get('/api/admin/stats', async () => {
    return cached(
      fastify.redis,
      cacheKey('admin:stats', {}),
      async () => {
        const [
          activeUsers,
          totalTournaments,
          activeTournaments,
          completedTournaments,
          totalGames,
          activeSeason,
          queueDepth,
          activeOpenPlayMatches,
          scheduledAccepted,
        ] = await Promise.all([
          fastify.prisma.user.count({ where: { deleted_at: null } }),
          fastify.prisma.tournament.count({ where: { deleted_at: null } }),
          fastify.prisma.tournament.count({ where: { deleted_at: null, status: { in: ['ONGOING', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED'] } } }),
          fastify.prisma.tournament.count({ where: { status: 'COMPLETED' } }),
          // Games — not Matches — are the statistical unit: a Match is just a
          // container (Bo3, challenge series). Count actually-played games.
          fastify.prisma.matchGame.count({ where: { status: 'COMPLETED', match: { deleted_at: null } } }),
          fastify.prisma.season.findFirst({ where: { is_active: true } }),
          fastify.redis ? fastify.redis.llen('rizzotto:queue:open_play') : Promise.resolve(0),
          fastify.prisma.match.count({ where: { type: 'OPEN_PLAY', status: 'ONGOING', deleted_at: null } }),
          fastify.prisma.scheduledMatchup.count({ where: { status: 'ACCEPTED', match_id: null } }),
        ]);

        let topFactions: Array<{ faction_id: string; name: string; matches_played: number; wins: number }> = [];
        if (activeSeason) {
          const top = await fastify.prisma.factionStats.findMany({
            where: { season_id: activeSeason.id },
            orderBy: { matches_played: 'desc' },
            take: 5,
            include: { faction: { select: { id: true, name: true } } },
          });
          topFactions = top.map((f) => ({
            faction_id: f.faction_id,
            name: f.faction.name,
            matches_played: f.matches_played,
            wins: f.wins,
          }));
        }

        return {
          activeUsers,
          tournaments: { total: totalTournaments, active: activeTournaments, completed: completedTournaments },
          gamesPlayed: totalGames,
          currentSeason: activeSeason?.name ?? null,
          topFactions: topFactions.map((f) => ({
            faction_id: f.faction_id,
            faction_name: f.name,
            pick_count: f.matches_played,
          })),
          openPlay: {
            queueDepth,
            activeMatches: activeOpenPlayMatches,
            scheduledAccepted,
          },
        };
      },
      { ttlSeconds: 60 },
    );
  });


  // POST /api/admin/users/:id/ban
  fastify.post<{ Params: { id: string } }>('/api/admin/users/:id/ban', async (request, reply) => {
    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, deleted_at: true } });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    if (user.deleted_at) return reply.code(409).send({ error: 'Conflict', message: 'User already banned', statusCode: 409 });

    const banned = await fastify.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { deleted_at: new Date() },
        select: { id: true, username: true, deleted_at: true },
      });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: u.id,
          action: 'BAN',
          actor_id: request.user.sub,
          old_value: { deleted_at: null },
          new_value: { deleted_at: u.deleted_at?.toISOString() ?? null },
        },
      });
      return u;
    });

    // Invalidate role cache so banned user can't keep using stale role
    if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
    await invalidate(fastify.redis, cacheKey('admin:stats', {}));

    return { id: banned.id, username: banned.username, deleted_at: banned.deleted_at?.toISOString() ?? null };
  });

  // DELETE /api/admin/users/:id/ban — unban
  fastify.delete<{ Params: { id: string } }>('/api/admin/users/:id/ban', async (request, reply) => {
    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true, deleted_at: true } });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    if (!user.deleted_at) return reply.code(409).send({ error: 'Conflict', message: 'User not banned', statusCode: 409 });

    const unbanned = await fastify.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { deleted_at: null },
        select: { id: true, username: true, deleted_at: true },
      });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: u.id,
          action: 'UNBAN',
          actor_id: request.user.sub,
          old_value: { deleted_at: user.deleted_at?.toISOString() },
          new_value: { deleted_at: null },
        },
      });
      return u;
    });

    if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
    await invalidate(fastify.redis, cacheKey('admin:stats', {}));

    return { id: unbanned.id, username: unbanned.username };
  });

  // PATCH /api/admin/users/:id/role — change a user's role
  fastify.patch<{ Params: { id: string }; Body: { role: string } }>(
    '/api/admin/users/:id/role',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          properties: { role: { type: 'string', enum: ['USER', 'HOST', 'MODERATOR', 'ADMIN'] } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.params.id;
      const newRole = request.body.role as 'USER' | 'HOST' | 'MODERATOR' | 'ADMIN';

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true },
      });
      if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
      if (user.role === newRole) return reply.send({ id: user.id, role: user.role });

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: userId },
          data: { role: newRole },
          select: { id: true, username: true, role: true },
        });
        await tx.auditLog.create({
          data: {
            entity_type: 'User',
            entity_id: u.id,
            action: 'ROLE_CHANGE',
            actor_id: request.user.sub,
            old_value: { role: user.role },
            new_value: { role: newRole },
          },
        });
        return u;
      });

      if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
      return { id: updated.id, username: updated.username, role: updated.role };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/admin/stats/faction-winrates
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/stats/faction-winrates', async (request, reply) => {
    const parsed = FactionWinRatesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { season: seasonId, format, mode, period } = parsed.data;

    // Resolve season
    let resolvedSeasonId: string | null = null;
    if (seasonId) {
      const s = await fastify.prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } });
      if (!s) return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      resolvedSeasonId = s.id;
    } else {
      const s = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      resolvedSeasonId = s?.id ?? null;
    }

    return cached(
      fastify.redis,
      cacheKey('admin:faction-winrates', { seasonId: resolvedSeasonId, format: format ?? null, mode: mode ?? null, period: period ?? null }),
      async () => {
        // Date filter for period
        let dateFilter: Date | undefined;
        if (period === 'last_30d') {
          dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        } else if (period === 'last_90d') {
          dateFilter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        }

        // Build tournament filter
        const tournamentWhere: Record<string, unknown> = { deleted_at: null };
        if (format) tournamentWhere.format = format;
        if (mode) tournamentWhere.mode = mode;

        const matchWhere: Record<string, unknown> = {
          status: 'COMPLETED',
          deleted_at: null,
        };
        if (dateFilter) matchWhere.updated_at = { gte: dateFilter };

        // If season filter: restrict to tournaments in that season
        if (resolvedSeasonId) {
          // Tournaments count_for_leaderboard with active_season — join via TournamentResult
          // Simpler approach: use FactionStats which is already per-season
          const stats = await fastify.prisma.factionStats.findMany({
            where: { season_id: resolvedSeasonId },
            include: { faction: { select: { id: true, name: true } } },
          });
          return stats.map((s) => ({
            faction_id: s.faction_id,
            slug: s.faction_id,
            name: s.faction.name,
            wins: s.wins,
            losses: s.losses,
            win_rate: s.matches_played > 0 ? s.wins / s.matches_played : 0,
            sample_size: s.matches_played,
          }));
        }

        // No season: aggregate from Match records directly
        const factions = await fastify.prisma.faction.findMany({
          select: { id: true, name: true },
        });

        const results = await Promise.all(
          factions.map(async (faction) => {
            const [wins, losses] = await Promise.all([
              fastify.prisma.match.count({
                where: {
                  ...matchWhere,
                  winner_id: { not: null },
                  OR: [
                    { player1_faction_id: faction.id, winner_id: { not: null } },
                    { player2_faction_id: faction.id, winner_id: { not: null } },
                  ],
                  AND: [
                    {
                      OR: [
                        { player1_faction_id: faction.id },
                        { player2_faction_id: faction.id },
                      ],
                    },
                  ],
                },
              }),
              fastify.prisma.match.count({
                where: {
                  ...matchWhere,
                  OR: [
                    { player1_faction_id: faction.id },
                    { player2_faction_id: faction.id },
                  ],
                },
              }),
            ]);

            const total = losses; // count is total matches where faction appeared
            const actualWins = wins;
            return {
              faction_id: faction.id,
              slug: faction.id,
              name: faction.name,
              wins: actualWins,
              losses: Math.max(0, total - actualWins),
              win_rate: total > 0 ? actualWins / total : 0,
              sample_size: total,
            };
          }),
        );

        return results.sort((a, b) => b.win_rate - a.win_rate);
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/stats/dropoff-funnel
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/stats/dropoff-funnel', async (request, reply) => {
    const parsed = DropoffFunnelQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { tournament_id, season: seasonId } = parsed.data;

    return cached(
      fastify.redis,
      cacheKey('admin:dropoff-funnel', { tournamentId: tournament_id ?? null, seasonId: seasonId ?? null }),
      async () => {
        // Build base filter
        const tournamentFilter: Record<string, unknown> = { deleted_at: null };
        if (tournament_id) {
          tournamentFilter.id = tournament_id;
        } else if (seasonId) {
          // Tournaments whose results link to this season
          const results = await fastify.prisma.tournamentResult.findMany({
            where: { season_id: seasonId },
            select: { tournament_id: true },
            distinct: ['tournament_id'],
          });
          tournamentFilter.id = { in: results.map((r) => r.tournament_id) };
        }

        const tournaments = await fastify.prisma.tournament.findMany({
          where: tournamentFilter,
          select: { id: true },
        });
        const tournamentIds = tournaments.map((t) => t.id);

        if (tournamentIds.length === 0) {
          return { registered: 0, checked_in: 0, played_first_round: 0, played_final_round: 0, finished: 0 };
        }

        const [registered, checkedIn, finishedResults] = await Promise.all([
          fastify.prisma.tournamentParticipant.count({
            where: { tournament_id: { in: tournamentIds }, deleted_at: null },
          }),
          fastify.prisma.tournamentParticipant.count({
            where: { tournament_id: { in: tournamentIds }, status: 'CHECKED_IN', deleted_at: null },
          }),
          fastify.prisma.tournamentResult.count({
            where: { tournament_id: { in: tournamentIds } },
          }),
        ]);

        // Played first round: matches in round 1 that are COMPLETED
        const playedFirstRound = await fastify.prisma.match.count({
          where: {
            tournament_id: { in: tournamentIds },
            round: 1,
            status: 'COMPLETED',
            deleted_at: null,
          },
        });

        // Played final round: matches in the highest round that are COMPLETED
        const lastRoundAgg = await fastify.prisma.match.aggregate({
          where: { tournament_id: { in: tournamentIds }, status: 'COMPLETED', deleted_at: null },
          _max: { round: true },
        });
        const lastRound = lastRoundAgg._max.round;
        const playedFinalRound = lastRound != null
          ? await fastify.prisma.match.count({
              where: {
                tournament_id: { in: tournamentIds },
                round: lastRound,
                status: 'COMPLETED',
                deleted_at: null,
              },
            })
          : 0;

        return {
          registered,
          checked_in: checkedIn,
          played_first_round: playedFirstRound,
          played_final_round: playedFinalRound,
          finished: finishedResults,
        };
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/stats/pickban-stats
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/stats/pickban-stats', async (request, reply) => {
    const parsed = PickBanStatsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { season: seasonId, entity } = parsed.data;

    let resolvedSeasonId: string | null = null;
    if (seasonId) {
      const s = await fastify.prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } });
      if (!s) return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      resolvedSeasonId = s.id;
    } else {
      const s = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      resolvedSeasonId = s?.id ?? null;
    }

    return cached(
      fastify.redis,
      cacheKey('admin:pickban-stats', { seasonId: resolvedSeasonId, entity }),
      async () => {
        if (entity === 'factions') {
          // From FactionStats
          const stats = await fastify.prisma.factionStats.findMany({
            where: resolvedSeasonId ? { season_id: resolvedSeasonId } : {},
            include: { faction: { select: { id: true, name: true } } },
          });

          const totalMatches = stats.reduce((acc, s) => acc + s.matches_played, 0);
          const totalBans = stats.reduce((acc, s) => acc + s.ban_count, 0);

          return stats.map((s) => ({
            entity_id: s.faction_id,
            slug: s.faction_id,
            name: s.faction.name,
            picks: s.pick_count,
            bans: s.ban_count,
            pick_rate: totalMatches > 0 ? s.pick_count / totalMatches : 0,
            ban_rate: totalBans > 0 ? s.ban_count / totalBans : 0,
            win_when_picked: s.pick_count > 0 ? s.wins / s.pick_count : 0,
          })).sort((a, b) => b.picks - a.picks);
        }

        // entity === 'maps'
        const decisions = await fastify.prisma.matchMapDecision.findMany({
          select: {
            bans_top: true,
            bans_bottom: true,
            picked_map_id: true,
            game: { select: { match: { select: { winner_id: true, status: true } } } },
          },
          where: { game: { match: { status: 'COMPLETED', deleted_at: null } } },
        });

        const maps = await fastify.prisma.map.findMany({
          where: { deleted_at: null },
          select: { id: true, slug: true, name: true },
        });

        const mapStats = new Map<string, { picks: number; bans: number; wins: number }>();
        for (const m of maps) {
          mapStats.set(m.id, { picks: 0, bans: 0, wins: 0 });
        }

        for (const d of decisions) {
          for (const ban of [...d.bans_top, ...d.bans_bottom]) {
            const s = mapStats.get(ban);
            if (s) s.bans++;
          }
          if (d.picked_map_id) {
            const s = mapStats.get(d.picked_map_id);
            if (s) {
              s.picks++;
              if (d.game.match.winner_id) s.wins++;
            }
          }
        }

        const totalPicks = [...mapStats.values()].reduce((acc, s) => acc + s.picks, 0);
        const totalBans = [...mapStats.values()].reduce((acc, s) => acc + s.bans, 0);

        return maps.map((m) => {
          const s = mapStats.get(m.id) ?? { picks: 0, bans: 0, wins: 0 };
          return {
            entity_id: m.id,
            slug: m.slug,
            name: m.name,
            picks: s.picks,
            bans: s.bans,
            pick_rate: totalPicks > 0 ? s.picks / totalPicks : 0,
            ban_rate: totalBans > 0 ? s.bans / totalBans : 0,
            win_when_picked: s.picks > 0 ? s.wins / s.picks : 0,
          };
        }).sort((a, b) => b.picks - a.picks);
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // Map CRUD — /api/admin/maps
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/maps', async (request, reply) => {
    const parsed = z.object({
      include_deleted: z.coerce.boolean().default(false),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const maps = await fastify.prisma.map.findMany({
      where: parsed.data.include_deleted ? {} : { deleted_at: null },
      orderBy: { name: 'asc' },
    });

    return { maps };
  });

  fastify.post('/api/admin/maps', async (request, reply) => {
    const parsed = MapCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { name, description, image_url } = parsed.data;

    // Auto-generate slug if not provided
    const slug = parsed.data.slug ?? name
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check slug uniqueness
    const existing = await fastify.prisma.map.findUnique({ where: { slug } });
    if (existing) {
      return reply.code(409).send({ error: 'Conflict', message: `Map with slug "${slug}" already exists`, statusCode: 409 });
    }

    const map = await fastify.prisma.map.create({
      data: { name, slug, description: description ?? null, image_url: image_url ?? null },
    });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Map', entity_id: map.id, action: 'create', actor_id: request.user.sub, new_value: { name, slug } },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'maps:*');
    return reply.code(201).send(map);
  });

  fastify.patch<{ Params: { id: string } }>('/api/admin/maps/:id', async (request, reply) => {
    const { id } = request.params;
    const parsed = MapUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const existing = await fastify.prisma.map.findUnique({ where: { id }, select: { id: true, deleted_at: true } });
    if (!existing || existing.deleted_at) {
      return reply.code(404).send({ error: 'NotFound', message: 'Map not found', statusCode: 404 });
    }

    const map = await fastify.prisma.map.update({
      where: { id },
      data: parsed.data,
    });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Map', entity_id: id, action: 'update', actor_id: request.user.sub, new_value: parsed.data },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'maps:*');
    return map;
  });

  fastify.delete<{ Params: { id: string } }>('/api/admin/maps/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await fastify.prisma.map.findUnique({ where: { id }, select: { id: true, deleted_at: true } });
    if (!existing) {
      return reply.code(404).send({ error: 'NotFound', message: 'Map not found', statusCode: 404 });
    }
    if (existing.deleted_at) {
      return reply.code(409).send({ error: 'Conflict', message: 'Map already deleted', statusCode: 409 });
    }

    await fastify.prisma.map.update({ where: { id }, data: { deleted_at: new Date() } });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Map', entity_id: id, action: 'delete', actor_id: request.user.sub },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'maps:*');
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // Faction CRUD — /api/admin/factions
  // -------------------------------------------------------------------------

  fastify.post('/api/admin/factions', async (request, reply) => {
    const parsed = FactionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const existing = await fastify.prisma.faction.findUnique({ where: { id: parsed.data.id } });
    if (existing) {
      return reply.code(409).send({ error: 'Conflict', message: `Faction with id "${parsed.data.id}" already exists`, statusCode: 409 });
    }

    // Check display_order uniqueness
    const orderConflict = await fastify.prisma.faction.findUnique({ where: { display_order: parsed.data.display_order } });
    if (orderConflict) {
      return reply.code(409).send({ error: 'Conflict', message: `display_order ${parsed.data.display_order} already taken by "${orderConflict.id}"`, statusCode: 409 });
    }

    const faction = await fastify.prisma.faction.create({ data: parsed.data });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Faction', entity_id: faction.id, action: 'create', actor_id: request.user.sub, new_value: parsed.data },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'factions:*');
    return reply.code(201).send(faction);
  });

  fastify.patch<{ Params: { id: string } }>('/api/admin/factions/:id', async (request, reply) => {
    const { id } = request.params;
    const parsed = FactionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const existing = await fastify.prisma.faction.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });
    }

    // Check display_order conflict when updating
    if (parsed.data.display_order !== undefined) {
      const orderConflict = await fastify.prisma.faction.findUnique({ where: { display_order: parsed.data.display_order } });
      if (orderConflict && orderConflict.id !== id) {
        return reply.code(409).send({ error: 'Conflict', message: `display_order ${parsed.data.display_order} already taken by "${orderConflict.id}"`, statusCode: 409 });
      }
    }

    const faction = await fastify.prisma.faction.update({ where: { id }, data: parsed.data });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Faction', entity_id: id, action: 'update', actor_id: request.user.sub, new_value: parsed.data },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'factions:*');
    return faction;
  });

  // POST /api/admin/factions/:id/sigil — multipart image upload
  fastify.post<{ Params: { id: string } }>('/api/admin/factions/:id/sigil', async (request, reply) => {
    const { id } = request.params;

    const faction = await fastify.prisma.faction.findUnique({ where: { id }, select: { id: true } });
    if (!faction) {
      return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'BadRequest', message: 'No file uploaded', statusCode: 400 });
    }

    const mime = data.mimetype;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(mime)) {
      return reply.code(400).send({ error: 'BadRequest', message: 'Only PNG, JPEG, WebP, AVIF allowed', statusCode: 400 });
    }

    const ext = mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.avif';
    const filename = `${id}${ext}`;

    // Ensure directory exists
    await fs.mkdir(FACTION_ICONS_DIR, { recursive: true });
    const destPath = path.join(FACTION_ICONS_DIR, filename);

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    await fs.writeFile(destPath, Buffer.concat(chunks));

    const iconUrl = `/icons/factions/${filename}`;
    await fastify.prisma.faction.update({ where: { id }, data: { icon_url: iconUrl } });

    await fastify.prisma.auditLog.create({
      data: { entity_type: 'Faction', entity_id: id, action: 'sigil_upload', actor_id: request.user.sub, new_value: { icon_url: iconUrl } },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'factions:*');
    return { id, icon_url: iconUrl };
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/import-log
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/import-log', async (request, reply) => {
    const QuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      source: z.string().optional(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { page, pageSize, source } = parsed.data;

    const where = source ? { source } : {};

    const [total, rows] = await Promise.all([
      fastify.prisma.importLog.count({ where }),
      fastify.prisma.importLog.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const entries = rows.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      records_imported: r.records_imported,
      error_message: r.error_message ?? null,
      started_at: r.started_at.toISOString(),
      finished_at: r.finished_at != null ? r.finished_at.toISOString() : null,
    }));

    const response = ImportLogListResponseSchema.parse({ entries, total, page, pageSize });
    return response;
  });

  // -------------------------------------------------------------------------
  // AdminConfig CRUD — /api/admin/config
  // -------------------------------------------------------------------------

  fastify.get('/api/admin/config/all', async () => {
    return cached(
      fastify.redis,
      cacheKey('admin:config:all', {}),
      async () => {
        const configs = await fastify.prisma.adminConfig.findMany({ orderBy: { key: 'asc' } });
        return { configs };
      },
      { ttlSeconds: 60 },
    );
  });

  fastify.get<{ Params: { key: string } }>('/api/admin/config/:key', async (request, reply) => {
    const { key } = request.params;
    const config = await fastify.prisma.adminConfig.findUnique({ where: { key } });
    if (!config) {
      return reply.code(404).send({ error: 'NotFound', message: `Config key "${key}" not found`, statusCode: 404 });
    }
    return config;
  });

  fastify.put<{ Params: { key: string } }>('/api/admin/config/:key', async (request, reply) => {
    const { key } = request.params;
    const parsed = ConfigValueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const config = await fastify.prisma.adminConfig.upsert({
      where: { key },
      create: { key, value: parsed.data.value as never, updated_by: request.user.sub },
      update: { value: parsed.data.value as never, updated_by: request.user.sub },
    });

    await fastify.prisma.auditLog.create({
      data: {
        entity_type: 'AdminConfig',
        entity_id: key,
        action: 'config_update',
        actor_id: request.user.sub,
        new_value: { value: parsed.data.value as string },
      },
    });

    if (fastify.redis) await invalidate(fastify.redis, 'admin:config:*');
    return config;
  });

  // POST /api/admin/tournaments/:id/repair-auto-swiss
  // One-time repair endpoint: fixes a tournament that was incorrectly created as
  // SINGLE_ELIMINATION instead of AUTO_SWISS, then generates the playoff bracket.
  // Safe: never deletes matches — only updates phase + tournament fields, then
  // inserts new playoff matches. Returns 409 if playoffs already exist.
  fastify.post('/api/admin/tournaments/:id/repair-auto-swiss', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = RepairAutoSwissSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { playoff_format } = parsed.data;

    const tournament = await fastify.prisma.tournament.findUnique({
      where: { id, deleted_at: null },
      select: { id: true, status: true, slug: true },
    });
    if (!tournament) {
      return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
    }
    if (tournament.status !== 'ONGOING') {
      return reply.code(400).send({ error: 'BadRequest', message: `Tournament must be ONGOING (current: ${tournament.status})`, statusCode: 400 });
    }

    const allMatches = await fastify.prisma.match.findMany({
      where: { tournament_id: id, deleted_at: null },
      select: { id: true, phase: true, status: true, round: true },
    });

    if (allMatches.length === 0) {
      return reply.code(400).send({ error: 'BadRequest', message: 'No matches found for this tournament', statusCode: 400 });
    }

    const playoffMatches = allMatches.filter((m) => m.phase?.startsWith('PLAYOFF'));
    if (playoffMatches.length > 0) {
      return reply.code(409).send({ error: 'Conflict', message: `Playoff matches already exist (${playoffMatches.length} found)`, statusCode: 409 });
    }

    const pendingMatches = allMatches.filter((m) => m.status !== 'COMPLETED' && m.status !== 'BYE');
    if (pendingMatches.length > 0) {
      return reply.code(422).send({ error: 'UnprocessableEntity', message: `${pendingMatches.length} match(es) are not yet completed`, statusCode: 422 });
    }

    const swissRound = Math.max(...allMatches.map((m) => m.round));

    // Fix match phases: null → SWISS (does not touch any match results/scores)
    const { count: updatedPhases } = await fastify.prisma.match.updateMany({
      where: { tournament_id: id, deleted_at: null, phase: null },
      data: { phase: 'SWISS' },
    });

    // Fix tournament: set correct format, playoff config, and rounds_count
    await fastify.prisma.tournament.update({
      where: { id },
      data: {
        format: TournamentFormat.AUTO_SWISS,
        playoff_format,
        rounds_count: swissRound,
      },
    });

    // Trigger playoff generation via the standard auto-swiss service
    await advanceAutoSwissRound(fastify.prisma, id);

    const newPlayoffs = await fastify.prisma.match.findMany({
      where: { tournament_id: id, deleted_at: null, phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] } },
      select: { id: true, phase: true },
    });

    await fastify.prisma.auditLog.create({
      data: {
        entity_type: 'Tournament',
        entity_id: id,
        action: 'admin_repair_auto_swiss',
        actor_id: request.user.sub,
        new_value: { playoff_format, swissRounds: swissRound, updatedPhases, matchesGenerated: newPlayoffs.length },
      },
    });

    return reply.code(200).send({
      fixed: true,
      swissRounds: swissRound,
      playoffFormat: playoff_format,
      updatedPhases,
      matchesGenerated: newPlayoffs.length,
    });
  });
  // POST /api/admin/tournaments/:slug/add-late — add a participant after tournament start
  fastify.post('/api/admin/tournaments/:slug/add-late', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const tournament = await fastify.prisma.tournament.findUnique({
      where: { slug, deleted_at: null },
      select: { id: true, status: true },
    });
    if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
    if (tournament.status !== 'ONGOING') {
      return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Tournament must be ONGOING to add a late joiner', statusCode: 422 });
    }

    const user = await fastify.prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, username: true } });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });

    const existing = await fastify.prisma.tournamentParticipant.findUnique({
      where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: parsed.data.userId } },
      select: { status: true },
    });
    if (existing) {
      return reply.code(409).send({ error: 'Conflict', message: `${user.username} is already a participant (status: ${existing.status})`, statusCode: 409 });
    }

    const participant = await fastify.prisma.tournamentParticipant.create({
      data: { tournament_id: tournament.id, user_id: parsed.data.userId, status: 'CHECKED_IN' },
      select: { id: true, status: true, user: { select: { id: true, username: true } } },
    });

    return reply.code(201).send({ participant });
  });

  // GET /api/admin/matches — paginated match list with leaderboard status
  fastify.get('/api/admin/matches', async (request, reply) => {
    const parsed = z.object({
      page:           z.coerce.number().int().min(1).default(1),
      limit:          z.coerce.number().int().min(1).max(100).default(50),
      voided:         z.enum(['true', 'false']).optional(),
      tournamentSlug: z.string().optional(),
      search:         z.string().max(50).optional(),
    }).safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const { page, limit, voided, tournamentSlug, search } = parsed.data;
    const skip = (page - 1) * limit;

    const baseWhere: Prisma.MatchWhereInput = {
      deleted_at: null,
      status: { in: ['COMPLETED', 'FORFEIT', 'BYE', 'CANCELLED'] },
      ...(voided === 'true'  && { counts_for_leaderboard: false }),
      ...(voided === 'false' && { counts_for_leaderboard: true  }),
      ...(tournamentSlug     && { tournament: { slug: tournamentSlug } }),
      ...(search && search.length >= 2 && {
        OR: [
          { player1: { username: { contains: search, mode: 'insensitive' } } },
          { player2: { username: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      fastify.prisma.match.findMany({
        where: baseWhere,
        include: {
          tournament: { select: { name: true, slug: true, format: true } },
          player1:    { select: { id: true, username: true } },
          player2:    { select: { id: true, username: true } },
          winner:     { select: { id: true, username: true } },
          games:      { select: { id: true, replay_url: true }, take: 1 },
        },
        orderBy: { played_at: 'desc' },
        skip,
        take: limit,
      }),
      fastify.prisma.match.count({ where: baseWhere }),
    ]);

    return reply.code(200).send({
      matches: rows.map((m) => ({
        id: m.id,
        round: m.round,
        matchNumber: m.match_number,
        status: m.status,
        result: m.result ?? null,
        countsForLeaderboard: m.counts_for_leaderboard,
        playedAt: m.played_at?.toISOString() ?? null,
        tournament: m.tournament ? { name: m.tournament.name, slug: m.tournament.slug, format: m.tournament.format } : null,
        player1: m.player1 ? { id: m.player1.id, username: m.player1.username } : null,
        player2: m.player2 ? { id: m.player2.id, username: m.player2.username } : null,
        winner:  m.winner  ? { id: m.winner.id,  username: m.winner.username  } : null,
        hasReplay: m.games.some((g) => !!g.replay_url),
      })),
      total,
      page,
      limit,
    });
  });
  // PATCH /api/admin/matches/:matchId/swap-player — replace one player in a PENDING match
  fastify.patch('/api/admin/matches/:matchId/swap-player', async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const parsed = z.object({
      oldPlayerId: z.string().uuid(),
      newPlayerId: z.string().uuid(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

    const match = await fastify.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, status: true, player1_id: true, player2_id: true },
    });
    if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
    if (match.status !== 'PENDING') return reply.code(409).send({ error: 'Conflict', message: 'Can only swap players in PENDING matches', statusCode: 409 });

    const { oldPlayerId, newPlayerId } = parsed.data;
    let updateData: { player1_id?: string; player2_id?: string };
    if (match.player1_id === oldPlayerId) updateData = { player1_id: newPlayerId };
    else if (match.player2_id === oldPlayerId) updateData = { player2_id: newPlayerId };
    else return reply.code(400).send({ error: 'BadRequest', message: 'oldPlayerId is not in this match', statusCode: 400 });

    await fastify.prisma.$transaction(async (tx) => {
      await tx.match.update({ where: { id: matchId }, data: updateData });
      // Keep MatchMapDecision and MatchFactionMatrix in sync — they persist
      // top_player_id/bottom_player_id at decision-start time and are not
      // automatically updated when match.player1_id/player2_id changes.
      await tx.matchMapDecision.updateMany({
        where: { game: { match_id: matchId }, top_player_id: oldPlayerId },
        data: { top_player_id: newPlayerId },
      });
      await tx.matchMapDecision.updateMany({
        where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId },
        data: { bottom_player_id: newPlayerId },
      });
      await tx.matchFactionMatrix.updateMany({
        where: { game: { match_id: matchId }, top_player_id: oldPlayerId },
        data: { top_player_id: newPlayerId },
      });
      await tx.matchFactionMatrix.updateMany({
        where: { game: { match_id: matchId }, bottom_player_id: oldPlayerId },
        data: { bottom_player_id: newPlayerId },
      });
    });
    return reply.code(200).send({ ok: true });
  });

  // DELETE /api/admin/matches/:matchId — soft-delete a match (sets deleted_at)
  fastify.delete('/api/admin/matches/:matchId', async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const match = await fastify.prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
    if (!match) return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
    await fastify.prisma.match.update({ where: { id: matchId }, data: { deleted_at: new Date() } });
    return reply.code(200).send({ ok: true });
  });

  // POST /api/admin/tournaments/:slug/create-match — add a manual PENDING Swiss match
  fastify.post('/api/admin/tournaments/:slug/create-match', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = z.object({
      player1Id: z.string().uuid(),
      player2Id: z.string().uuid(),
      round: z.number().int().min(1),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true, status: true },
    });
    if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });

    const { round, player1Id, player2Id } = parsed.data;
    const agg = await fastify.prisma.match.aggregate({
      where: { tournament_id: tournament.id, round },
      _max: { match_number: true },
    });
    const nextMatchNumber = (agg._max.match_number ?? 0) + 1;

    const match = await fastify.prisma.match.create({
      data: {
        tournament_id: tournament.id,
        round,
        match_number: nextMatchNumber,
        player1_id: player1Id,
        player2_id: player2Id,
        status: 'PENDING',
        phase: 'SWISS',
      },
      select: { id: true, round: true, match_number: true },
    });
    return reply.code(201).send({ match });
  });

};

export default adminRoutes;
