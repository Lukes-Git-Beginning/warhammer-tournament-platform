import type { FastifyPluginAsync } from 'fastify';
import {
  UpdateMeSchema,
  UpdateOnboardingStageSchema,
  UpdateUserRoleRequestSchema,
} from '@rizzotto/types';
import { z } from 'zod';
import { invalidate } from '../lib/cache.js';

const meSelect = {
  id: true,
  discord_id: true,
  username: true,
  email: true,
  avatar_url: true,
  timezone: true,
  role: true,
  preferred_factions: true,
  last_login: true,
  onboarded_at: true,
  onboarding_stage: true,
  created_at: true,
} as const;

type MeRow = {
  id: string;
  discord_id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  timezone: string | null;
  role: 'USER' | 'ORGANIZER' | 'MODERATOR' | 'ADMIN';
  preferred_factions: string[];
  last_login: Date | null;
  onboarded_at: Date | null;
  onboarding_stage: number;
  created_at: Date;
};

function serializeMe(user: MeRow) {
  return {
    ...user,
    last_login: user.last_login?.toISOString() ?? null,
    onboarded_at: user.onboarded_at?.toISOString() ?? null,
    created_at: user.created_at.toISOString(),
  };
}

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/users/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: meSelect,
      });
      if (!user) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'User not found',
          statusCode: 404,
        });
      }
      return serializeMe(user);
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
      const { reset_onboarding, ...patch } = parsed.data;
      const data: Record<string, unknown> = { ...patch };
      if (reset_onboarding) {
        data.onboarded_at = null;
        data.onboarding_stage = 0;
      }
      const user = await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data,
        select: meSelect,
      });
      return serializeMe(user);
    },
  );

  fastify.patch(
    '/api/users/me/onboarding-stage',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = UpdateOnboardingStageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }
      await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: { onboarding_stage: parsed.data.stage },
        select: { id: true },
      });
      return { ok: true } as const;
    },
  );

  fastify.post(
    '/api/users/me/onboarding-complete',
    { preHandler: fastify.authenticate },
    async (request) => {
      const user = await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: { onboarded_at: new Date(), onboarding_stage: 0 },
        select: meSelect,
      });
      return serializeMe(user);
    },
  );
  // PATCH /api/users/:id/role — admin only
  fastify.patch(
    '/api/users/:id/role',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const parsed = UpdateUserRoleRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      let user: { id: string; username: string; role: string };
      try {
        user = await fastify.prisma.user.update({
          where: { id, deleted_at: null },
          data: { role: parsed.data.role },
          select: { id: true, username: true, role: true },
        });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'P2025') {
          return reply.code(404).send({
            error: 'NotFound',
            message: 'User not found',
            statusCode: 404,
          });
        }
        throw err;
      }

      // Invalidate cached role so requireRole picks up the change immediately
      const redis = fastify.hasDecorator('redis')
        ? (fastify as unknown as { redis: import('ioredis').Redis }).redis
        : undefined;
      await invalidate(redis, `user:role:${id}`);

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'User',
          entity_id: id,
          action: 'role_update',
          actor_id: request.user.sub,
          new_value: { role: parsed.data.role },
        },
      });

      return reply.code(200).send(user);
    },
  );

  // GET /api/users?search=&page=&limit= — Admin-only user search (Bug-Fix)
  fastify.get(
    '/api/users',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')] },
    async (request, reply) => {
      const SearchQuerySchema = z.object({
        search: z.string().min(2).max(50),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      });

      const parsed = SearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { search, page, limit } = parsed.data;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where: {
            deleted_at: null,
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { discord_id: search },
            ],
          },
          select: {
            id: true,
            discord_id: true,
            username: true,
            email: true,
            avatar_url: true,
            role: true,
            created_at: true,
            deleted_at: true,
          },
          orderBy: { username: 'asc' },
          skip,
          take: limit,
        }),
        fastify.prisma.user.count({
          where: {
            deleted_at: null,
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { discord_id: search },
            ],
          },
        }),
      ]);

      return {
        users: users.map((u) => ({
          ...u,
          created_at: u.created_at.toISOString(),
          deleted_at: u.deleted_at?.toISOString() ?? null,
        })),
        total,
        page,
        limit,
      };
    },
  );

  // GET /api/users/:id/stats?season= — Personal Stats
  fastify.get(
    '/api/users/:id/stats',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { season: seasonId } = z.object({ season: z.string().uuid().optional() }).parse(request.query);

      const user = await fastify.prisma.user.findUnique({
        where: { id, deleted_at: null },
        select: { id: true, username: true },
      });
      if (!user) {
        return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
      }

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

      // Match history — last 20 completed matches
      const recentMatches = await fastify.prisma.match.findMany({
        where: {
          status: { in: ['COMPLETED', 'FORFEIT'] },
          OR: [{ player1_id: id }, { player2_id: id }],
          deleted_at: null,
        },
        orderBy: { updated_at: 'desc' },
        take: 20,
        include: {
          tournament: { select: { slug: true } },
          player1: { select: { id: true, username: true } },
          player2: { select: { id: true, username: true } },
          player1_faction: { select: { id: true, name: true } },
          player2_faction: { select: { id: true, name: true } },
          map_decision: { select: { picked_map_id: true } },
        },
      });

      // Total wins/losses
      const totalWins = recentMatches.filter((m) => m.winner_id === id).length;
      const totalLosses = recentMatches.filter((m) => m.winner_id !== null && m.winner_id !== id).length;

      // Per-faction win-rates from FactionMastery
      const masteryThresholdRow = await fastify.prisma.adminConfig.findUnique({
        where: { key: 'mmr_mastery_threshold_games' },
      });
      const masteryThreshold = typeof masteryThresholdRow?.value === 'number'
        ? masteryThresholdRow.value
        : 10;

      const masteries = await fastify.prisma.factionMastery.findMany({
        where: { user_id: id },
        include: { faction: { select: { id: true, name: true } } },
        orderBy: { games_played: 'desc' },
      });

      const perFactionWinrate = await Promise.all(
        masteries.map(async (m) => {
          if (m.games_played >= masteryThreshold) {
            return {
              faction_id: m.faction_id,
              faction_name: m.faction.name,
              games_played: m.games_played,
              wins: m.wins,
              losses: m.losses,
              win_rate: m.games_played > 0 ? m.wins / m.games_played : 0,
              mastery_rating: m.rating,
              source: 'own_data' as const,
            };
          }

          // Below threshold — fallback to TT-seed aggregate win-rate
          if (resolvedSeasonId) {
            const ttStats = await fastify.prisma.factionMatchupStat.findMany({
              where: {
                season_id: resolvedSeasonId,
                faction_a_id: m.faction_id,
              },
              select: { wins: true, losses: true },
            });
            const totalWinsFromTT = ttStats.reduce((acc, s) => acc + s.wins, 0);
            const totalLossesFromTT = ttStats.reduce((acc, s) => acc + s.losses, 0);
            const totalGames = totalWinsFromTT + totalLossesFromTT;
            return {
              faction_id: m.faction_id,
              faction_name: m.faction.name,
              games_played: m.games_played,
              wins: null,
              losses: null,
              win_rate: totalGames > 0 ? totalWinsFromTT / totalGames : null,
              mastery_rating: null,
              source: 'tt_seed' as const,
            };
          }

          return {
            faction_id: m.faction_id,
            faction_name: m.faction.name,
            games_played: m.games_played,
            wins: null,
            losses: null,
            win_rate: null,
            mastery_rating: null,
            source: 'insufficient_data' as const,
          };
        }),
      );

      // ELO history from TournamentResults (approximate via placement/points over time)
      const eloHistory = await fastify.prisma.tournamentResult.findMany({
        where: { user_id: id, season_id: resolvedSeasonId ?? undefined },
        orderBy: { created_at: 'asc' },
        select: { created_at: true, elo_change: true },
      });

      let runningRating = 1200;
      const eloHistoryPoints = eloHistory.map((r) => {
        runningRating += r.elo_change;
        return { played_at: r.created_at.toISOString(), rating: runningRating };
      });

      // Faction mastery top 5 (only visible for own profile)
      const isOwnProfile = request.user.sub === id;
      const masteryTop5 = isOwnProfile
        ? masteries
            .slice(0, 5)
            .map((m) => ({
              faction_id: m.faction_id,
              faction_name: m.faction.name,
              rating: m.rating,
              games_played: m.games_played,
              wins: m.wins,
              losses: m.losses,
              last_played_at: m.last_played_at?.toISOString() ?? null,
            }))
        : null;

      const matchHistory = recentMatches.map((m) => {
        const isPlayer1 = m.player1_id === id;
        const opponentUser = isPlayer1 ? m.player2 : m.player1;
        const myFaction = isPlayer1 ? m.player1_faction : m.player2_faction;
        const opponentFaction = isPlayer1 ? m.player2_faction : m.player1_faction;
        const won = m.winner_id === id;
        return {
          tournament_slug: m.tournament.slug,
          opponent_username: opponentUser?.username ?? null,
          my_score: won ? 1 : 0,
          opponent_score: won ? 0 : 1,
          my_faction: myFaction ? { id: myFaction.id, name: myFaction.name } : null,
          opponent_faction: opponentFaction ? { id: opponentFaction.id, name: opponentFaction.name } : null,
          map_id: m.map_decision?.picked_map_id ?? null,
          played_at: m.updated_at.toISOString(),
          won,
        };
      });

      return {
        match_history: matchHistory,
        total_wins: totalWins,
        total_losses: totalLosses,
        win_rate: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0,
        per_faction_winrate: perFactionWinrate,
        elo_history: eloHistoryPoints,
        faction_mastery_top5: masteryTop5,
      };
    },
  );

  // GET /api/users/:id — public
  fastify.get('/api/users/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const user = await fastify.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, avatar_url: true, role: true, created_at: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    }

    // Active season entry
    const activeSeason = await fastify.prisma.season.findFirst({ where: { is_active: true } });
    let currentSeasonEntry = null;
    if (activeSeason) {
      const entry = await fastify.prisma.leaderboardEntry.findUnique({
        where: { user_id_season_id: { user_id: id, season_id: activeSeason.id } },
      });
      if (entry) {
        currentSeasonEntry = {
          season: {
            id: activeSeason.id,
            name: activeSeason.name,
            start_date: activeSeason.start_date.toISOString(),
            end_date: activeSeason.end_date.toISOString(),
            is_active: activeSeason.is_active,
          },
          total_points: entry.total_points,
          elo_rating: entry.elo_rating,
          matches_played: entry.matches_played,
          wins: entry.wins,
          losses: entry.losses,
        };
      }
    }

    // All-time stats
    const allTimeAgg = await fastify.prisma.leaderboardEntry.aggregate({
      where: { user_id: id },
      _sum: { matches_played: true, wins: true, losses: true, total_points: true },
      _count: { season_id: true },
    });
    const tournamentsPlayed = await fastify.prisma.tournamentResult.count({ where: { user_id: id } });

    // Recent tournament results (last 10)
    const recentResults = await fastify.prisma.tournamentResult.findMany({
      where: { user_id: id },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        placement: true,
        points_earned: true,
        elo_change: true,
        created_at: true,
        tournament: { select: { slug: true, name: true, start_date: true } },
        season: { select: { name: true } },
      },
    });

    // Recent match history (last 20, COMPLETED or FORFEIT)
    const recentMatches = await fastify.prisma.match.findMany({
      where: {
        status: { in: ['COMPLETED', 'FORFEIT'] },
        OR: [{ player1_id: id }, { player2_id: id }],
      },
      orderBy: { updated_at: 'desc' },
      take: 20,
      include: {
        tournament: { select: { slug: true, name: true } },
        player1: { select: { id: true, username: true, avatar_url: true } },
        player2: { select: { id: true, username: true, avatar_url: true } },
      },
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        created_at: user.created_at.toISOString(),
      },
      current_season: currentSeasonEntry,
      all_time: {
        matches_played: allTimeAgg._sum.matches_played ?? 0,
        wins: allTimeAgg._sum.wins ?? 0,
        losses: allTimeAgg._sum.losses ?? 0,
        tournaments_played: tournamentsPlayed,
        total_points: allTimeAgg._sum.total_points ?? 0,
      },
      recent_results: recentResults.map((r) => ({
        tournament: {
          slug: r.tournament.slug,
          name: r.tournament.name,
          start_date: r.tournament.start_date.toISOString(),
        },
        season_name: r.season?.name ?? null,
        placement: r.placement,
        points_earned: r.points_earned,
        elo_change: r.elo_change,
        created_at: r.created_at.toISOString(),
      })),
      recent_matches: recentMatches.map((m) => {
        const opponentUser = m.player1_id === id ? m.player2 : m.player1;
        return {
          tournament: { slug: m.tournament.slug, name: m.tournament.name },
          round: m.round,
          opponent: opponentUser
            ? { id: opponentUser.id, username: opponentUser.username, avatar_url: opponentUser.avatar_url }
            : null,
          winnerId: m.winner_id,
          score: m.score,
          status: m.status,
          updatedAt: m.updated_at.toISOString(),
        };
      }),
    };
  });
};

export default userRoutes;
