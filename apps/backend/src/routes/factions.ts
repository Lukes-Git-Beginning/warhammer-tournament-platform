import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import {
  asFactionDto,
  asFactionStatsDto,
  getFactionsWithStats,
} from '../lib/factions.js';
import { getRatingModel } from '../lib/rating-model-service.js';
import { logistic } from '../lib/rating-model.js';

// ---------------------------------------------------------------------------
// Query Schemas
// ---------------------------------------------------------------------------

const VersionQuerySchema = z.object({
  versionId: z.string().uuid().optional(),
});

const FactionParamSchema = z.object({
  id: z.string().min(1),
});

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

    // Resolve version. A specific versionId must exist; otherwise fall back to the
    // active version — but NO active version is fine: faction master data (names,
    // icons) is global reference data and must never be gated behind a version.
    // In that case stats simply come back null.
    let version;
    if (versionId) {
      version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
      }
    } else {
      version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
    }

    const resolvedVersionId = version?.id ?? null;

    return cached(
      fastify.redis,
      cacheKey('factions:list', { versionId: resolvedVersionId ?? 'none' }),
      async () => {
        const data = await getFactionsWithStats(fastify.prisma, resolvedVersionId);
        return {
          data,
          version: version
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

    const queryParsed = VersionQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: queryParsed.error.message,
        statusCode: 400,
      });
    }

    const { id } = paramParsed.data;
    const { versionId } = queryParsed.data;

    // Resolve version. As with the list endpoint, NO active version is fine: the
    // faction's master data is global reference data. Only stats + trend are
    // version-scoped and simply come back null/empty without one.
    let version;
    if (versionId) {
      version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
      }
    } else {
      version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
    }

    const resolvedVersionId = version?.id ?? null;

    // Check faction existence before caching
    const faction = await fastify.prisma.faction.findUnique({ where: { id } });
    if (!faction) {
      return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });
    }

    return cached(
      fastify.redis,
      cacheKey('factions:detail', { id, versionId: resolvedVersionId ?? 'none' }),
      async () => {
        // TODO(meta): battle-type filter. The detail view shows Domination stats for
        // now (primary mode + the only populated type initially); an "all types"
        // aggregate + a battle-type dropdown follow with the meta API filter.
        const stats = resolvedVersionId
          ? await fastify.prisma.factionStats.findUnique({
              where: {
                faction_id_version_id_battle_type: {
                  faction_id: id,
                  version_id: resolvedVersionId,
                  battle_type: 'DOMINATION',
                },
              },
            })
          : null;

        // 30-day snapshot trend — version-scoped, empty without a version.
        let trend: { date: string; matches_played: number; win_rate: number | null }[] = [];
        if (resolvedVersionId) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          const snapshots = await fastify.prisma.factionStatsSnapshot.findMany({
            where: {
              faction_id: id,
              version_id: resolvedVersionId,
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
          stats: stats ? asFactionStatsDto(stats) : null,
          trend,
        };
      },
      { ttlSeconds: 60 },
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/factions/:id/top-players
  // Top players by game count with this faction (min 3 games), all-time.
  // -------------------------------------------------------------------------
  fastify.get('/api/factions/:id/top-players', async (request, reply) => {
    const paramParsed = FactionParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: paramParsed.error.message, statusCode: 400 });
    }
    const { id } = paramParsed.data;

    const faction = await fastify.prisma.faction.findUnique({ where: { id }, select: { id: true } });
    if (!faction) return reply.code(404).send({ error: 'NotFound', message: 'Faction not found', statusCode: 404 });

    return cached(
      fastify.redis,
      cacheKey('factions:top-players', { id }),
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

        // Resolve active version for proficiency computation.
        const activeVersion = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });

        const rawPlayers = rows
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
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);

        // Attach per-faction proficiency (neutralWinChance) for each player.
        // The version-wide rating model is fitted once (cached, event-invalidated)
        // and already holds every player's skill for this faction, so we read it
        // directly — no per-player query. Same value & freshness as the profile
        // page (both derive from this one model). Unknown pairs default to 0 skill
        // → logistic(0) = 0.5; top players always have a fitted entry here.
        let players: (typeof rawPlayers[number] & { proficiency: number | null })[];
        if (activeVersion) {
          const model = await getRatingModel(fastify.prisma, fastify.redis, {
            versionId: activeVersion.id,
          });
          players = rawPlayers.map((p) => ({
            ...p,
            proficiency: logistic(model.getPlayerFactionSkill(p.userId, id)),
          }));
        } else {
          players = rawPlayers.map((p) => ({ ...p, proficiency: null }));
        }

        return { players };
      },
      { ttlSeconds: 120 },
    );
  });
};

export default factionsRoutes;
