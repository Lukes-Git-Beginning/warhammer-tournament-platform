import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { asFactionDto, getFactionsWithStats } from '../lib/factions.js';
import { getMatchupMatrix } from '../lib/heatmap.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const SeasonQuerySchema = z.object({
  seasonId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

const metaRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/meta/overview?seasonId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/overview', async (request, reply) => {
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { seasonId } = parsed.data;

    // Resolve season
    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      }
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) {
        return {
          season: null,
          top_factions_by_winrate: [],
          top_factions_by_pickrate: [],
          total_matches: 0,
          faction_diversity: 0,
        };
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('meta:overview', { seasonId: resolvedSeasonId }),
      async () => {
        const allFactions = await getFactionsWithStats(fastify.prisma, resolvedSeasonId);

        // total_matches: sum of matches_played / 2 (each match counts 2 factions)
        const totalMatchesSummed = allFactions.reduce(
          (sum, f) => sum + (f.stats?.matches_played ?? 0),
          0,
        );
        const total_matches = Math.floor(totalMatchesSummed / 2);

        // faction_diversity: factions with at least 1 match played / 24
        const activeCount = allFactions.filter((f) => (f.stats?.matches_played ?? 0) > 0).length;
        const faction_diversity = activeCount / 24;

        // top 5 by winrate — minimum 10 matches played
        const eligibleForWinrate = allFactions
          .filter((f) => (f.stats?.matches_played ?? 0) >= 10)
          .sort((a, b) => {
            const wrA = a.stats?.win_rate ?? 0;
            const wrB = b.stats?.win_rate ?? 0;
            return wrB - wrA;
          });
        const top_factions_by_winrate = eligibleForWinrate.slice(0, 5);

        // top 5 by pickrate — sorted by matches_played desc
        const byPickrate = [...allFactions]
          .filter((f) => (f.stats?.matches_played ?? 0) > 0)
          .sort((a, b) => (b.stats?.matches_played ?? 0) - (a.stats?.matches_played ?? 0));
        const top_factions_by_pickrate = byPickrate.slice(0, 5);

        return {
          season: {
            id: season!.id,
            name: season!.name,
            start_date: season!.start_date.toISOString(),
            end_date: season!.end_date.toISOString(),
            is_active: season!.is_active,
            dlc_tag: season!.dlc_tag ?? null,
          },
          top_factions_by_winrate,
          top_factions_by_pickrate,
          total_matches,
          faction_diversity,
        };
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/meta/matchups?seasonId=<uuid>
  // Returns 24x24 matchup matrix (faction-A vs faction-B) for the requested
  // season — aggregated from `MatchupStats` via `getMatchupMatrix()`.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/matchups', async (request, reply) => {
    const parsed = SeasonQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { seasonId } = parsed.data;

    // Resolve season
    let season;
    if (seasonId) {
      season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) {
        return reply.code(404).send({ error: 'NotFound', message: 'Season not found', statusCode: 404 });
      }
    } else {
      season = await fastify.prisma.season.findFirst({ where: { is_active: true } });
      if (!season) {
        return {
          season_id: null,
          cells: [],
          factions: [],
        };
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('meta:matchups', { seasonId: resolvedSeasonId }),
      async () => {
        const [cells, factions] = await Promise.all([
          getMatchupMatrix(fastify.prisma, resolvedSeasonId),
          fastify.prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
        ]);

        return {
          season_id: resolvedSeasonId,
          cells,
          factions: factions.map(asFactionDto),
        };
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/meta/games?page=1&limit=50
  // Public — global game history across all tournaments, most recent first.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/games', async (request, reply) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // Fetch all tournament participant factions for the page's matches as fallback
    // (resolved after match query to know which tournament IDs are involved)
    const [completedMatches, total] = await Promise.all([
      fastify.prisma.match.findMany({
        where: { status: 'COMPLETED', player1_id: { not: null }, player2_id: { not: null } },
        select: {
          id: true,
          round: true,
          match_number: true,
          winner_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
          played_at: true,
          player1: { select: { id: true, username: true, avatar_url: true } },
          player2: { select: { id: true, username: true, avatar_url: true } },
          tournament: { select: { id: true, name: true, slug: true } },
          games: {
            select: {
              id: true,
              game_number: true,
              winner_id: true,
              player1_faction_id: true,
              player2_faction_id: true,
              played_at: true,
              replay_url: true,
              map_decision: { select: { picked_map_id: true } },
            },
            orderBy: { game_number: 'asc' },
          },
        },
        orderBy: { played_at: 'desc' },
        skip,
        take: limit,
      }),
      // Game-level total: completed MatchGames + matches with no MatchGame records (synthetic rows)
      fastify.prisma.matchGame.count({ where: { match: { status: 'COMPLETED', player1_id: { not: null }, player2_id: { not: null }, deleted_at: null } } })
        .then(async (gameCount) => {
          const syntheticCount = await fastify.prisma.match.count({
            where: { status: 'COMPLETED', player1_id: { not: null }, player2_id: { not: null }, deleted_at: null, games: { none: {} } },
          });
          return gameCount + syntheticCount;
        }),
    ]);

    // Load participant factions for the tournaments on this page (SFT fallback)
    const tournamentIds = [...new Set(completedMatches.map((m) => m.tournament.id))];
    const participantsRaw = tournamentIds.length
      ? await fastify.prisma.tournamentParticipant.findMany({
          where: { tournament_id: { in: tournamentIds }, deleted_at: null },
          select: { tournament_id: true, user_id: true, faction_id: true },
        })
      : [];
    // key: `${tournamentId}:${userId}` → faction_id
    const participantFaction = new Map(
      participantsRaw.map((p) => [`${p.tournament_id}:${p.user_id}`, p.faction_id]),
    );
    const pFaction = (tournamentId: string, userId: string | null | undefined) =>
      userId ? (participantFaction.get(`${tournamentId}:${userId}`) ?? null) : null;

    const rows = completedMatches.flatMap((m) => {
      const base = { round: m.round, matchNumber: m.match_number, player1: m.player1 ?? null, player2: m.player2 ?? null, tournament: m.tournament, matchId: m.id };
      if (m.games.length > 0) {
        return m.games.map((g) => ({
          ...base,
          id: g.id,
          gameNumber: g.game_number,
          playedAt: (g.played_at ?? m.played_at)?.toISOString() ?? null,
          winnerId: g.winner_id ?? m.winner_id,
          player1FactionId: g.player1_faction_id ?? m.player1_faction_id ?? pFaction(m.tournament.id, m.player1?.id),
          player2FactionId: g.player2_faction_id ?? m.player2_faction_id ?? pFaction(m.tournament.id, m.player2?.id),
          mapPickedId: g.map_decision?.picked_map_id ?? null,
          replayUrl: g.replay_url,
        }));
      }
      return [{ ...base, id: m.id, gameNumber: 1, playedAt: m.played_at?.toISOString() ?? null, winnerId: m.winner_id, player1FactionId: m.player1_faction_id ?? pFaction(m.tournament.id, m.player1?.id), player2FactionId: m.player2_faction_id ?? pFaction(m.tournament.id, m.player2?.id), mapPickedId: null, replayUrl: null }];
    });

    rows.sort((a, b) => (b.playedAt ?? '').localeCompare(a.playedAt ?? ''));

    const mapIds = [...new Set(rows.map((r) => r.mapPickedId).filter(Boolean) as string[])];
    const maps = mapIds.length
      ? await fastify.prisma.map.findMany({ where: { id: { in: mapIds } }, select: { id: true, name: true } })
      : [];
    const mapById = new Map(maps.map((m) => [m.id, m.name]));

    return reply.code(200).send({
      total,
      page,
      limit,
      games: rows.map((r) => ({ ...r, mapName: r.mapPickedId ? (mapById.get(r.mapPickedId) ?? null) : null, mapPickedId: undefined })),
    });
  });
};

export default metaRoutes;
