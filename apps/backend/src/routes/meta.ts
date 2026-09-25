import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { asFactionDto, getFactionsWithStats } from '../lib/factions.js';
import { getMatchupMatrix } from '../lib/heatmap.js';
import { resolveStandardRuleset, resolveAllStandardRulesets } from '../lib/standard-ruleset.js';
import { resolveCompetitors } from '../lib/competitors.js';
import { computeDuoMeta } from '../lib/duo-meta.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;

// Meta views are sliced by version × battle type. `battleType` defaults to DOMINATION
// (the standard) when omitted so the dashboard has a sensible first render.
const VersionQuerySchema = z.object({
  // A version UUID, or the literal 'all' → the 1/k-decayed All-Time amalgam (Alex 2026-09-08).
  versionId: z.union([z.string().uuid(), z.literal('all')]).optional(),
  battleType: z.enum(BATTLE_TYPES).optional(),
});

/** Synthetic "version" returned for the All-Time (versionId='all') amalgam — spans every version,
 *  so it has no dates; the frontend selector just shows the name. */
const ALL_TIME_VERSION = { id: 'all', name: 'All-Time', start_date: '', end_date: '', is_active: false, dlc_tag: null };

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

const metaRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/meta/overview?versionId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/overview', async (request, reply) => {
    const parsed = VersionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { versionId } = parsed.data;
    const battleType = parsed.data.battleType ?? 'DOMINATION';

    // Resolve version. 'all' = the 1/k-decayed All-Time amalgam (spans every version).
    const allTime = versionId === 'all';
    let version = null;
    if (!allTime) {
      if (versionId) {
        version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
        if (!version) {
          return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
        }
      } else {
        version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
        if (!version) {
          return {
            version: null,
            top_factions_by_winrate: [],
            top_factions_by_pickrate: [],
            total_games: 0,
            faction_diversity: 0,
          };
        }
      }
    }

    const resolvedVersionId = allTime ? 'all' : version!.id;

    return cached(
      fastify.redis,
      cacheKey('meta:overview', { versionId: resolvedVersionId, battleType }),
      async () => {
        // total_games counts the games behind THIS view: the selected version, battle type,
        // and 1v1 (the overview is the 1v1 faction meta; 2v2 has its own duo view). Games are
        // the statistical unit — a draw IS a played game (no winner_id filter); admin-voided
        // matches (counts_for_leaderboard = false) are excluded. The match's lifecycle status
        // is intentionally NOT filtered — a real game stays counted even if its container was
        // later cancelled.
        const overviewMatchWhere = {
          // All-Time counts games across every version (total_games is a raw count, not a decayed
          // stat — the decay lives in the per-faction win/pick numbers via getFactionsWithStats).
          ...(allTime ? {} : { version_id: resolvedVersionId }),
          player1_id: { not: null },
          player2_id: { not: null },
          counts_for_leaderboard: true,
          deleted_at: null,
          NOT: { tournament: { competitor_format: 'TWO_V_TWO' as const } },
        };

        const [allFactions, total_games] = await Promise.all([
          getFactionsWithStats(fastify.prisma, resolvedVersionId, battleType),
          fastify.prisma.matchGame.count({
            where: { status: 'COMPLETED', battle_type: battleType, match: overviewMatchWhere },
          }),
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
          version: allTime
            ? ALL_TIME_VERSION
            : {
                id: version!.id,
                name: version!.name,
                start_date: version!.start_date.toISOString(),
                end_date: version!.end_date.toISOString(),
                is_active: version!.is_active,
                dlc_tag: version!.dlc_tag ?? null,
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
  // GET /api/meta/matchups?versionId=<uuid>
  // Returns 24x24 matchup matrix (faction-A vs faction-B) for the requested
  // version — aggregated from `MatchupStats` via `getMatchupMatrix()`.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/matchups', async (request, reply) => {
    const parsed = VersionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { versionId } = parsed.data;
    const battleType = parsed.data.battleType ?? 'DOMINATION';

    // Resolve version. 'all' = the 1/k-decayed All-Time matchup amalgam (getMatchupMatrix weights
    // each game by its version's decay).
    const allTime = versionId === 'all';
    let version = null;
    if (!allTime) {
      if (versionId) {
        version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
        if (!version) {
          return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
        }
      } else {
        version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
        if (!version) {
          return {
            version_id: null,
            cells: [],
            factions: [],
          };
        }
      }
    }

    const resolvedVersionId = allTime ? 'all' : version!.id;

    return cached(
      fastify.redis,
      cacheKey('meta:matchups', { versionId: resolvedVersionId, battleType }),
      async () => {
        const [cells, factions] = await Promise.all([
          getMatchupMatrix(fastify.prisma, resolvedVersionId, battleType),
          fastify.prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
        ]);

        return {
          version_id: resolvedVersionId,
          cells,
          factions: factions.map(asFactionDto),
        };
      },
      { ttlSeconds: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/meta/duos?versionId=<uuid>&battleType=<type>
  // 2v2 only — the faction-duo meta (Top Winrate Duos + Most-picked Duos). The 24×24
  // matchup heatmap is infeasible for 2v2 (576 duos), so this replaces it. No minimum
  // games threshold (Alex: "lieber verzerrte Winrates als eine leere Liste"); Top 25 each.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/duos', async (request, reply) => {
    const parsed = VersionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { versionId } = parsed.data;
    const battleType = parsed.data.battleType ?? 'DOMINATION';

    // Resolve version. 'all' (All-Time) aggregates 2v2 duos across EVERY version (raw counts and raw
    // win rate — the 1/k win-rate decay isn't applied to duos yet; a weighted duo amalgam is a
    // follow-up). A UUID scopes to that version; no param falls back to the active version.
    const allTime = versionId === 'all';
    let resolvedVersionId: string | null;
    if (allTime) {
      resolvedVersionId = null;
    } else if (versionId) {
      const version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
      }
      resolvedVersionId = version.id;
    } else {
      const version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
      if (!version) {
        return { version_id: null, top_duos_by_winrate: [], top_duos_by_pickrate: [] };
      }
      resolvedVersionId = version.id;
    }

    return cached(
      fastify.redis,
      cacheKey('meta:duos', { versionId: resolvedVersionId ?? 'all', battleType }),
      async () => {
        const [duos, factions] = await Promise.all([
          computeDuoMeta(fastify.prisma, resolvedVersionId, battleType),
          fastify.prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
        ]);
        const factionById = new Map(factions.map((f) => [f.id, asFactionDto(f)]));
        const toDto = (d: (typeof duos)[number]) => ({
          factions: d.factionIds.map((id) => factionById.get(id) ?? null),
          games: d.games,
          wins: d.wins,
          win_rate: d.winRate,
        });

        // Most-picked: games desc, then win_rate. Top winrate: win_rate desc, then games (so a
        // heavily-played duo outranks a 1-0 curiosity at equal rate). No min-games threshold.
        const byPickrate = [...duos].sort((a, b) => b.games - a.games || b.winRate - a.winRate);
        const byWinrate = [...duos].sort((a, b) => b.winRate - a.winRate || b.games - a.games);

        return {
          version_id: resolvedVersionId,
          top_duos_by_winrate: byWinrate.slice(0, 25).map(toDto),
          top_duos_by_pickrate: byPickrate.slice(0, 25).map(toDto),
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
      competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).optional(), // team-size filter (meta tab)
      versionId: z.union([z.string().uuid(), z.literal('all')]).optional(), // version filter (meta tab); 'all' = All-Time
      battleType: z.enum(BATTLE_TYPES).optional(),                      // battle-type filter (meta tab)
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

    const { page, limit, tournamentSlug, factionId, opponentFactionId, playerId, competitorFormat } = parsed.data;
    const { versionId: gamesVersionId, battleType: gamesBattleType } = parsed.data;
    const { q, winner, map: mapQ, faction: factionQ, tournament: tournamentQ } = parsed.data;
    const skip = (page - 1) * limit;
    const ci = (contains: string) => ({ contains, mode: 'insensitive' as const });

    // Competitor names are opaque: a slot may be a User (1v1) or a Team (2v2). Resolve a
    // free-text name to matching competitor ids across BOTH tables, then filter by id.
    const resolveNameToCompetitorIds = async (text: string): Promise<string[]> => {
      const [users, teams] = await Promise.all([
        fastify.prisma.user.findMany({ where: { username: ci(text) }, select: { id: true } }),
        fastify.prisma.team.findMany({ where: { name: ci(text) }, select: { id: true } }),
      ]);
      return [...users.map((u) => u.id), ...teams.map((t) => t.id)];
    };

    // Pre-resolve the winner (name → competitor ids) and map (name → map ids) filters.
    const winnerIds = winner ? await resolveNameToCompetitorIds(winner) : null;
    const mapIdsFilter = mapQ
      ? (await fastify.prisma.map.findMany({ where: { name: ci(mapQ) }, select: { id: true } })).map((m) => m.id)
      : null;

    // Player-name search: each word must match player1 OR player2 (so "Rizz Welsh" = their head-to-head).
    const playerNameAnd = q
      ? await Promise.all(
          q
            .split(/\s+/)
            .filter(Boolean)
            .map(async (w) => {
              const ids = await resolveNameToCompetitorIds(w);
              return { OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] };
            }),
        )
      : [];
    const isLadderQ = tournamentQ ? /^(ladder|open( ?play)?|queue)$/i.test(tournamentQ) : false;

    // Team-size filter. 2v2 ⇒ the match's tournament is competitor_format TWO_V_TWO.
    // 1v1 ⇒ everything that isn't (incl. Open Play, whose tournament is null). Applied via
    // the match AND array so it composes with the tournament name/slug filters without
    // colliding on the `tournament` key.
    const competitorFormatCond =
      competitorFormat === 'TWO_V_TWO'
        ? [{ tournament: { competitor_format: 'TWO_V_TWO' as const } }]
        : competitorFormat === 'ONE_V_ONE'
          ? [{ NOT: { tournament: { competitor_format: 'TWO_V_TWO' as const } } }]
          : [];
    const matchAnd = [...playerNameAnd, ...competitorFormatCond];

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
      // battleType — meta-tab battle-type selector (per-game column).
      ...(gamesBattleType ? { battle_type: gamesBattleType } : {}),
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
        // versionId — meta-tab version selector; 'all' = All-Time (no version filter).
        ...(gamesVersionId && gamesVersionId !== 'all' ? { version_id: gamesVersionId } : {}),
        ...(tournamentSlug ? { tournament: { slug: tournamentSlug, deleted_at: null } } : { deleted_at: null }),
        ...(playerId ? { OR: [{ player1_id: playerId }, { player2_id: playerId }] } : {}),
        // q:<words> — each word matches at least one of the two players; plus the team-size filter.
        ...(matchAnd.length ? { AND: matchAnd } : {}),
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
          battle_type: true,
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
              player1_id: true,
              player2_id: true,
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

    // Slots are opaque competitor ids (User 1v1 / Team 2v2) — resolve to display shapes.
    const competitorMap = await resolveCompetitors(
      fastify.prisma,
      games.flatMap((g) => [g.match.player1_id, g.match.player2_id]),
    );
    const compDto = (cid: string | null) => {
      const c = cid ? competitorMap.get(cid) : undefined;
      return c ? { id: c.id, username: c.username, avatar_url: c.avatar_url, type: c.type } : null;
    };

    const rows = games.map((g) => ({
      round: g.match.round,
      matchNumber: g.match.match_number,
      player1: compDto(g.match.player1_id),
      player2: compDto(g.match.player2_id),
      tournament: g.match.tournament,
      matchSource: g.match.source ?? null,
      matchId: g.match.id,
      id: g.id,
      gameNumber: g.game_number,
      playedAt: (g.played_at ?? g.match.played_at)?.toISOString() ?? null,
      winnerId: g.winner_id,
      player1FactionId: g.player1_faction_id,
      player2FactionId: g.player2_faction_id,
      battleType: g.battle_type,
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
  // GET /api/meta/standard-ruleset?battleType=&competitorFormat=
  // Public — the community Standard Ruleset for one (battle type × team size) combo
  // (admin-editable, defaults otherwise). Defaults to Domination / 1v1.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/standard-ruleset', async (request) => {
    const q = z
      .object({
        battleType: z.enum(BATTLE_TYPES).optional(),
        competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).optional(),
      })
      .safeParse(request.query);
    const battleType = q.success ? q.data.battleType : undefined;
    const competitorFormat = q.success ? q.data.competitorFormat : undefined;
    return resolveStandardRuleset(battleType ?? 'DOMINATION', competitorFormat ?? 'ONE_V_ONE');
  });

  // -------------------------------------------------------------------------
  // GET /api/meta/standard-rulesets
  // Public — all 6 (battle type × team size) rulesets, defaults filled. Powers the
  // admin editor (which edits every combo) and any client that wants them all.
  // -------------------------------------------------------------------------
  fastify.get('/api/meta/standard-rulesets', async () => {
    return { rulesets: await resolveAllStandardRulesets() };
  });
};

export default metaRoutes;
