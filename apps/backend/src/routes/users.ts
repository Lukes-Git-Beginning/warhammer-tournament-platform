import type { FastifyPluginAsync } from 'fastify';
import { UpdateMeSchema, UpdateUserRoleRequestSchema } from '@tww3/types';
import { z } from 'zod';
import { invalidate } from '../lib/cache.js';

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/users/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.sub },
        select: {
          id: true,
          discord_id: true,
          username: true,
          email: true,
          avatar_url: true,
          timezone: true,
          role: true,
          preferred_factions: true,
          last_login: true,
          created_at: true,
        },
      });
      if (!user) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'User not found',
          statusCode: 404,
        });
      }
      return {
        ...user,
        last_login: user.last_login?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
      };
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
      const user = await fastify.prisma.user.update({
        where: { id: request.user.sub },
        data: parsed.data,
        select: {
          id: true,
          discord_id: true,
          username: true,
          email: true,
          avatar_url: true,
          timezone: true,
          role: true,
          preferred_factions: true,
          last_login: true,
          created_at: true,
        },
      });
      return {
        ...user,
        last_login: user.last_login?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
      };
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
      include: {
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
