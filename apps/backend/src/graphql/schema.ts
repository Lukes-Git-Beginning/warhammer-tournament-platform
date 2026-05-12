/**
 * SDL-First GraphQL schema for TWW3 Tournament Platform.
 * Stored as a TypeScript string constant to avoid build-time file-copy issues
 * (tsconfig only bundles .ts files; .graphql would be missing in dist/).
 *
 * snake_case backend DTOs are mapped to camelCase GraphQL fields via
 * field resolvers in resolvers.ts.
 */
export const schema = /* GraphQL */ `
  type Query {
    factions(seasonId: ID): FactionListResult!
    faction(id: ID!, seasonId: ID): FactionDetail
    metaOverview(seasonId: ID): MetaOverview
    matchupHeatmap(seasonId: ID): MatchupHeatmapResult!
  }

  type FactionListResult {
    data: [FactionWithStats!]!
    season: SeasonSummary
  }

  type FactionDetail {
    faction: Faction!
    stats: FactionStats
    trend: [SnapshotTrendEntry!]!
  }

  type FactionWithStats {
    faction: Faction!
    stats: FactionStats
  }

  type Faction {
    id: ID!
    name: String!
    race: String!
    category: String!
    colorHex: String!
    displayOrder: Int!
    iconUrl: String
    initials: String!
  }

  type FactionStats {
    matchesPlayed: Int!
    wins: Int!
    losses: Int!
    draws: Int!
    winRate: Float
    pickCount: Int!
    banCount: Int!
  }

  type SeasonSummary {
    id: ID!
    name: String!
    startDate: String!
    endDate: String
    isActive: Boolean!
    dlcTag: String
  }

  type SnapshotTrendEntry {
    date: String!
    matchesPlayed: Int!
    winRate: Float
  }

  type MetaOverview {
    season: SeasonSummary!
    topFactionsByWinrate: [FactionWithStats!]!
    topFactionsByPickrate: [FactionWithStats!]!
    totalMatches: Int!
    factionDiversity: Float!
  }

  type MatchupHeatmapResult {
    seasonId: ID
    cells: [MatchupCell!]!
    factions: [Faction!]!
  }

  type MatchupCell {
    factionAId: String!
    factionBId: String!
    factionAWins: Int!
    factionBWins: Int!
    draws: Int!
    total: Int!
    winrateA: Float
  }
`;
