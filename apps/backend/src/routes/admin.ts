import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { TournamentFormat, Prisma } from '@rizzotto/db';
import { ImportLogListResponseSchema } from '@rizzotto/types';
import { cached, cacheKey, invalidate } from '../lib/cache.js';
import { advanceAutoSwissRound } from '../lib/auto-swiss-service.js';
import { emitBracketUpdate } from '../lib/emit.js';
import { addLateParticipant, setParticipantFactionOp, createManualMatch } from '../lib/tournament-management.js';
import { recomputeFactionStats } from '../lib/recompute-faction-stats.js';
import { opponentShare, opponentModifier, MIN_WINS_FOR_ANTI_FARM, OPPONENT_SHARE_WARN } from '../lib/scoring-service.js';
import { getNonGuildMemberIds, isGuildLookupConfigured } from '../lib/discord-notify.js';
import {
  loadCalibrationQuestions,
  CalibrationQuestionsSchema,
  CALIBRATION_CONFIG_KEY,
} from '../lib/skill-classification-service.js';
import {
  CALIBRATION_QUESTIONS,
  questionnaireFloor,
  classify,
  BAND_NAMES,
  bandToLogOdds,
  skillToWinChance,
} from '../lib/skill-classification.js';
import { skillToBand } from '../lib/rating-model.js';
import { getRatingModel } from '../lib/rating-model-service.js';
import { getQueuePenaltyState, resetQueuePenaltyToWarned } from '../lib/queue-penalty.js';
import { publishChangelog } from '../lib/changelog-publish.js';

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

