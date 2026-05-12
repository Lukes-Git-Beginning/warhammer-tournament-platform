import type { PrismaClient } from '@tww3/db';
import { asFactionDto, asFactionStatsDto, getFactionsWithStats } from '../lib/factions.js';
import { getMatchupMatrix } from '../lib/heatmap.js';

// ---------------------------------------------------------------------------
// Context shape (injected by the mercurius context factory in plugins/graphql.ts)
// ---------------------------------------------------------------------------

interface GqlContext {
  prisma: PrismaClient;
  user: unknown | null;
}

// ---------------------------------------------------------------------------
// Season helpers (shared across resolvers)
// ---------------------------------------------------------------------------

async function resolveActiveSeason(prisma: PrismaClient, seasonId?: string | null) {
  if (seasonId) {
    return prisma.season.findUnique({ where: { id: seasonId } });
  }
  return prisma.season.findFirst({ where: { is_active: true } });
}

// ---------------------------------------------------------------------------
// Root Resolvers
// ---------------------------------------------------------------------------

export const resolvers = {
  Query: {
    // -----------------------------------------------------------------------
    // factions(seasonId: ID): FactionListResult!
    // -----------------------------------------------------------------------
    factions: async (
      _parent: unknown,
      args: { seasonId?: string | null },
      ctx: GqlContext,
    ) => {
      const season = await resolveActiveSeason(ctx.prisma, args.seasonId);
      if (!season) return { data: [], season: null };

      const data = await getFactionsWithStats(ctx.prisma, season.id);
      return {
        data,
        season: {
          id: season.id,
          name: season.name,
          start_date: season.start_date.toISOString(),
          end_date: season.end_date?.toISOString() ?? null,
          is_active: season.is_active,
          dlc_tag: season.dlc_tag ?? null,
        },
      };
    },

    // -----------------------------------------------------------------------
    // faction(id: ID!, seasonId: ID): FactionDetail
    // -----------------------------------------------------------------------
    faction: async (
      _parent: unknown,
      args: { id: string; seasonId?: string | null },
      ctx: GqlContext,
    ) => {
      const faction = await ctx.prisma.faction.findUnique({ where: { id: args.id } });
      if (!faction) return null;

      const season = await resolveActiveSeason(ctx.prisma, args.seasonId);
      if (!season) return null;

      const stats = await ctx.prisma.factionStats.findUnique({
        where: { faction_id_season_id: { faction_id: args.id, season_id: season.id } },
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const snapshots = await ctx.prisma.factionStatsSnapshot.findMany({
        where: {
          faction_id: args.id,
          season_id: season.id,
          snapshot_date: { gte: thirtyDaysAgo },
        },
        orderBy: { snapshot_date: 'asc' },
      });

      return {
        faction: asFactionDto(faction),
        stats: stats ? asFactionStatsDto(stats) : null,
        trend: snapshots.map((s) => ({
          date: s.snapshot_date.toISOString().split('T')[0]!,
          matches_played: s.matches_played,
          win_rate: s.matches_played > 0 ? s.wins / s.matches_played : null,
        })),
      };
    },

    // -----------------------------------------------------------------------
    // metaOverview(seasonId: ID): MetaOverview
    // -----------------------------------------------------------------------
    metaOverview: async (
      _parent: unknown,
      args: { seasonId?: string | null },
      ctx: GqlContext,
    ) => {
      const season = await resolveActiveSeason(ctx.prisma, args.seasonId);
      if (!season) return null;

      const allFactions = await getFactionsWithStats(ctx.prisma, season.id);

      const totalMatchesSummed = allFactions.reduce(
        (sum, f) => sum + (f.stats?.matches_played ?? 0),
        0,
      );
      const total_matches = Math.floor(totalMatchesSummed / 2);

      const activeCount = allFactions.filter((f) => (f.stats?.matches_played ?? 0) > 0).length;
      const faction_diversity = activeCount / 24;

      const eligibleForWinrate = allFactions
        .filter((f) => (f.stats?.matches_played ?? 0) >= 10)
        .sort((a, b) => (b.stats?.win_rate ?? 0) - (a.stats?.win_rate ?? 0));
      const top_factions_by_winrate = eligibleForWinrate.slice(0, 5);

      const byPickrate = [...allFactions]
        .filter((f) => (f.stats?.matches_played ?? 0) > 0)
        .sort((a, b) => (b.stats?.matches_played ?? 0) - (a.stats?.matches_played ?? 0));
      const top_factions_by_pickrate = byPickrate.slice(0, 5);

      return {
        season: {
          id: season.id,
          name: season.name,
          start_date: season.start_date.toISOString(),
          end_date: season.end_date?.toISOString() ?? null,
          is_active: season.is_active,
          dlc_tag: season.dlc_tag ?? null,
        },
        top_factions_by_winrate,
        top_factions_by_pickrate,
        total_matches,
        faction_diversity,
      };
    },

    // -----------------------------------------------------------------------
    // matchupHeatmap(seasonId: ID): MatchupHeatmapResult!
    // -----------------------------------------------------------------------
    matchupHeatmap: async (
      _parent: unknown,
      args: { seasonId?: string | null },
      ctx: GqlContext,
    ) => {
      const season = await resolveActiveSeason(ctx.prisma, args.seasonId);
      if (!season) return { seasonId: null, cells: [], factions: [] };

      const [cells, prismaFactions] = await Promise.all([
        getMatchupMatrix(ctx.prisma, season.id),
        ctx.prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
      ]);

      return {
        seasonId: season.id,
        cells,
        factions: prismaFactions.map(asFactionDto),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Field resolvers: snake_case DTO → camelCase GraphQL
  // ---------------------------------------------------------------------------

  Faction: {
    colorHex: (parent: { color_hex: string }) => parent.color_hex,
    displayOrder: (parent: { display_order: number }) => parent.display_order,
    iconUrl: (parent: { icon_url: string | null }) => parent.icon_url ?? null,
    // id, name, race, category, initials already match
  },

  FactionStats: {
    matchesPlayed: (parent: { matches_played: number }) => parent.matches_played,
    winRate: (parent: { win_rate: number | null }) => parent.win_rate ?? null,
    pickCount: (parent: { pick_count: number }) => parent.pick_count,
    banCount: (parent: { ban_count: number }) => parent.ban_count,
    // wins, losses, draws already match
  },

  SeasonSummary: {
    startDate: (parent: { start_date: string }) => parent.start_date,
    endDate: (parent: { end_date: string | null }) => parent.end_date ?? null,
    isActive: (parent: { is_active: boolean }) => parent.is_active,
    dlcTag: (parent: { dlc_tag: string | null }) => parent.dlc_tag ?? null,
    // id, name already match
  },

  SnapshotTrendEntry: {
    matchesPlayed: (parent: { matches_played: number }) => parent.matches_played,
    winRate: (parent: { win_rate: number | null }) => parent.win_rate ?? null,
    // date already matches
  },

  MetaOverview: {
    topFactionsByWinrate: (parent: { top_factions_by_winrate: unknown[] }) =>
      parent.top_factions_by_winrate,
    topFactionsByPickrate: (parent: { top_factions_by_pickrate: unknown[] }) =>
      parent.top_factions_by_pickrate,
    totalMatches: (parent: { total_matches: number }) => parent.total_matches,
    factionDiversity: (parent: { faction_diversity: number }) => parent.faction_diversity,
    // season already matches (it's the whole object; SeasonSummary resolvers handle sub-fields)
  },

  MatchupCell: {
    factionAId: (parent: { faction_a_id: string }) => parent.faction_a_id,
    factionBId: (parent: { faction_b_id: string }) => parent.faction_b_id,
    factionAWins: (parent: { faction_a_wins: number }) => parent.faction_a_wins,
    factionBWins: (parent: { faction_b_wins: number }) => parent.faction_b_wins,
    winrateA: (parent: { winrate_a: number | null }) => parent.winrate_a ?? null,
    // draws, total already match
  },
};
