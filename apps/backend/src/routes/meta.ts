import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { asFactionDto, getFactionsWithStats } from '../lib/factions.js';
import { getMatchupMatrix } from '../lib/heatmap.js';
import { resolveStandardRuleset } from '../lib/standard-ruleset.js';

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
          total_games: 0,
          faction_diversity: 0,
        };
      }
    }

    const resolvedSeasonId = season.id;

    return cached(
      fastify.redis,
      cacheKey('meta:overview', { seasonId: resolvedSeasonId }),
      async () => {
        // Identical filter to /api/meta/games so the counter matches the list. Games are
        // the statistical unit: count COMPLETED MatchGame rows directly (every real match
        // now has game rows — no synthetic fallback). A draw IS a played game (no winner_id
        // filter); admin-voided matches (counts_for_leaderboard = false) are excluded. The
        // match's lifecycle status is intentionally NOT filtered — a real game stays counted
        // even if its container was later cancelled.
        const globalMatchWhere = {
          player1_id: { not: null },
          player2_id: { not: null },
          counts_for_leaderboard: true,
          deleted_at: null,
        };

        const [allFactions, total_games] = await Promise.all([
          getFactionsWithStats(fastify.prisma, resolvedSeasonId),
          fastify.prisma.matchGame.count({ where: { status: 'COMPLETED', match: globalMatchWhere } }),
        ]);

        // Coverage × Evenness:
        //   coverage = played_factions / total_factions  (penalises unplayed factions)
        //   evenness = Pielou's J over played factions   (penalises imbalance)
        //   diversity = coverage × evenness
        // Result: 100% only when all factions are played equally; 50% coverage with
        // perfect evenness → 50%; intuitive for users.
        const played = allFactions.map((f) => f.stats?.matches_played ?? 0);
        const totalPlayed = played.reduce((s, v) => s + v, 0);
        let faction_diversity = 0;
        if (totalPlayed > 0) {
          const active = played.filter((v) => v > 0);
          const coverage = active.length / allFactions.length;
          const H = -active.reduce((s, v) => {
            const p = v / totalPlayed;
            return s + p * Math.log(p);
          }, 0);
          const Hmax = Math.log(active.length);
          const evenness = Hmax > 0 ? H / Hmax : 1;
          faction_diversity = coverage * evenness;
        }

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
          total_games,
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
      tournamentSlug: z.string().optional(),
      factionId: z.string().optional(),
      opponentFactionId: z.string().optional(),
      playerId: z.string().uuid().optional(),
      // Admin "All Games" search (all optional, AND-combined, case-insensitive substrings):
      q: z.string().trim().optional(),            // player-name words (each must match a player)
      winner: z.string().trim().optional(),       // winner's username
      map: z.string().trim().optional(),          // picked map name
      faction: z.string().trim().optional(),      // either faction slug
      tournament: z.string().trim().optional(),   // tournament name, or "ladder"/"open"/"queue" for Open Play
    }).safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const { page, limit, tournamentSlug, factionId, opponentFactionId, playerId } = parsed.data;
    const { q, winner, map: mapQ, faction: factionQ, tournament: tournamentQ } = parsed.data;
    const skip = (page - 1) * limit;
    const ci = (contains: string) => ({ contains, mode: 'insensitive' as const });

    // Pre-resolve the winner (username → user ids) and map (name → map ids) filters.
    const winnerIds = winner
      ? (await fastify.prisma.user.findMany({ where: { username: ci(winner) }, select: { id: true } })).map((u) => u.id)
      : null;
    const mapIdsFilter = mapQ
      ? (await fastify.prisma.map.findMany({ where: { name: ci(mapQ) }, select: { id: true } })).map((m) => m.id)
      : null;

    // Player-name search: each word must match player1 OR player2 (so "Rizz Welsh" = their head-to-head).
    const playerNameAnd = q
      ? q.split(/\s+/).filter(Boolean).map((w) => ({
          OR: [{ player1: { username: ci(w) } }, { player2: { username: ci(w) } }],
        }))
      : [];
    const isLadderQ = tournamentQ ? /^(ladder|open( ?play)?|queue)$/i.test(tournamentQ) : false;

    // Faction filter at the game level — games are the statistical unit and now always
    // carry their own factions (no participant/match fallback). When both factionId and
    // opponentFactionId are given, match either orientation within a single game.
    const gameFactionFilter = factionId && opponentFactionId
      ? {
          OR: [
            { player1_faction_id: factionId, player2_faction_id: opponentFactionId },
            { player2_faction_id: factionId, player1_faction_id: opponentFactionId },
          ],
        }
      : factionId
        ? { OR: [{ player1_faction_id: factionId }, { player2_faction_id: factionId }] }
        : {};

    // Source set: COMPLETED games on real, non-voided, non-deleted matches. Draws count
    // (no winner_id filter); admin-voided matches (counts_for_leaderboard = false) are
    // excluded. The match's lifecycle status is intentionally not filtered — a real game
    // stays listed even if its container was later cancelled.
    const gameWhere = {
      status: 'COMPLETED' as const,
      ...gameFactionFilter,
      // faction:<text> — either side's faction slug contains the text.
      ...(factionQ ? { OR: [{ player1_faction_id: ci(factionQ) }, { player2_faction_id: ci(factionQ) }] } : {}),
      // winner:<name> — resolved to user ids above (empty list → no match).
      ...(winnerIds ? { winner_id: { in: winnerIds } } : {}),
      // map:<name> — resolved to map ids above, matched via the game's map decision.
      ...(mapIdsFilter ? { map_decision: { picked_map_id: { in: mapIdsFilter } } } : {}),
      match: {
        player1_id: { not: null },
        player2_id: { not: null },
        counts_for_leaderboard: true,
        ...(tournamentSlug ? { tournament: { slug: tournamentSlug, deleted_at: null } } : { deleted_at: null }),
        ...(playerId ? { OR: [{ player1_id: playerId }, { player2_id: playerId }] } : {}),
        // q:<words> — each word matches at least one of the two players.
        ...(playerNameAnd.length ? { AND: playerNameAnd } : {}),
        // tournament:<name> or the "ladder"/"open play" shortcut for non-tournament games.
        ...(tournamentQ
          ? isLadderQ
            ? { tournament_id: null }
            : { tournament: { name: ci(tournamentQ), deleted_at: null } }
          : {}),
      },
    };

    const [games, total] = await Promise.all([
      fastify.prisma.matchGame.findMany({
        where: gameWhere,
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
              source: true,
              player1: { select: { id: true, username: true, avatar_url: true } },
              player2: { select: { id: true, username: true, avatar_url: true } },
              tournament: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { played_at: 'desc' },
        skip,
        take: limit,
      }),
      fastify.prisma.matchGame.count({ where: gameWhere }),
    ]);

    const rows = games.map((g) => ({
      round: g.match.round,
      matchNumber: g.match.match_number,
      player1: g.match.player1 ?? null,
      player2: g.match.player2 ?? null,
      tournament: g.match.tournament,
      matchSource: g.match.source ?? null,
      matchId: g.match.id,
      id: g.id,
      gameNumber: g.game_number,
      playedAt: (g.played_at ?? g.match.played_at)?.toISOString() ?? null,
      winnerId: g.winner_id,
      player1FactionId: g.player1_faction_id,
      player2FactionId: g.player2_faction_id,
      mapPickedId: g.map_decision?.picked_map_id ?? null,
      replayUrl: g.replay_url,
      countsForLeaderboard: g.counts_for_leaderboard,
    }));

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

  // -------------------------------------------------------------------------
  // GET /api/meta/standard-ruleset
  // Public — the community Standard Ruleset (admin-editable, defaults otherwise).
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/standard-ruleset', async () => {
    return resolveStandardRuleset();
  });
};

export default metaRoutes;