const QueueActivityQuerySchema = PaginationSchema.extend({
  user_id: z.string().uuid().optional(),
  event: z.enum(['JOIN', 'LEAVE', 'MATCH', 'CANCEL', 'WIN', 'LOSE', 'DRAW', 'WARNING', 'TIMEOUT']).optional(),
});

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const FactionWinRatesQuerySchema = z.object({
  season: z.string().uuid().optional(),
  format: z.enum(['SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'LIECHTENSTEIN', 'BALANCED_LIECHTENSTEIN']).optional(),
  mode: z.enum(['ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'BPT', 'SFT', 'SLT', 'MATRIX', 'TWO_D_THREE']).optional(),
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

  // GET /api/admin/game-audit — read-only scan of every COMPLETED game for data anomalies:
  // a draw, a missing faction, a mirror, a faction outside the tournament allowlist, an
  // SFT / Faction War game whose faction disagrees with the registered one, or an "official"
  // game sitting on a voided / cancelled match. Returns only flagged games (GameHistoryEntry
  // shape + an `issues` array) so the admin All Games table can render and fix them inline.
  fastify.get('/api/admin/game-audit', async (_request, reply) => {
    const games = await fastify.prisma.matchGame.findMany({
      where: { status: 'COMPLETED', match: { deleted_at: null, player1_id: { not: null }, player2_id: { not: null } } },
      select: {
        id: true,
        game_number: true,
        winner_id: true,
        player1_faction_id: true,
        player2_faction_id: true,
        played_at: true,
        replay_url: true,
        counts_for_leaderboard: true,
        map_decision: { select: { picked_map_id: true } },
        match: {
          select: {
            id: true,
            round: true,
            match_number: true,
            played_at: true,
            status: true,
            counts_for_leaderboard: true,
            player1_id: true,
            player2_id: true,
            source: true,
            player1: { select: { id: true, username: true, avatar_url: true } },
            player2: { select: { id: true, username: true, avatar_url: true } },
            tournament: { select: { id: true, name: true, slug: true, mode: true, faction_allowlist: { select: { faction_id: true } } } },
          },
        },
      },
      orderBy: { played_at: 'desc' },
    });

    // Registered factions per (tournament, user) for the SFT / Faction War mismatch check.
    const tournamentIds = [...new Set(games.map((g) => g.match.tournament?.id).filter((x): x is string => !!x))];
    const participants = tournamentIds.length
      ? await fastify.prisma.tournamentParticipant.findMany({
          where: { tournament_id: { in: tournamentIds }, deleted_at: null },
          select: { tournament_id: true, user_id: true, faction_id: true },
        })
      : [];
    const regFaction = new Map<string, string | null>();
    for (const p of participants) regFaction.set(`${p.tournament_id}:${p.user_id}`, p.faction_id);

    const flagged = games.flatMap((g) => {
      const t = g.match.tournament;
      const p1f = g.player1_faction_id;
      const p2f = g.player2_faction_id;
      const issues: string[] = [];

      if (g.winner_id === null) issues.push('draw');
      if (!p1f || !p2f) issues.push('missing_faction');
      if (p1f && p2f && p1f === p2f) issues.push('mirror');

      const allow = new Set((t?.faction_allowlist ?? []).map((a) => a.faction_id));
      if (allow.size > 0 && ((p1f && !allow.has(p1f)) || (p2f && !allow.has(p2f)))) issues.push('faction_not_allowed');

      if (t && (t.mode === 'SFT' || t.mode === 'FACTION_WAR')) {
        const r1 = g.match.player1_id ? regFaction.get(`${t.id}:${g.match.player1_id}`) : null;
        const r2 = g.match.player2_id ? regFaction.get(`${t.id}:${g.match.player2_id}`) : null;
        if ((r1 && p1f && r1 !== p1f) || (r2 && p2f && r2 !== p2f)) issues.push('sft_mismatch');
      }

      if (g.counts_for_leaderboard && (g.match.counts_for_leaderboard === false || g.match.status === 'CANCELLED')) {
        issues.push('official_but_void');
      }

      if (issues.length === 0) return [];
      return [{
        id: g.id,
        gameNumber: g.game_number,
        matchId: g.match.id,
        round: g.match.round,
        matchNumber: g.match.match_number,
        playedAt: (g.played_at ?? g.match.played_at)?.toISOString() ?? null,
        player1: g.match.player1 ?? null,
        player2: g.match.player2 ?? null,
        winnerId: g.winner_id,
        player1FactionId: p1f,
        player2FactionId: p2f,
        mapPickedId: g.map_decision?.picked_map_id ?? null,
        replayUrl: g.replay_url,
        countsForLeaderboard: g.counts_for_leaderboard,
        tournament: t ? { id: t.id, name: t.name, slug: t.slug } : undefined,
        matchSource: g.match.source ?? null,
        issues,
      }];
    });

    const mapIds = [...new Set(flagged.map((r) => r.mapPickedId).filter((x): x is string => !!x))];
    const maps = mapIds.length
      ? await fastify.prisma.map.findMany({ where: { id: { in: mapIds } }, select: { id: true, name: true } })
      : [];
    const mapById = new Map(maps.map((m) => [m.id, m.name]));

    return reply.code(200).send({
      total: flagged.length,
      games: flagged.map(({ mapPickedId, ...r }) => ({ ...r, mapName: mapPickedId ? (mapById.get(mapPickedId) ?? null) : null })),
    });
  });

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

  // GET /api/admin/queue-activity — persistent Open Play queue/match lifecycle log
  fastify.get('/api/admin/queue-activity', async (request, reply) => {
    const parsed = QueueActivityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { page, pageSize, user_id, event } = parsed.data;

    const where: Record<string, unknown> = {};
    if (user_id) where.user_id = user_id;
    if (event) where.event = event;

    const [total, entries, sourceGroups] = await Promise.all([
      fastify.prisma.queueActivityLog.count({ where }),
      fastify.prisma.queueActivityLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, username: true, avatar_url: true } },
          opponent: { select: { id: true, username: true, avatar_url: true } },
        },
      }),
      // #12: lifetime Open-Play match totals by source (Queue vs Availability-DM vs Challenge).
      fastify.prisma.match.groupBy({
        by: ['source'],
        where: { type: 'OPEN_PLAY', deleted_at: null },
        _count: { _all: true },
      }),
    ]);

    // #12: source lives on the match, not the log — look up the sources for the
    // match_ids on this page so each row can show where the pairing came from.
    const matchIds = [...new Set(entries.map((e) => e.match_id).filter((id): id is string => id != null))];
    const matchSources =
      matchIds.length > 0
        ? await fastify.prisma.match.findMany({
            where: { id: { in: matchIds } },
            select: { id: true, source: true },
          })
        : [];
    const sourceByMatchId = new Map(matchSources.map((m) => [m.id, m.source]));

    const matchSourceCounts = { QUEUE: 0, AVAILABILITY: 0, CHALLENGE: 0 };
    for (const g of sourceGroups) {
      if (g.source && g.source in matchSourceCounts) {
        matchSourceCounts[g.source as keyof typeof matchSourceCounts] = g._count._all;
      }
    }

    return {
      entries: entries.map((e) => ({
        id: e.id,
        event: e.event,
        user_id: e.user?.id ?? null,
        user_username: e.user?.username ?? null,
        user_avatar_url: e.user?.avatar_url ?? null,
        opponent_id: e.opponent?.id ?? null,
        opponent_username: e.opponent?.username ?? null,
        match_id: e.match_id,
        source: e.match_id ? (sourceByMatchId.get(e.match_id) ?? null) : null,
        level: e.level,
        created_at: e.created_at.toISOString(),
      })),
      matchSourceCounts,
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

  // GET /api/admin/users/:id/queue-penalty — #14 current Open Play queue penalty.
  fastify.get<{ Params: { id: string } }>('/api/admin/users/:id/queue-penalty', async (request, reply) => {
    if (!fastify.redis) return reply.code(200).send({ cooldownSec: 0, level: 0 });
    const state = await getQueuePenaltyState(fastify.redis, request.params.id, Date.now());
    return reply.code(200).send(state);
  });

  // DELETE /api/admin/users/:id/queue-penalty — #14 lift the cooldown + drop to level 1
  // ("warned"): not a full pardon, so the next offense goes straight to the short timeout.
  fastify.delete<{ Params: { id: string } }>('/api/admin/users/:id/queue-penalty', async (request, reply) => {
    if (fastify.redis) await resetQueuePenaltyToWarned(fastify.redis, request.params.id, Date.now());
    return reply.code(200).send({ ok: true });
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

  // DELETE /api/admin/users/:id/steam — reset Steam verification. Removes the
  // SteamLink so the user must re-link Steam on their next visit (keeps the account
  // and all history). Fixes "signed up with the wrong Steam account".
  fastify.delete<{ Params: { id: string } }>('/api/admin/users/:id/steam', async (request, reply) => {
    const userId = request.params.id;
    const link = await fastify.prisma.steamLink.findUnique({
      where: { user_id: userId },
      select: { steam_id: true, persona: true },
    });
    if (!link) return reply.code(404).send({ error: 'NotFound', message: 'User has no Steam link to reset', statusCode: 404 });

    await fastify.prisma.$transaction(async (tx) => {
      await tx.steamLink.delete({ where: { user_id: userId } });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: userId,
          action: 'STEAM_RESET',
          actor_id: request.user.sub,
          old_value: { steam_id: link.steam_id, persona: link.persona },
          new_value: { steam_id: null },
        },
      });
    });

    return { id: userId, steam_reset: true };
  });

  // PATCH /api/admin/users/:id — edit basic profile fields (admin correction).
  fastify.patch<{ Params: { id: string }; Body: { username?: string; email?: string | null; timezone?: string | null } }>(
    '/api/admin/users/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            email: { type: ['string', 'null'], maxLength: 255 },
            timezone: { type: ['string', 'null'], maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.params.id;
      const body = request.body;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, timezone: true },
      });
      if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });

      const data: { username?: string; email?: string | null; timezone?: string | null } = {};
      if (body.username !== undefined) data.username = body.username;
      if (body.email !== undefined) data.email = body.email;
      if (body.timezone !== undefined) data.timezone = body.timezone;
      if (Object.keys(data).length === 0) {
        return { id: user.id, username: user.username, email: user.email, timezone: user.timezone };
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: userId },
          data,
          select: { id: true, username: true, email: true, timezone: true },
        });
        await tx.auditLog.create({
          data: {
            entity_type: 'User',
            entity_id: u.id,
            action: 'USER_EDIT',
            actor_id: request.user.sub,
            old_value: { username: user.username, email: user.email, timezone: user.timezone },
            new_value: { username: u.username, email: u.email, timezone: u.timezone },
          },
        });
        return u;
      });

      return { id: updated.id, username: updated.username, email: updated.email, timezone: updated.timezone };
    },
  );

  // DELETE /api/admin/users/:id — delete a user by anonymizing + releasing them.
  // Rotates the unique discord_id to a tombstone (frees the real one for a fresh
  // signup), drops the Steam link, scrubs PII, and marks the account inactive —
  // while keeping their match/leaderboard rows intact (no FK breakage). For a clean
  // spam/test account this is effectively a delete; for a player their history
  // survives anonymized as "Deleted user".
  fastify.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (request, reply) => {
    const userId = request.params.id;
    if (userId === request.user.sub) {
      return reply.code(400).send({ error: 'BadRequest', message: 'You cannot delete your own account', statusCode: 400 });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, discord_id: true },
    });
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    if (user.discord_id.startsWith('deleted:')) {
      return reply.code(409).send({ error: 'Conflict', message: 'User is already deleted', statusCode: 409 });
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.steamLink.deleteMany({ where: { user_id: userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          discord_id: `deleted:${userId}`,
          username: 'Deleted user',
          email: null,
          avatar_url: null,
          deleted_at: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: userId,
          action: 'USER_DELETE',
          actor_id: request.user.sub,
          old_value: { username: user.username, discord_id: user.discord_id },
          new_value: { username: 'Deleted user', discord_id: `deleted:${userId}` },
        },
      });
    });

    if (fastify.redis) await invalidate(fastify.redis, `user:role:${userId}`);
    await invalidate(fastify.redis, cacheKey('admin:stats', {}));

    return { id: userId, deleted: true };
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/stats/faction-winrates
  // -------------------------------------------------------------------------

  // GET /api/admin/stats/skill-distribution — how many players sit in each skill
  // band (1 New … 5 Top). Derive-on-read: the hierarchical rating model is fitted +
  // cached once per season, then each player's gating band is a pure in-memory blend
  // of their questionnaire floor and (if any) their fitted general skill. Players with
  // neither a questionnaire nor fitted data are counted as "unclassified".
  fastify.get('/api/admin/stats/skill-distribution', async (request, reply) => {
    const parsed = z.object({ season: z.string().uuid().optional() }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    let resolvedSeasonId: string | null = null;
    if (parsed.data.season) {
      const s = await fastify.prisma.season.findUnique({ where: { id: parsed.data.season }, select: { id: true } });
      if (!s) return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      resolvedSeasonId = s.id;
    } else {
      const s = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      resolvedSeasonId = s?.id ?? null;
    }

    return cached(
      fastify.redis,
      cacheKey('admin:skill-distribution', { seasonId: resolvedSeasonId }),
      async () => {
        const [model, users, questions] = await Promise.all([
          resolvedSeasonId
            ? getRatingModel(fastify.prisma, fastify.redis, { seasonId: resolvedSeasonId, config: { hierarchical: true } })
            : Promise.resolve(null),
          fastify.prisma.user.findMany({ where: { deleted_at: null }, select: { id: true, calibration_answers: true } }),
          loadCalibrationQuestions(fastify.prisma),
        ]);

        // Split each band into players classified via the questionnaire vs by their
        // game data alone. Players with NEITHER a questionnaire nor fitted data are
        // NOT put in band 1 — they are counted separately as "unclassified".
        const withQuestionnaire = [0, 0, 0, 0, 0, 0]; // band → count with a questionnaire
        const dataOnly = [0, 0, 0, 0, 0, 0]; // band → count from games only (no questionnaire)
        let unclassified = 0;
        for (const u of users) {
          const answers = (u.calibration_answers as Record<string, string> | null) ?? {};
          const hasQ = Object.keys(answers).length > 0;
          const gs = model ? model.getGeneralSkill(u.id) : null;
          if (!hasQ && !gs) {
            unclassified++;
            continue;
          }
          const qFloor = questionnaireFloor(answers, questions);
          const { gatingBand } = classify(qFloor, { generalSkill: gs?.skill ?? null, stdError: gs?.se ?? null });
          if (hasQ) withQuestionnaire[gatingBand] = (withQuestionnaire[gatingBand] ?? 0) + 1;
          else dataOnly[gatingBand] = (dataOnly[gatingBand] ?? 0) + 1;
        }

        return {
          seasonId: resolvedSeasonId,
          total: users.length,
          unclassified,
          distribution: [1, 2, 3, 4, 5].map((band) => ({
            band,
            name: BAND_NAMES[band],
            withQuestionnaire: withQuestionnaire[band] ?? 0,
            dataOnly: dataOnly[band] ?? 0,
          })),
        };
      },
      { ttlSeconds: 300 },
    );
  });

  // GET /api/admin/reports/engagement — #17: two engagement-gap lists.
  //  (1) users who have NOT linked/verified Steam yet (can't be matched into
  //      Steam-gated play).
  //  (2) fully-verified users who have never completed a game (dormant — worth a
  //      nudge). "Never played" = no COMPLETED match as either player.
  fastify.get('/api/admin/reports/engagement', async () => {
    const [notSteamVerified, verifiedNeverPlayed] = await Promise.all([
      fastify.prisma.user.findMany({
        where: { deleted_at: null, steam_link: null },
        select: {
          id: true,
          username: true,
          email: true,
          created_at: true,
          last_login: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      fastify.prisma.user.findMany({
        where: {
          deleted_at: null,
          steam_link: { isNot: null },
          matches_as_player1: { none: { status: 'COMPLETED', deleted_at: null } },
          matches_as_player2: { none: { status: 'COMPLETED', deleted_at: null } },
        },
        select: {
          id: true,
          username: true,
          email: true,
          created_at: true,
          last_login: true,
          steam_link: { select: { persona: true, profile_url: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return {
      notSteamVerified: notSteamVerified.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        createdAt: u.created_at.toISOString(),
        lastLogin: u.last_login?.toISOString() ?? null,
      })),
      verifiedNeverPlayed: verifiedNeverPlayed.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        createdAt: u.created_at.toISOString(),
        lastLogin: u.last_login?.toISOString() ?? null,
        steamPersona: u.steam_link?.persona ?? null,
        steamProfileUrl: u.steam_link?.profile_url ?? null,
      })),
    };
  });

  // GET /api/admin/reports/not-in-discord — #47: fully-registered (Steam-verified)
  // users who are NOT members of the configured Discord guild — an invite list.
  // Requires DISCORD_GUILD_ID + bot token; returns { configured: false } otherwise.
  fastify.get('/api/admin/reports/not-in-discord', async () => {
    if (!(await isGuildLookupConfigured())) {
      return { configured: false, users: [] as unknown[] };
    }
    const users = await fastify.prisma.user.findMany({
      where: { deleted_at: null, steam_link: { isNot: null } },
      select: {
        id: true,
        username: true,
        email: true,
        created_at: true,
        last_login: true,
        discord_id: true,
      },
      orderBy: { username: 'asc' },
    });
    const notMembers = await getNonGuildMemberIds(
      users.map((u) => u.discord_id).filter((d): d is string => !!d),
    );
    if (!notMembers) return { configured: false, users: [] as unknown[] };
    return {
      configured: true,
      users: users
        .filter((u) => u.discord_id && notMembers.has(u.discord_id))
        .map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          createdAt: u.created_at.toISOString(),
          lastLogin: u.last_login?.toISOString() ?? null,
        })),
    };
  });

  // GET /api/admin/reports/underrated — #19: players whose DATA-based rating exceeds
  // their QUESTIONNAIRE-based rating (potentially stronger than they claimed). Sorted
  // by the gap, descending; NO threshold — the admin judges. Needs BOTH signals to
  // compare, so players lacking a questionnaire or lacking fitted data are omitted.
  fastify.get('/api/admin/reports/underrated', async (request, reply) => {
    const parsed = z.object({ season: z.string().uuid().optional() }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    let seasonId: string | null;
    if (parsed.data.season) {
      const s = await fastify.prisma.season.findUnique({ where: { id: parsed.data.season }, select: { id: true } });
      if (!s) return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      seasonId = s.id;
    } else {
      const s = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
      seasonId = s?.id ?? null;
    }

    const [model, users, questions] = await Promise.all([
      seasonId
        ? getRatingModel(fastify.prisma, fastify.redis, { seasonId, config: { hierarchical: true } })
        : Promise.resolve(null),
      fastify.prisma.user.findMany({
        where: { deleted_at: null },
        select: { id: true, username: true, calibration_answers: true },
      }),
      loadCalibrationQuestions(fastify.prisma),
    ]);

    const players = [];
    for (const u of users) {
      const answers = (u.calibration_answers as Record<string, string> | null) ?? {};
      if (Object.keys(answers).length === 0) continue; // need a self-claim to compare against
      const gs = model ? model.getGeneralSkill(u.id) : null;
      if (!gs) continue; // need fitted data to compare
      const qFloor = questionnaireFloor(answers, questions);
      const qSkill = bandToLogOdds(qFloor);
      const dataBand = skillToBand(gs.skill);
      // N9: only surface a genuine upward band jump (data band strictly above the
      // claimed/questionnaire band). Band-5 players are auto-excluded — no band is
      // higher, so they can never show a positive gap; and intra-band noise is dropped.
      if (dataBand <= qFloor) continue;
      players.push({
        id: u.id,
        username: u.username,
        questionnaireBand: qFloor,
        questionnaireBandName: BAND_NAMES[qFloor],
        dataBand,
        dataBandName: BAND_NAMES[dataBand],
        dataWinChance: skillToWinChance(gs.skill),
        generalSkillSe: gs.se,
        delta: gs.skill - qSkill, // >0 = data rates them above their claim
        // Confident overclaim: conservative data (GS − 2·SE) still lands above the claim.
        smurfSuspected: skillToBand(gs.skill - 2 * gs.se) > qFloor,
      });
    }
    players.sort((a, b) => b.delta - a.delta);
    return { seasonId, players };
  });

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

        // No season: aggregate game-level win rates directly from MatchGame rows
        // (games are the statistical unit — mirrors recomputeFactionStats' source set:
        // COMPLETED games on non-deleted matches, regardless of match container status).
        const tournamentFilter =
          format && mode
            ? Prisma.sql`AND m.tournament_id IN (SELECT id FROM "Tournament" WHERE deleted_at IS NULL AND format::text = ${format} AND mode::text = ${mode})`
            : format
              ? Prisma.sql`AND m.tournament_id IN (SELECT id FROM "Tournament" WHERE deleted_at IS NULL AND format::text = ${format})`
              : mode
                ? Prisma.sql`AND m.tournament_id IN (SELECT id FROM "Tournament" WHERE deleted_at IS NULL AND mode::text = ${mode})`
                : Prisma.empty;
        const dateClause = dateFilter ? Prisma.sql`AND mg.played_at >= ${dateFilter}` : Prisma.empty;

        const rows = await fastify.prisma.$queryRaw<
          Array<{ faction_id: string; name: string; wins: bigint; total: bigint }>
        >`
          SELECT
            f.id AS faction_id,
            f.name AS name,
            COUNT(mg.id) AS total,
            COUNT(CASE
              WHEN mg.winner_id IS NOT NULL AND (
                (mg.player1_faction_id = f.id AND mg.winner_id = m.player1_id) OR
                (mg.player2_faction_id = f.id AND mg.winner_id = m.player2_id)
              ) THEN 1 END) AS wins
          FROM "Faction" f
          JOIN "MatchGame" mg
            ON (mg.player1_faction_id = f.id OR mg.player2_faction_id = f.id)
            AND mg.status = 'COMPLETED'
          JOIN "Match" m
            ON mg.match_id = m.id AND m.deleted_at IS NULL
          WHERE TRUE
            ${tournamentFilter}
            ${dateClause}
          GROUP BY f.id, f.name
        `;

        return rows
          .map((r) => {
            const total = Number(r.total);
            const wins = Number(r.wins);
            return {
              faction_id: r.faction_id,
              slug: r.faction_id,
              name: r.name,
              wins,
              losses: Math.max(0, total - wins),
              win_rate: total > 0 ? wins / total : 0,
              sample_size: total,
            };
          })
          .sort((a, b) => b.win_rate - a.win_rate);
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/stats/games-over-time?days=30
  // Daily game counts split by source: tournament / ladder (queue) / challenge.
  // Game-level (a Bo3 counts as up to 3). Returns a continuous daily series so
  // the lines never jump over empty days.
  // -------------------------------------------------------------------------
  fastify.get('/api/admin/stats/games-over-time', async (request) => {
    const days = Math.min(
      365,
      Math.max(1, Math.floor(Number((request.query as { days?: string }).days) || 30)),
    );
    return cached(
      fastify.redis,
      cacheKey('admin:games-over-time', { days }),
      async () => {
        const since = new Date(Date.now() - (days - 1) * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await fastify.prisma.$queryRaw<
          { day: Date; tournament: bigint; ladder: bigint; challenge: bigint }[]
        >`
          SELECT date_trunc('day', mg.played_at)::date AS day,
            COUNT(*) FILTER (WHERE m.type = 'TOURNAMENT') AS tournament,
            COUNT(*) FILTER (WHERE m.type = 'OPEN_PLAY' AND m.source = 'QUEUE') AS ladder,
            COUNT(*) FILTER (WHERE m.type = 'OPEN_PLAY' AND m.source = 'CHALLENGE') AS challenge
          FROM "MatchGame" mg
          JOIN "Match" m ON m.id = mg.match_id
          WHERE mg.status = 'COMPLETED' AND mg.played_at IS NOT NULL AND mg.played_at >= ${since}
          GROUP BY day
          ORDER BY day
        `;
        const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
        const series: { day: string; tournament: number; ladder: number; challenge: number }[] = [];
        for (let i = 0; i < days; i++) {
          const key = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
          const r = byDay.get(key);
          series.push({
            day: key,
            tournament: r ? Number(r.tournament) : 0,
            ladder: r ? Number(r.ladder) : 0,
            challenge: r ? Number(r.challenge) : 0,
          });
        }
        return { data: series };
      },
      { ttlSeconds: 300 },
    );
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/recompute-faction-stats
  // Rebuilds FactionStats + MatchupStats for the active season from the COMPLETED
  // MatchGame rows. Run once after the games-only backfill migration, or any time to
  // clear historical incremental drift. Idempotent.
  // -------------------------------------------------------------------------
  fastify.post('/api/admin/recompute-faction-stats', async (_request, reply) => {
    const activeSeason = await fastify.prisma.season.findFirst({
      where: { is_active: true },
      select: { id: true },
    });
    if (!activeSeason) {
      return reply.code(422).send({ error: 'UnprocessableEntity', message: 'No active season', statusCode: 422 });
    }
    const result = await recomputeFactionStats(fastify.prisma, activeSeason.id);
    if (fastify.redis) {
      await Promise.all([
        invalidate(fastify.redis, 'factions:*'),
        invalidate(fastify.redis, 'meta:*'),
        invalidate(fastify.redis, 'admin:*'),
      ]);
    }
    return reply.code(200).send(result);
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

  // -------------------------------------------------------------------------
  // Calibration questionnaire (admin-editable). GET returns the active catalog
  // plus the built-in defaults (for a "reset" affordance); PUT validates the
  // whole catalog and persists it to AdminConfig. Takes effect immediately.
  // -------------------------------------------------------------------------
  fastify.get('/api/admin/calibration-questions', async () => {
    const questions = await loadCalibrationQuestions(fastify.prisma);
    return { questions, defaults: CALIBRATION_QUESTIONS };
  });

  fastify.put('/api/admin/calibration-questions', async (request, reply) => {
    const parsed = CalibrationQuestionsSchema.safeParse(
      (request.body as { questions?: unknown } | null)?.questions,
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    await fastify.prisma.adminConfig.upsert({
      where: { key: CALIBRATION_CONFIG_KEY },
      create: { key: CALIBRATION_CONFIG_KEY, value: parsed.data as never, updated_by: request.user.sub },
      update: { value: parsed.data as never, updated_by: request.user.sub },
    });
    await fastify.prisma.auditLog.create({
      data: {
        entity_type: 'AdminConfig',
        entity_id: CALIBRATION_CONFIG_KEY,
        action: 'config_update',
        actor_id: request.user.sub,
      },
    });
    if (fastify.redis) await invalidate(fastify.redis, 'admin:config:*');
    return { questions: parsed.data };
  });

  // -------------------------------------------------------------------------
  // #27: audit a player's calibration answers. Read-only: returns each stored
  // answer with its prompt, chosen option label and the band floor it implies,
  // plus the resulting questionnaire floor and the player's effective band, so
  // an admin can see WHY someone was placed up (e.g. a floor above their real
  // results). Uses the admin-edited catalog so labels/floors match what the
  // player actually saw.
  // -------------------------------------------------------------------------
  fastify.get('/api/admin/players/:id/calibration-answers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await fastify.prisma.user.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, username: true, calibration_answers: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'NotFound', message: 'Player not found', statusCode: 404 });
    }

    const questions = await loadCalibrationQuestions(fastify.prisma);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const rawAnswers = (user.calibration_answers as Record<string, string> | null) ?? {};
    const hasQuestionnaire = Object.keys(rawAnswers).length > 0;

    const answers = Object.entries(rawAnswers).map(([questionId, value]) => {
      const question = byId.get(questionId);
      const option = question?.options.find((o) => o.value === value);
      return {
        questionId,
        prompt: question?.prompt ?? questionId,
        value,
        optionLabel: option?.label ?? value,
        floor: option?.floor ?? null,
      };
    });

    return {
      userId: user.id,
      username: user.username,
      hasQuestionnaire,
      questionnaireFloor: hasQuestionnaire ? questionnaireFloor(rawAnswers, questions) : null,
      answers,
    };
  });

  // DELETE /api/admin/players/:id/calibration-answers — reset a player's questionnaire.
  // The wizard is incremental (only asks unknown questions) and its entry point is
  // hidden once completed, so a full clear is the only way to correct an already-given
  // answer. After this the player's "take the questionnaire" CTA reappears and they
  // answer fresh. hasQuestionnaire flips back to false, so their band reverts to
  // data-only until they redo it.
  fastify.delete('/api/admin/players/:id/calibration-answers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await fastify.prisma.user.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, username: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'NotFound', message: 'Player not found', statusCode: 404 });
    }
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { calibration_answers: Prisma.DbNull },
    });
    await fastify.prisma.auditLog.create({
      data: {
        entity_type: 'User',
        entity_id: user.id,
        action: 'calibration_reset',
        actor_id: request.user.sub,
        new_value: { username: user.username },
      },
    });
    if (fastify.redis) await invalidate(fastify.redis, 'admin:skill-distribution:*');
    return { ok: true, userId: user.id, username: user.username };
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
    const r = await addLateParticipant(fastify.prisma, fastify.io, slug, request.body, request.log, fastify);
    return reply.code(r.status).send(r.body);
  });

  // PATCH /api/admin/tournaments/:slug/participants/:userId/faction — set faction pick for a participant
  fastify.patch('/api/admin/tournaments/:slug/participants/:userId/faction', async (request, reply) => {
    const { slug, userId } = request.params as { slug: string; userId: string };
    const r = await setParticipantFactionOp(fastify.prisma, slug, userId, request.body);
    return reply.code(r.status).send(r.body);
  });

  // GET /api/admin/open-play/queue — who is currently in the Open Play queue
  fastify.get('/api/admin/open-play/queue', { preHandler: fastify.authenticate }, async (_request, reply) => {
    const QUEUE_KEY = 'rizzotto:queue:open_play';
    const userIds = fastify.redis ? await fastify.redis.lrange(QUEUE_KEY, 0, -1) : [];
    if (userIds.length === 0) return reply.code(200).send({ members: [] });
    const users = await fastify.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, avatar_url: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return reply.code(200).send({ members: userIds.map((id) => byId.get(id)).filter(Boolean) });
  });

  // GET /api/admin/open-play/active-matches — active Open Play matches with player info
  fastify.get('/api/admin/open-play/active-matches', { preHandler: fastify.authenticate }, async (_request, reply) => {
    const matches = await fastify.prisma.match.findMany({
      where: { type: 'OPEN_PLAY', status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] }, deleted_at: null },
      select: {
        id: true,
        status: true,
        created_at: true,
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return reply.code(200).send({
      matches: matches.map((m) => ({
        id: m.id,
        status: m.status,
        player1: m.player1 ? { id: m.player1.id, name: m.player1.username } : null,
        player2: m.player2 ? { id: m.player2.id, name: m.player2.username } : null,
        createdAt: m.created_at,
      })),
    });
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

  // POST /api/admin/matches/:matchId/forfeit — forfeit a PENDING match in favour of the opponent.
  // Sets status=FORFEIT and winner_id without touching MatchGame rows (no stat impact).
  fastify.post('/api/admin/matches/:matchId/forfeit', async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const parsed = z.object({ droppedPlayerId: z.string() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId required', statusCode: 400 });
    }
    const { droppedPlayerId } = parsed.data;

    const match = await fastify.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, tournament_id: true, player1_id: true, player2_id: true, status: true },
    });
    if (!match || !match.tournament_id) {
      return reply.code(404).send({ error: 'NotFound', message: 'Match not found', statusCode: 404 });
    }
    const tournamentId = match.tournament_id;
    const winnerId = match.player1_id === droppedPlayerId ? match.player2_id : match.player2_id === droppedPlayerId ? match.player1_id : null;
    if (!winnerId) {
      return reply.code(400).send({ error: 'BadRequest', message: 'droppedPlayerId is not in this match', statusCode: 400 });
    }

    // B1: forfeiting a match is match-scoped — it must NOT withdraw the player from
    // the whole tournament (withdraw is a separate explicit action).
    await fastify.prisma.$transaction([
      fastify.prisma.match.update({
        where: { id: matchId },
        data: { status: 'FORFEIT', winner_id: winnerId },
      }),
      // Void all game records so neither leaderboard nor tournament stats
      // reflect results from a match that is being overridden.
      fastify.prisma.matchGame.deleteMany({
        where: { match_id: matchId },
      }),
    ]);

    emitBracketUpdate(fastify.io, tournamentId);
    return reply.code(200).send({ ok: true, winnerId });
  });

  // POST /api/admin/tournaments/:slug/create-match — add a manual PENDING Swiss match
  fastify.post('/api/admin/tournaments/:slug/create-match', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const r = await createManualMatch(fastify.prisma, fastify.io, slug, request.body);
    return reply.code(r.status).send(r.body);
  });

  // GET /api/admin/users/:id/anti-farming?seasonId= — opponents with diminished win value
  fastify.get('/api/admin/users/:id/anti-farming', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(request.query);

    const season = seasonId
      ? await fastify.prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } })
      : await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });

    if (!season) return reply.code(200).send({ opponents: [], playerTotalWins: 0, penaltyActive: false });

    // All game-level wins for this player in the season
    const wonGames = await fastify.prisma.matchGame.findMany({
      where: {
        winner_id: id,
        counts_for_leaderboard: true,
        match: { season_id: season.id, status: 'COMPLETED', deleted_at: null },
      },
      select: { match: { select: { player1_id: true, player2_id: true } } },
    });

    const playerTotalWins = wonGames.length;

    // Count wins per opponent
    const winsByOpponent = new Map<string, number>();
    for (const g of wonGames) {
      const opponentId = g.match.player1_id === id ? g.match.player2_id : g.match.player1_id;
      if (opponentId) winsByOpponent.set(opponentId, (winsByOpponent.get(opponentId) ?? 0) + 1);
    }

    // Compute modifier for each opponent; keep only those with modifier < 1
    const penaltyActive = playerTotalWins >= MIN_WINS_FOR_ANTI_FARM;
    const diminishedOpponents = [...winsByOpponent.entries()]
      .map(([opponentId, wins]) => {
        const share = opponentShare(wins, playerTotalWins);
        const modifier = opponentModifier(share, playerTotalWins);
        const status: 'reduced' | 'approaching' = modifier < 1 ? 'reduced' : 'approaching';
        return { opponentId, wins, share, modifier, status };
      })
      // Show opponents already reduced (modifier < 1) AND those approaching the
      // cap (still full value, but win-share within the warning band) as an early
      // warning before the penalty actually kicks in.
      .filter((o) => o.modifier < 1 || o.share >= OPPONENT_SHARE_WARN)
      .sort((a, b) => a.modifier - b.modifier || b.share - a.share);

    if (diminishedOpponents.length === 0) {
      return reply.code(200).send({ opponents: [], playerTotalWins, penaltyActive });
    }

    const opponentIds = diminishedOpponents.map((o) => o.opponentId);
    const users = await fastify.prisma.user.findMany({
      where: { id: { in: opponentIds } },
      select: { id: true, username: true, avatar_url: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return reply.code(200).send({
      playerTotalWins,
      penaltyActive,
      opponents: diminishedOpponents.map((o) => ({
        ...userById.get(o.opponentId),
        wins: o.wins,
        share: o.share,
        modifier: o.modifier,
        status: o.status,
      })),
    });
  });

  // GET /api/admin/scheduled-matchups — all matchups, all statuses, admin-only
  fastify.get('/api/admin/scheduled-matchups', async (request, reply) => {
    const parsed = z.object({
      status: z.enum(['OPEN', 'ACCEPTED', 'EXPIRED', 'CANCELLED']).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { status, page } = parsed.data;
    const PAGE_SIZE = 30;
    const skip = (page - 1) * PAGE_SIZE;

    const where = status ? { status } : {};
    const [matchups, total] = await Promise.all([
      fastify.prisma.scheduledMatchup.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          format: true,
          proposed_at: true,
          expires_at: true,
          created_at: true,
          status: true,
          notes: true,
          match_id: true,
          proposer: { select: { id: true, username: true, avatar_url: true } },
          accepted_by: { select: { id: true, username: true, avatar_url: true } },
        },
      }),
      fastify.prisma.scheduledMatchup.count({ where }),
    ]);

    return reply.code(200).send({
      total,
      page,
      matchups: matchups.map((m) => ({
        ...m,
        proposed_at: m.proposed_at.toISOString(),
        expires_at: m.expires_at.toISOString(),
        created_at: m.created_at.toISOString(),
      })),
    });
  });

  // DELETE /api/admin/scheduled-matchups/:id — admin force-cancel (any status)
  fastify.delete('/api/admin/scheduled-matchups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const matchup = await fastify.prisma.scheduledMatchup.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!matchup) return reply.code(404).send({ error: 'NotFound', message: 'Matchup not found', statusCode: 404 });
    if (matchup.status === 'CANCELLED' || matchup.status === 'EXPIRED') {
      return reply.code(422).send({ error: 'UnprocessableEntity', message: `Matchup is already ${matchup.status}`, statusCode: 422 });
    }
    await fastify.prisma.scheduledMatchup.update({ where: { id }, data: { status: 'CANCELLED' } });
    return reply.code(204).send();
  });

  // POST /api/admin/publish-changelog — publish the versioned CHANGELOG.md to the Discord
  // changelog channel from the server (the bot token lives here, so no external tooling or
  // local token is needed). Dry-run by default; { confirm: true } actually posts, oldest
  // version first. { versions: ["1.4.0", ...] } restricts to specific versions.
  const PublishChangelogSchema = z.object({
    confirm: z.boolean().default(false),
    versions: z.array(z.string()).optional(),
  });
  fastify.post('/api/admin/publish-changelog', async (request, reply) => {
    const parsed = PublishChangelogSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    try {
      const result = await publishChangelog(parsed.data);
      return reply.code(200).send(result);
    } catch (err) {
      return reply.code(502).send({
        error: 'BadGateway',
        message: err instanceof Error ? err.message : 'Failed to publish changelog',
        statusCode: 502,
      });
    }
  });

};

export default adminRoutes;
