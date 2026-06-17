import type { FastifyPluginAsync } from 'fastify';
import {
  UpdateMeSchema,
  UpdateOnboardingStageSchema,
  UpdateUserRoleRequestSchema,
  H2HResponseSchema,
  type H2HResponse,
} from '@rizzotto/types';
import { z } from 'zod';
import { cached, cacheKey, invalidate } from '../lib/cache.js';
import { getPlayerSeasonStats, getPlayerAllTimeStats } from '../lib/leaderboard-service.js';

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
  steam_link: {
    select: {
      steam_id: true,
      persona: true,
      avatar_url: true,
      verified_at: true,
    },
  },
} as const;

type SteamLinkRow = {
  steam_id: string;
  persona: string;
  avatar_url: string | null;
  verified_at: Date;
};

type MeRow = {
  id: string;
  discord_id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  timezone: string | null;
  role: 'USER' | 'HOST' | 'ORGANIZER' | 'MODERATOR' | 'ADMIN';
  preferred_factions: string[];
  last_login: Date | null;
  onboarded_at: Date | null;
  onboarding_stage: number;
  created_at: Date;
  steam_link: SteamLinkRow | null;
};

function serializeMe(user: MeRow) {
  const { steam_link, ...rest } = user;
  return {
    ...rest,
    last_login: user.last_login?.toISOString() ?? null,
    onboarded_at: user.onboarded_at?.toISOString() ?? null,
    created_at: user.created_at.toISOString(),
    steam_link: steam_link
      ? {
          steam_id: steam_link.steam_id,
          steam_username: steam_link.persona,
          steam_avatar_url: steam_link.avatar_url,
          linked_at: steam_link.verified_at.toISOString(),
        }
      : null,
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
        search: z.string().max(50).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        sortBy: z.enum(['username', 'created_at', 'role', 'is_banned']).default('username'),
        sortDir: z.enum(['asc', 'desc']).default('asc'),
      });

      const parsed = SearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const { search, page, limit, sortBy, sortDir } = parsed.data;
      const skip = (page - 1) * limit;

      const searchFilter = search && search.length >= 2
        ? { OR: [{ username: { contains: search, mode: 'insensitive' as const } }, { discord_id: search }] }
        : {};

      // is_banned is derived from deleted_at (non-null = banned), sort by that column
      const orderBy = sortBy === 'is_banned'
        ? { deleted_at: sortDir }
        : { [sortBy]: sortDir };

      const [users, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where: {
            ...searchFilter,
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
            steam_link: { select: { steam_id: true } },
          },
          orderBy,
          skip,
          take: limit,
        }),
        fastify.prisma.user.count({
          where: {
            deleted_at: null,
            ...searchFilter,
          },
        }),
      ]);

      return {
        users: users.map((u) => ({
          id: u.id,
          discord_id: u.discord_id,
          steam_id: u.steam_link?.steam_id ?? null,
          username: u.username,
          email: u.email,
          avatar_url: u.avatar_url,
          role: u.role,
          created_at: u.created_at.toISOString(),
          is_banned: u.deleted_at !== null,
        })),
        total,
        page,
        limit,
      };
    },
  );

  // GET /api/users/:id/stats — Personal Stats. The former ?season= query param
  // never filtered anything (the resolved id was unused); it is now ignored.
  fastify.get(
    '/api/users/:id/stats',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const user = await fastify.prisma.user.findUnique({
        where: { id, deleted_at: null },
        select: { id: true, username: true },
      });
      if (!user) {
        return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
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
          games: {
            where: { game_number: 1 },
            select: { map_decision: { select: { picked_map_id: true } } },
            take: 1,
          },
        },
      });

      // Total wins/losses
      const totalWins = recentMatches.filter((m) => m.winner_id === id).length;
      const totalLosses = recentMatches.filter((m) => m.winner_id !== null && m.winner_id !== id).length;

      const matchHistory = recentMatches.map((m) => {
        const isPlayer1 = m.player1_id === id;
        const opponentUser = isPlayer1 ? m.player2 : m.player1;
        const myFaction = isPlayer1 ? m.player1_faction : m.player2_faction;
        const opponentFaction = isPlayer1 ? m.player2_faction : m.player1_faction;
        const won = m.winner_id === id;
        return {
          tournament_slug: m.tournament?.slug ?? null,
          opponent_username: opponentUser?.username ?? null,
          my_score: won ? 1 : 0,
          opponent_score: won ? 0 : 1,
          my_faction: myFaction ? { id: myFaction.id, name: myFaction.name } : null,
          opponent_faction: opponentFaction ? { id: opponentFaction.id, name: opponentFaction.name } : null,
          map_id: m.games[0]?.map_decision?.picked_map_id ?? null,
          played_at: m.updated_at.toISOString(),
          won,
        };
      });

      return {
        match_history: matchHistory,
        total_wins: totalWins,
        total_losses: totalLosses,
        win_rate: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0,
      };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/users/:a/vs/:b — Head-to-Head stats between two players
  // Auth: same gating as GET /api/users/:id/stats (authenticate required)
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/users/:a/vs/:b',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      // --- Param + query validation ---
      const paramSchema = z.object({
        a: z.string().uuid(),
        b: z.string().uuid(),
      });
      const paramParsed = paramSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: paramParsed.error.message,
          statusCode: 400,
        });
      }
      const { a, b } = paramParsed.data;

      const querySchema = z.object({
        season_id: z.string().uuid().optional(),
      });
      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: queryParsed.error.message,
          statusCode: 400,
        });
      }
      const { season_id } = queryParsed.data;

      // --- Cache wrapper ---
      const compute = async (): Promise<H2HResponse> => {
        // Load both users
        const [userA, userB] = await Promise.all([
          fastify.prisma.user.findUnique({
            where: { id: a, deleted_at: null },
            select: { id: true, username: true, avatar_url: true },
          }),
          fastify.prisma.user.findUnique({
            where: { id: b, deleted_at: null },
            select: { id: true, username: true, avatar_url: true },
          }),
        ]);

        if (!userA) {
          // Signal 404 via thrown error — caught below outside cached()
          throw Object.assign(new Error('User A not found'), { __h2h404: 'a' });
        }
        if (!userB) {
          throw Object.assign(new Error('User B not found'), { __h2h404: 'b' });
        }

        // H2H counts all completed games between the two players (including
        // draws, which have winner_id = null) on leaderboard-counting
        // tournaments. Deliberately broader than confirmedMatchWhere(), which
        // is decisive-only because it feeds the rating model.
        const baseWhere = {
          status: 'COMPLETED' as const,
          deleted_at: null,
          player1_id: { not: null },
          player2_id: { not: null },
          tournament: { counts_for_leaderboard: true },
          ...(season_id ? { season_id } : {}),
        };

        const matches = await fastify.prisma.match.findMany({
          where: {
            ...baseWhere,
            OR: [
              { player1_id: a, player2_id: b },
              { player1_id: b, player2_id: a },
            ],
          },
          orderBy: { played_at: 'desc' },
          include: {
            tournament: { select: { slug: true } },
            player1_faction: { select: { id: true, name: true } },
            player2_faction: { select: { id: true, name: true } },
          },
        });

        // --- Aggregate summary relative to player A ---
        let aWins = 0;
        let bWins = 0;
        let draws = 0;

        for (const m of matches) {
          if (m.winner_id === a) {
            aWins++;
          } else if (m.winner_id === b) {
            bWins++;
          } else {
            draws++;
          }
        }

        const total = aWins + bWins + draws;
        const winrateA = total > 0 ? aWins / total : 0;

        // --- Faction breakdown (grouped by the faction player A used) ---
        type FactionRow = {
          faction_id: string;
          faction_name: string;
          a_wins: number;
          b_wins: number;
          draws: number;
        };
        const factionMap = new Map<string, FactionRow>();

        for (const m of matches) {
          const aFaction = m.player1_id === a ? m.player1_faction : m.player2_faction;
          if (!aFaction) continue;

          const key = aFaction.id;
          let row = factionMap.get(key);
          if (!row) {
            row = { faction_id: key, faction_name: aFaction.name, a_wins: 0, b_wins: 0, draws: 0 };
            factionMap.set(key, row);
          }

          if (m.winner_id === a) row.a_wins++;
          else if (m.winner_id === b) row.b_wins++;
          else row.draws++;
        }

        const factionBreakdown = Array.from(factionMap.values());

        // --- Recent matches (last 5) — already sorted desc by played_at ---
        const recent = matches.slice(0, 5).map((m) => {
          const aFaction = m.player1_id === a ? m.player1_faction : m.player2_faction;
          const bFaction = m.player1_id === b ? m.player1_faction : m.player2_faction;
          return {
            id: m.id,
            played_at: m.played_at?.toISOString() ?? null,
            result: m.result ?? null,
            tournament_slug: m.tournament?.slug ?? null,
            player_a_faction: aFaction ? { id: aFaction.id, name: aFaction.name } : null,
            player_b_faction: bFaction ? { id: bFaction.id, name: bFaction.name } : null,
          };
        });

        return {
          player_a: { id: userA.id, username: userA.username, avatar_url: userA.avatar_url },
          player_b: { id: userB.id, username: userB.username, avatar_url: userB.avatar_url },
          summary: { a_wins: aWins, b_wins: bWins, draws, total },
          winrate_a: winrateA,
          faction_breakdown: factionBreakdown,
          recent_matches: recent,
        };
      };

      let result: H2HResponse;
      try {
        result = await cached(
          fastify.redis,
          cacheKey('h2h', { a, b, season: season_id ?? 'all' }),
          compute,
          { ttlSeconds: 60 },
        );
      } catch (err: unknown) {
        const h2hErr = err as { __h2h404?: string; message?: string };
        if (h2hErr.__h2h404) {
          return reply.code(404).send({
            error: 'NotFound',
            message: h2hErr.message ?? 'User not found',
            statusCode: 404,
          });
        }
        throw err;
      }

      return reply.code(200).send(H2HResponseSchema.parse(result));
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

    // current_season + all_time stats come from the dynamic leaderboard system
    // (lib/leaderboard-service.ts) — the single source of truth that also powers
    // the leaderboard page. LeaderboardEntry is NOT read here: it uses 3-point
    // scoring and drifts on void/cancel/edit, which is exactly the mismatch we fix.
    const activeSeason = await fastify.prisma.season.findFirst({ where: { is_active: true } });
    let currentSeasonEntry = null;
    if (activeSeason) {
      const seasonStats = await getPlayerSeasonStats(
        fastify.prisma,
        fastify.redis,
        activeSeason.id,
        id,
      );
      if (seasonStats.games_played > 0) {
        currentSeasonEntry = {
          season: {
            id: activeSeason.id,
            name: activeSeason.name,
            start_date: activeSeason.start_date.toISOString(),
            end_date: activeSeason.end_date.toISOString(),
            is_active: activeSeason.is_active,
          },
          total_points: seasonStats.total_points,
          games_played: seasonStats.games_played,
          wins: seasonStats.wins,
          losses: seasonStats.losses,
        };
      }
    }

    // All-time stats — summed across every season the player has confirmed games in.
    const allTime = await getPlayerAllTimeStats(fastify.prisma, fastify.redis, id);
    // "Tournaments played" = distinct tournaments the user actually took part in,
    // defined as having played at least one game. A game counts once it is COMPLETED
    // (win, loss, or the split games of a drawn match — all COMPLETED). A pure drop
    // produces a FORFEIT match with no COMPLETED game and therefore does NOT count,
    // matching the rule "a draw counts, a first-match drop does not". Participation-
    // based on purpose: independent of tournament finalization or TournamentResult.
    const playedTournamentRows = await fastify.prisma.match.findMany({
      where: {
        tournament_id: { not: null },
        deleted_at: null,
        OR: [{ player1_id: id }, { player2_id: id }],
        games: { some: { status: 'COMPLETED' } },
      },
      select: { tournament_id: true },
      distinct: ['tournament_id'],
    });
    const tournamentsPlayed = playedTournamentRows.length;

    // Recent tournaments — based on participation, merged with result data when available
    const recentParticipations = await fastify.prisma.tournamentParticipant.findMany({
      where: { user_id: id, deleted_at: null },
      orderBy: { registered_at: 'desc' },
      take: 10,
      select: {
        registered_at: true,
        tournament: {
          select: {
            slug: true,
            name: true,
            start_date: true,
            results: {
              where: { user_id: id },
              select: {
                placement: true,
                points_earned: true,
                created_at: true,
                season: { select: { name: true } },
              },
              take: 1,
            },
          },
        },
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
        games_played: allTime.games_played,
        wins: allTime.wins,
        losses: allTime.losses,
        tournaments_played: tournamentsPlayed,
        total_points: allTime.total_points,
      },
      recent_results: recentParticipations.map((p) => {
        const result = p.tournament.results[0] ?? null;
        return {
          tournament: {
            slug: p.tournament.slug,
            name: p.tournament.name,
            start_date: p.tournament.start_date.toISOString(),
          },
          season_name: result?.season?.name ?? null,
          placement: result?.placement ?? null,
          points_earned: result?.points_earned ?? null,
          created_at: result?.created_at.toISOString() ?? p.registered_at.toISOString(),
        };
      }),
      recent_matches: recentMatches.map((m) => {
        const opponentUser = m.player1_id === id ? m.player2 : m.player1;
        return {
          tournament: m.tournament ? { slug: m.tournament.slug, name: m.tournament.name } : null,
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
