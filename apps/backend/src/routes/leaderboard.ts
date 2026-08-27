import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { computeSeasonLeaderboard } from '../lib/leaderboard-service.js';
import { getRatingModel } from '../lib/rating-model-service.js';
import { logistic, skillToBand } from '../lib/rating-model.js';
import { effectiveTiersOf, SUPPORTER_FLAG_SELECT, NO_TIERS } from '../lib/supporter-service.js';
import {
  computeSwissStandings,
  sortSwissStandings,
  type CompletedMatchRecord,
} from '../lib/swiss.js';

/**
 * The SINGLE champion of a completed tournament, for the "major wins" leaderboard.
 * Determined from match data (not TournamentResult.placement, which is by Swiss standing
 * for BaLi and can carry stale rows), so exactly one winner is credited per tournament:
 *  - Playoff final(s): Swiss+Playoff has one; a Balanced Liechtenstein has one per DIVISION
 *    → the champion is the winner of the TOP division's final (highest skill band among its
 *    finalists), never a lower-division winner.
 *  - Single/Double elimination: the grand final (GRAND_FINAL side, else the top-round match).
 *  - Pure Swiss / Round Robin / Liechtenstein (no playoff): the top of the final standings.
 */
export interface ChampionMatch {
  phase: string | null;
  status: string;
  round: number;
  winner_id: string | null;
  player1_id: string | null;
  player2_id: string | null;
  bracket_side: string | null;
}

