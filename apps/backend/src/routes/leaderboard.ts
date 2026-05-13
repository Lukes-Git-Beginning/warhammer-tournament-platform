import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const SeasonLeaderboardQuerySchema = PaginationSchema.extend({
  seasonId: z.string().uuid().optional(),
});

const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/leaderboard?seasonId=...&page=1&pageSize=50
  fastify.get('/api/leaderboard', async (request, reply) => {
    const parsed = SeasonLeaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { seasonId, page, pageSize } = parsed.data;

    // Season lookup cannot be cached because 404 detection must happen before caching
    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      }
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'No active season', statusCode: 404 });
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:season', { seasonId: resolvedSeasonId, page, pageSize }),
      async () => {
        const total = await fastify.prisma.leaderboardEntry.count({ where: { season_id: resolvedSeasonId } });

        type LeaderboardRow = {
          id: string;
          user_id: string;
          season_id: string;
          total_points: number;
          elo_rating: number;
          matches_played: number;
          wins: number;
          losses: number;
          rank: bigint;
          username: string;
          avatar_url: string | null;
        };

        const rows = await fastify.prisma.$queryRaw<LeaderboardRow[]>`
          SELECT
            le.id,
            le.user_id,
            le.season_id,
            le.total_points,
            le.elo_rating,
            le.matches_played,
            le.wins,
            le.losses,
            u.username,
            u.avatar_url,
            RANK() OVER (
              ORDER BY le.total_points DESC, le.elo_rating DESC, le.wins DESC
            ) AS rank
          FROM "LeaderboardEntry" le
          INNER JOIN "User" u ON u.id = le.user_id
          WHERE le.season_id = ${resolvedSeasonId}::uuid
          ORDER BY le.total_points DESC, le.elo_rating DESC, le.wins DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize};
        `;

        return {
          season: {
            id: season!.id,
            name: season!.name,
            start_date: season!.start_date.toISOString(),
            end_date: season!.end_date.toISOString(),
            is_active: season!.is_active,
          },
          entries: rows.map((r) => ({
            rank: Number(r.rank),
            user: { id: r.user_id, username: r.username, avatar_url: r.avatar_url },
            total_points: r.total_points,
            elo_rating: r.elo_rating,
            matches_played: r.matches_played,
            wins: r.wins,
            losses: r.losses,
          })),
          total,
          page,
          pageSize,
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // GET /api/leaderboard/all-time?page=1&pageSize=50
  fastify.get('/api/leaderboard/all-time', async (request, reply) => {
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { page, pageSize } = parsed.data;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:all-time', { page, pageSize }),
      async () => {
        // Aggregate per user across all seasons
        const grouped = await fastify.prisma.leaderboardEntry.groupBy({
          by: ['user_id'],
          _sum: { total_points: true, matches_played: true, wins: true, losses: true },
          _max: { elo_rating: true },
          _count: { season_id: true },
          orderBy: { _sum: { total_points: 'desc' } },
        });

        const total = grouped.length;
        const pageSlice = grouped.slice((page - 1) * pageSize, page * pageSize);

        const userIds = pageSlice.map((g) => g.user_id);
        const users = await fastify.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, avatar_url: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        return {
          entries: pageSlice.map((g, idx) => {
            const user = userMap.get(g.user_id);
            return {
              rank: (page - 1) * pageSize + idx + 1,
              user: user
                ? { id: user.id, username: user.username, avatar_url: user.avatar_url }
                : { id: g.user_id, username: 'Unknown', avatar_url: null },
              total_points: g._sum.total_points ?? 0,
              elo_rating: g._max.elo_rating ?? 1200,
              matches_played: g._sum.matches_played ?? 0,
              wins: g._sum.wins ?? 0,
              losses: g._sum.losses ?? 0,
              seasons_participated: g._count.season_id,
            };
          }),
          total,
          page,
          pageSize,
        };
      },
      { ttlSeconds: 120 },
    );
  });
};

export default leaderboardRoutes;
