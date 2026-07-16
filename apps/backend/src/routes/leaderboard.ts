import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { computeSeasonLeaderboard } from '../lib/leaderboard-service.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Cap raised to 1000 so the leaderboard page can load every rank in one request
  // (the server computes the full list and slices anyway). Pagination is a fallback
  // only past 1000 entries.
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});

const SeasonLeaderboardQuerySchema = PaginationSchema.extend({
  seasonId: z.string().uuid().optional(),
  mode: z
    .enum(['rating_model', 'winrate'])
    .default('rating_model'),
});

const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/leaderboard?seasonId=...&page=1&pageSize=50
  fastify.get('/api/leaderboard', async (request, reply) => {
    const parsed = SeasonLeaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { seasonId, page, pageSize, mode } = parsed.data;

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

    const MIN_MATCHES_FOR_RATE = 5;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:season', { seasonId: resolvedSeasonId, page, pageSize, mode }),
      async () => {
        // ---------------------------------------------------------------
        // mode = 'rating_model' (default) — dynamic weighted leaderboard.
        // Derived live from confirmed match facts + the current rating model.
        // ---------------------------------------------------------------
        if (mode === 'rating_model') {
          const all = await computeSeasonLeaderboard(fastify.prisma, fastify.redis, resolvedSeasonId);
          const pageSlice = all.slice((page - 1) * pageSize, page * pageSize);

          return {
            mode,
            season: {
              id: season!.id,
              name: season!.name,
              start_date: season!.start_date.toISOString(),
              end_date: season!.end_date.toISOString(),
              is_active: season!.is_active,
            },
            entries: pageSlice.map((e, idx) => ({
              rank: (page - 1) * pageSize + idx + 1,
              playerId: e.playerId,
              displayName: e.displayName,
              avatarUrl: e.avatarUrl,
              totalFinalPoints: e.totalFinalPoints,
              totalRawPoints: e.totalRawPoints,
              totalGames: e.totalGames,
              wins: e.wins,
              losses: e.losses,
            })),
            total: all.length,
            page,
            pageSize,
          };
        }

        // ---------------------------------------------------------------
        // mode = 'winrate' — sort by wins/totalGames desc, min 5 games.
        // Uses the same dynamic MatchGame source as rating_model so the
        // filter is consistent with what the Season tab shows.
        // ---------------------------------------------------------------
        {
          const all = await computeSeasonLeaderboard(fastify.prisma, fastify.redis, resolvedSeasonId);
          const qualified = all
            .filter((e) => e.totalGames >= MIN_MATCHES_FOR_RATE)
            .sort((a, b) => {
              const rateA = a.totalGames > 0 ? a.wins / a.totalGames : 0;
              const rateB = b.totalGames > 0 ? b.wins / b.totalGames : 0;
              return rateB - rateA || b.totalGames - a.totalGames;
            });

          const total = qualified.length;
          const pageSlice = qualified.slice((page - 1) * pageSize, page * pageSize);

          return {
            mode,
            season: {
              id: season!.id,
              name: season!.name,
              start_date: season!.start_date.toISOString(),
              end_date: season!.end_date.toISOString(),
              is_active: season!.is_active,
            },
            entries: pageSlice.map((e, idx) => ({
              rank: (page - 1) * pageSize + idx + 1,
              user: { id: e.playerId, username: e.displayName, avatar_url: e.avatarUrl },
              total_points: Math.round(e.totalFinalPoints),
              games_played: e.totalGames,
              wins: e.wins,
              losses: e.losses,
              win_rate: e.totalGames > 0 ? e.wins / e.totalGames : 0,
            })),
            total,
            page,
            pageSize,
          };
        }
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
          _sum: { total_points: true, games_played: true, wins: true, losses: true },
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
              games_played: g._sum.games_played ?? 0,
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

  // GET /api/leaderboard/major-wins — #6: players ranked by MAJOR tournament wins
  // (1st place in a completed tournament flagged is_major). Standard competition
  // ranking (equal win counts share a rank). Public, cached.
  fastify.get('/api/leaderboard/major-wins', async () => {
    return cached(
      fastify.redis,
      cacheKey('leaderboard:major-wins', {}),
      async () => {
        const wins = await fastify.prisma.tournamentResult.findMany({
          where: {
            placement: 1,
            tournament: { is_major: true, deleted_at: null, status: 'COMPLETED' },
          },
          select: {
            user: { select: { id: true, username: true, avatar_url: true } },
            tournament: { select: { id: true, name: true, slug: true, start_date: true } },
          },
          orderBy: { tournament: { start_date: 'desc' } },
        });

        const byUser = new Map<
          string,
          {
            user: { id: string; username: string; avatar_url: string | null };
            wins: number;
            tournaments: { id: string; name: string; slug: string; startDate: string | null }[];
          }
        >();
        for (const w of wins) {
          if (!w.user) continue;
          const cur = byUser.get(w.user.id) ?? { user: w.user, wins: 0, tournaments: [] };
          cur.wins += 1;
          cur.tournaments.push({
            id: w.tournament.id,
            name: w.tournament.name,
            slug: w.tournament.slug,
            startDate: w.tournament.start_date?.toISOString() ?? null,
          });
          byUser.set(w.user.id, cur);
        }

        const sorted = [...byUser.values()].sort(
          (a, b) => b.wins - a.wins || a.user.username.localeCompare(b.user.username),
        );
        // Standard competition ranking: equal win counts share a rank.
        let lastWins = -1;
        let lastRank = 0;
        const entries = sorted.map((e, i) => {
          const rank = e.wins === lastWins ? lastRank : i + 1;
          lastWins = e.wins;
          lastRank = rank;
          return { rank, user: e.user, wins: e.wins, tournaments: e.tournaments };
        });

        return { entries };
      },
      { ttlSeconds: 300 },
    );
  });
};

export default leaderboardRoutes;