export function tournamentChampion(
  tournamentId: string,
  format: string,
  matches: ChampionMatch[],
  bandByUser: Map<string, number>,
  participantIds: string[],
  withdrawnIds: Set<string>,
): string | null {
  const done = matches.filter((m) => m.status === 'COMPLETED' && m.winner_id);

  const finals = done.filter((m) => m.phase === 'PLAYOFF_FINAL');
  if (finals.length > 0) {
    let best = finals[0]!;
    let bestBand = -1;
    for (const f of finals) {
      const band = Math.max(bandByUser.get(f.player1_id ?? '') ?? 0, bandByUser.get(f.player2_id ?? '') ?? 0);
      if (band > bestBand) {
        bestBand = band;
        best = f;
      }
    }
    return best.winner_id;
  }

  if (format === 'DOUBLE_ELIMINATION' || format === 'SINGLE_ELIMINATION') {
    const grandFinals = done.filter((m) => m.bracket_side === 'GRAND_FINAL');
    const pool = grandFinals.length > 0 ? grandFinals : done.filter((m) => m.phase !== 'PLAYOFF_THIRD_PLACE');
    if (pool.length === 0) return null;
    const maxRound = Math.max(...pool.map((m) => m.round));
    return pool.filter((m) => m.round === maxRound).at(-1)?.winner_id ?? null;
  }

  // Pure ranked (Swiss / RR / DRR / Liechtenstein) — champion = top of final standings.
  const completed: CompletedMatchRecord[] = done.map((m) => ({
    round: m.round,
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    winner_id: m.winner_id,
    status: m.status,
  }));
  const standings = sortSwissStandings(
    computeSwissStandings(participantIds, completed, withdrawnIds),
    completed,
    tournamentId,
  );
  return standings[0]?.userId ?? null;
}

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
              tiers: e.tiers,
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
              user: { id: e.playerId, username: e.displayName, avatar_url: e.avatarUrl, tiers: e.tiers },
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
          select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        return {
          entries: pageSlice.map((g, idx) => {
            const user = userMap.get(g.user_id);
            return {
              rank: (page - 1) * pageSize + idx + 1,
              user: user
                ? { id: user.id, username: user.username, avatar_url: user.avatar_url, tiers: effectiveTiersOf(user) }
                : { id: g.user_id, username: 'Unknown', avatar_url: null, tiers: NO_TIERS },
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

  // GET /api/leaderboard/major-wins — #6: players ranked by MAJOR tournament wins. A win
  // is being the SINGLE champion of a completed is_major tournament — the decisive final
  // winner (for Balanced Liechtenstein, the TOP division's final), computed from match
  // data via tournamentChampion (not TournamentResult.placement, which is multi-valued for
  // BaLi and can carry stale rows). Standard competition ranking. Public, cached.
  fastify.get('/api/leaderboard/major-wins', async () => {
    return cached(
      fastify.redis,
      cacheKey('leaderboard:major-wins', {}),
      async () => {
        const tournaments = await fastify.prisma.tournament.findMany({
          where: { is_major: true, deleted_at: null, status: 'COMPLETED' },
          select: { id: true, format: true, name: true, slug: true, start_date: true },
          orderBy: { start_date: 'desc' },
        });
        if (tournaments.length === 0) return { entries: [] };
        const tournamentIds = tournaments.map((t) => t.id);

        const [matches, participants, gameWins] = await Promise.all([
          fastify.prisma.match.findMany({
            where: { tournament_id: { in: tournamentIds }, deleted_at: null },
            select: {
              tournament_id: true,
              phase: true,
              status: true,
              round: true,
              winner_id: true,
              player1_id: true,
              player2_id: true,
              bracket_side: true,
            },
          }),
          fastify.prisma.tournamentParticipant.findMany({
            where: { tournament_id: { in: tournamentIds }, deleted_at: null },
            select: { tournament_id: true, user_id: true, skill_band: true, status: true },
          }),
          // Tiebreaker: total GAME wins across all majors (games are the statistical unit —
          // not tournament wins, not match wins). Leaderboard-excluded games (voided / modded
          // faction) count for nothing, so counts_for_leaderboard is enforced.
          fastify.prisma.matchGame.groupBy({
            by: ['winner_id'],
            where: {
              status: 'COMPLETED',
              counts_for_leaderboard: true,
              winner_id: { not: null },
              match: { tournament_id: { in: tournamentIds }, deleted_at: null },
            },
            _count: { _all: true },
          }),
        ]);
        const gameWinsByUser = new Map(gameWins.map((g) => [g.winner_id!, g._count._all]));

        const matchesByT = new Map<string, ChampionMatch[]>();
        for (const m of matches) {
          if (!m.tournament_id) continue;
          (matchesByT.get(m.tournament_id) ?? matchesByT.set(m.tournament_id, []).get(m.tournament_id)!).push(m);
        }
        const partsByT = new Map<string, typeof participants>();
        for (const p of participants) {
          (partsByT.get(p.tournament_id) ?? partsByT.set(p.tournament_id, []).get(p.tournament_id)!).push(p);
        }

        // Champion user id → the majors they won.
        const byUser = new Map<
          string,
          { tournaments: { id: string; name: string; slug: string; startDate: string | null }[] }
        >();
        for (const t of tournaments) {
          const ps = partsByT.get(t.id) ?? [];
          const champion = tournamentChampion(
            t.id,
            t.format,
            matchesByT.get(t.id) ?? [],
            new Map(ps.map((p) => [p.user_id, p.skill_band ?? 0])),
            ps.map((p) => p.user_id),
            new Set(ps.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id)),
          );
          if (!champion) continue;
          const cur = byUser.get(champion) ?? { tournaments: [] };
          cur.tournaments.push({
            id: t.id,
            name: t.name,
            slug: t.slug,
            startDate: t.start_date?.toISOString() ?? null,
          });
          byUser.set(champion, cur);
        }

        const championIds = [...byUser.keys()];
        const users = championIds.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: championIds } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const userById = new Map(users.map((u) => [u.id, u]));

        const rows = championIds
          .map((id) => {
            const u = userById.get(id);
            const v = byUser.get(id)!;
            return u
              ? {
                  user: { id: u.id, username: u.username, avatar_url: u.avatar_url, tiers: effectiveTiersOf(u) },
                  wins: v.tournaments.length,
                  majorGameWins: gameWinsByUser.get(id) ?? 0,
                  tournaments: v.tournaments,
                }
              : null;
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          // Primary: major titles. Tiebreaker: total game wins across majors. Then name.
          .sort(
            (a, b) =>
              b.wins - a.wins ||
              b.majorGameWins - a.majorGameWins ||
              a.user.username.localeCompare(b.user.username),
          );

        // Standard competition ranking: rows tied on BOTH titles and the game-win
        // tiebreaker share a rank.
        let lastKey = '';
        let lastRank = 0;
        const entries = rows.map((e, i) => {
          const key = `${e.wins}:${e.majorGameWins}`;
          const rank = key === lastKey ? lastRank : i + 1;
          lastKey = key;
          lastRank = rank;
          return { rank, user: e.user, wins: e.wins, majorGameWins: e.majorGameWins, tournaments: e.tournaments };
        });

        return { entries };
      },
      { ttlSeconds: 300 },
    );
  });

  // GET /api/leaderboard/skill — #14: players ranked purely by their DATA-derived general
  // skill (GS) from the hierarchical rating model. NOT the questionnaire band, NOT the
  // achievement/points leaderboard — just "how strong is this player" from game results.
  // Only players with ≥ minGames decisive games are ranked (thin data is unreliable).
  fastify.get('/api/leaderboard/skill', async (request, reply) => {
    const parsed = z
      .object({
        seasonId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(100),
        // #8: the Skill leaderboard excludes players with fewer than 20 games (a handful of
        // games is too noisy to rank on), and shows their real win-rate as a column.
        minGames: z.coerce.number().int().min(1).max(1000).default(20),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { seasonId, page, pageSize, minGames } = parsed.data;

    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) return reply.code(404).send({ error: 'NotFound', message: 'No active season', statusCode: 404 });
    }
    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:skill', { seasonId: resolvedSeasonId, page, pageSize, minGames }),
      async () => {
        // Force the hierarchical fit so the general-skill decomposition exists (mirrors the
        // skill-classification service — the flat default model has no GS).
        const model = await getRatingModel(fastify.prisma, fastify.redis, {
          seasonId: resolvedSeasonId,
          config: { hierarchical: true },
        });

        const eligible = model.generalSkills
          .filter((e) => e.gamesCount >= minGames)
          .sort((a, b) => b.generalSkill - a.generalSkill || b.gamesCount - a.gamesCount);
        const total = eligible.length;
        const slice = eligible.slice((page - 1) * pageSize, page * pageSize);

        const users = slice.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: slice.map((e) => e.playerId) } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const userById = new Map(users.map((u) => [u.id, u]));

        // #8: real win/loss record (same dynamic MatchGame source as the old winrate tab) so the
        // Skill leaderboard can show an actual win-rate column next to the model-derived skill.
        const record = new Map(
          (await computeSeasonLeaderboard(fastify.prisma, fastify.redis, resolvedSeasonId)).map((r) => [
            r.playerId,
            r,
          ]),
        );

        const entries = slice.flatMap((e, i) => {
          const user = userById.get(e.playerId);
          if (!user) return [];
          const rec = record.get(e.playerId);
          const wins = rec?.wins ?? 0;
          const losses = rec?.losses ?? 0;
          const gamesForRate = rec?.totalGames ?? e.gamesCount;
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              user: { id: user.id, username: user.username, avatar_url: user.avatar_url, tiers: effectiveTiersOf(user) },
              generalSkill: e.generalSkill,
              stdError: e.stdError,
              winChance: logistic(e.generalSkill),
              band: skillToBand(e.generalSkill),
              gamesCount: e.gamesCount,
              factionsPlayed: e.factionsPlayed,
              wins,
              losses,
              winRate: gamesForRate > 0 ? wins / gamesForRate : 0,
            },
          ];
        });

        return {
          entries,
          total,
          page,
          pageSize,
          season: { id: season.id, name: season.name, is_active: season.is_active },
        };
      },
      { ttlSeconds: 3600 },
    );
  });
};

export default leaderboardRoutes;
