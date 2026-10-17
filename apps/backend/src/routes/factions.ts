import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@rizzotto/db';
import { SQL_NOT_TEAM_MATCH } from '../lib/stat-eligibility.js';
import { z } from 'zod';
import { BATTLE_TYPES } from '@rizzotto/types';
import { cached, cacheKey } from '../lib/cache.js';
import {
  asFactionDto,
  asFactionStatsDto,
  combineFactionStatsAllTime,
  getFactionsWithStats,
  getVersionDecayWeights,
} from '../lib/factions.js';
import { getProficiencyModel, factionProficiencySkill } from '../lib/breakdown-service.js';
import { logistic } from '../lib/rating-model.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const VersionQuerySchema = z.object({
  // A version UUID, or 'all' → the 1/k-decayed All-Time amalgam (Alex 2026-09-08).
  versionId: z.union([z.string().uuid(), z.literal('all')]).optional(),
});

const FactionDetailQuerySchema = VersionQuerySchema.extend({
  battleType: z.enum(BATTLE_TYPES).default('DOMINATION'),
});

const TopPlayersQuerySchema = VersionQuerySchema.extend({
  battleType: z.enum(BATTLE_TYPES).optional(), // omitted = every type
});

const FactionParamSchema = z.object({
  id: z.string().min(1),
});

/** Synthetic "version" the API returns for the All-Time (versionId='all') amalgam — the frontend
 *  selector shows the name; dates are empty because it spans every version. */
const ALL_TIME_VERSION = { id: 'all', name: 'All-Time', start_date: '', end_date: '', is_active: false, dlc_tag: null };

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

const factionsRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/factions?versionId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/factions', async (request, reply) => {
    const parsed = VersionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const { versionId } = parsed.data;
    const allTime = versionId === 'all';

    // Resolve version. A specific versionId must exist; otherwise fall back to the
    // active version — but NO active version is fine: faction master data (names,
    // icons) is global reference data and must never be gated behind a version.
    // In that case stats simply come back null. 'all' = the All-Time amalgam.
    let version = null;
    if (!allTime) {
      if (versionId) {
        version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
        if (!version) {
          return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
        }
      } else {
        version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
      }
    }

    const resolvedVersionId = allTime ? 'all' : (version?.id ?? null);

    return cached(
      fastify.redis,
      cacheKey('factions:list', { versionId: resolvedVersionId ?? 'none' }),
      async () => {
        const data = await getFactionsWithStats(fastify.prisma, resolvedVersionId);
        return {
          data,
          version: allTime
            ? ALL_TIME_VERSION
            : version
              ? {
                  id: version.id,
                  name: version.name,
                  start_date: version.start_date.toISOString(),
                  end_date: version.end_date.toISOString(),
                  is_active: version.is_active,
                  dlc_tag: version.dlc_tag ?? null,
                }
              : null,
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/factions/:id?versionId=<uuid>
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/:id', async (request, reply) => {
    const paramParsed = FactionParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: paramParsed.error.message,
        statusCode: 400,
      });
    }

    const queryParsed = FactionDetailQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: queryParsed.error.message,
        statusCode: 400,
      });
    }

    const { id } = paramParsed.data;
    const { versionId, battleType } = queryParsed.data;
    const allTime = versionId === 'all';

    // Resolve version. As with the list endpoint, NO active version is fine: the
    // faction's master data is global reference data. Only stats + trend are
    // version-scoped and simply come back null/empty without one. 'all' = All-Time.
    let version = null;
    if (!allTime) {
      if (versionId) {
        version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
        if (!version) {
          return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
        }
      } else {
        version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
      }
    }

    const resolvedVersionId = allTime ? 'all' : (version?.id ?? null);

    // Check faction existence before caching
    const faction = await fastify.prisma.faction.findUnique({ where: { id } });
    if (!faction) {
      return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });
    }

    return cached(
      fastify.redis,
      cacheKey('factions:detail', { id, versionId: resolvedVersionId ?? 'none', battleType }),
      async () => {
        let statsDto = null;
        if (allTime) {
          // All-Time: combine this faction's per-version FactionStats with the 1/k decay.
          const [weights, allStats] = await Promise.all([
            getVersionDecayWeights(fastify.prisma),
            fastify.prisma.factionStats.findMany({ where: { faction_id: id, battle_type: battleType } }),
          ]);
          const perVersion = allStats
            .map((s) => ({ stats: asFactionStatsDto(s), weight: weights.get(s.version_id) ?? 0 }))
            .filter((x) => x.weight > 0);
          statsDto = combineFactionStatsAllTime(perVersion);
        } else if (resolvedVersionId) {
          const stats = await fastify.prisma.factionStats.findUnique({
            where: {
              faction_id_version_id_battle_type: {
                faction_id: id,
                version_id: resolvedVersionId,
                battle_type: battleType,
              },
            },
          });
          statsDto = stats ? asFactionStatsDto(stats) : null;
        }

        // 30-day snapshot trend — a single-version window; empty for All-Time (spans all versions).
        let trend: { date: string; matches_played: number; win_rate: number | null }[] = [];
        if (!allTime && resolvedVersionId) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          const snapshots = await fastify.prisma.factionStatsSnapshot.findMany({
            where: {
              faction_id: id,
              version_id: resolvedVersionId,
              battle_type: battleType,
              snapshot_date: { gte: thirtyDaysAgo },
            },
            orderBy: { snapshot_date: 'asc' },
          });

          trend = snapshots.map((s) => ({
            date: s.snapshot_date.toISOString().split('T')[0]!,
            matches_played: s.matches_played,
            win_rate: s.matches_played > 0 ? s.wins / s.matches_played : null,
          }));
        }

        return {
          faction: asFactionDto(faction),
          stats: statsDto,
          trend,
          version: allTime
            ? ALL_TIME_VERSION
            : version
              ? {
                  id: version.id,
                  name: version.name,
                  start_date: version.start_date.toISOString(),
                  end_date: version.end_date.toISOString(),
                  is_active: version.is_active,
                  dlc_tag: version.dlc_tag ?? null,
                }
              : null,
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/factions/:id/top-players?versionId=&battleType=
  // Best players with this faction (min 5 games) in the page's selected version and battle type.
  // Omitted/'all' version = every version; omitted battle type = every type (Overall).
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/:id/top-players', async (request, reply) => {
    const paramParsed = FactionParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: paramParsed.error.message, statusCode: 400 });
    }
    const { id } = paramParsed.data;
    const queryParsed = TopPlayersQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: queryParsed.error.message, statusCode: 400 });
    }
    const scopedVersionId =
      queryParsed.data.versionId && queryParsed.data.versionId !== 'all' ? queryParsed.data.versionId : null;
    const { battleType } = queryParsed.data;

    const faction = await fastify.prisma.faction.findUnique({ where: { id }, select: { id: true } });
    if (!faction) return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });

    // Match.version_id lives in the legacy "season_id" column.
    const versionFilter = scopedVersionId ? Prisma.sql`AND m.season_id::text = ${scopedVersionId}` : Prisma.empty;
    const battleTypeFilter = battleType ? Prisma.sql`AND mg.battle_type::text = ${battleType}` : Prisma.empty;

    return cached(
      fastify.redis,
      cacheKey('factions:top-players', { id, versionId: scopedVersionId ?? 'all', battleType: battleType ?? 'OVERALL' }),
      async () => {
        type RawRow = { user_id: string; games: bigint; wins: bigint };
        const rows = await fastify.prisma.$queryRaw<RawRow[]>`
          SELECT
            CASE
              WHEN mg.player1_faction_id = ${id} THEN m.player1_id
              ELSE m.player2_id
            END AS user_id,
            COUNT(*)::bigint AS games,
            SUM(CASE
              WHEN mg.winner_id IS NOT NULL
                AND mg.winner_id = CASE
                  WHEN mg.player1_faction_id = ${id} THEN m.player1_id
                  ELSE m.player2_id
                END
              THEN 1 ELSE 0
            END)::bigint AS wins
          FROM "MatchGame" mg
          JOIN "Match" m ON mg.match_id = m.id
          WHERE (mg.player1_faction_id = ${id} OR mg.player2_faction_id = ${id})
            AND mg.counts_for_leaderboard = true
            AND m.status = 'COMPLETED'
            AND m.deleted_at IS NULL
            AND m.player1_id IS NOT NULL
            AND m.player2_id IS NOT NULL
            AND ${SQL_NOT_TEAM_MATCH}
            ${versionFilter}
            ${battleTypeFilter}
          GROUP BY user_id
          HAVING COUNT(*) >= 5
          ORDER BY (CAST(SUM(CASE
            WHEN mg.winner_id IS NOT NULL
              AND mg.winner_id = CASE
                WHEN mg.player1_faction_id = ${id} THEN m.player1_id
                ELSE m.player2_id
              END
            THEN 1 ELSE 0
          END) AS float) / NULLIF(COUNT(*), 0)) DESC NULLS LAST, games DESC
          LIMIT 15
        `;

        if (rows.length === 0) return { players: [] };

        const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
        const users = await fastify.prisma.user.findMany({
          where: { id: { in: userIds }, deleted_at: null },
          select: { id: true, username: true, avatar_url: true },
        });
        const userById = new Map(users.map((u) => [u.id, u]));

        // Proficiency exactly as the player's profile shows it for the same version + battle type (the
        // shared hierarchical fit). It used to read an unscoped active-version model that has no
        // player × faction entries, so every player showed the 0.5 default.
        const model = await getProficiencyModel(fastify.prisma, fastify.redis, scopedVersionId, battleType);

        const players = rows
          .map((r) => {
            const user = userById.get(r.user_id);
            if (!user) return null;
            const games = Number(r.games);
            const wins = Number(r.wins);
            return {
              userId: user.id,
              username: user.username,
              avatarUrl: user.avatar_url,
              games,
              wins,
              winRate: games > 0 ? wins / games : null,
              proficiency: logistic(factionProficiencySkill(model, user.id, id, battleType)),
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);

        return { players };
      },
      { ttlSeconds: 120 },
    );
  });
};

export default factionsRoutes;
