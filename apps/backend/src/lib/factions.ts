import type { PrismaClient } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Types (local — mirrors Zod DTOs without importing from packages/types)
// ---------------------------------------------------------------------------

export interface FactionDto {
  id: string;
  name: string;
  race: string;
  category: string;
  color_hex: string;
  display_order: number;
  icon_url: string | null;
  initials: string;
}

export interface FactionStatsDto {
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  pick_count: number;
  ban_count: number;
  /** The player with the most games on this faction this season + their count (segmented bar). */
  top_player?: { username: string; games: number } | null;
}

export interface FactionWithStatsDto {
  faction: FactionDto;
  stats: FactionStatsDto | null;
}

export interface SnapshotTrendEntry {
  date: string; // ISO date string (YYYY-MM-DD)
  matches_played: number;
  win_rate: number | null;
}

// ---------------------------------------------------------------------------
// computeInitials
// ---------------------------------------------------------------------------

const INITIALS_STOP_WORDS = new Set(['of', 'the', 'and']);

const INITIALS_OVERRIDES: Record<string, string> = {
  vampire_counts: 'VCs',
  vampire_coast: 'VCo',
};

/**
 * Derive an initials string from a faction name. Usually 2 chars; 3 chars only
 * for the hardcoded Vampire Counts / Vampire Coast collision override.
 * - Multi-word: first letter of first two words after dropping stop-words
 *   ("of", "the", "and"), uppercased.
 * - Single-word: first two letters uppercased.
 *
 * Examples:
 *   "Empire"            → "EM"
 *   "High Elves"        → "HE"
 *   "Daemons of Chaos"  → "DC"  (skips "of")
 *   "Warriors of Chaos" → "WC"  (skips "of")
 *   "Vampire Counts"    → "VCs" (override; would otherwise clash with Coast)
 *   "Vampire Coast"     → "VCo" (override)
 *   "Lizardmen"         → "LI"
 */
export function computeInitials(name: string, id?: string): string {
  if (id && id in INITIALS_OVERRIDES) {
    return INITIALS_OVERRIDES[id]!;
  }
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => !INITIALS_STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 1) {
    return (words[0] ?? '').slice(0, 2).toUpperCase();
  }
  const first = (words[0] ?? '').charAt(0).toUpperCase();
  const second = (words[1] ?? '').charAt(0).toUpperCase();
  return first + second;
}

// ---------------------------------------------------------------------------
// asFactionDto
// ---------------------------------------------------------------------------

type PrismaFaction = {
  id: string;
  name: string;
  race: string;
  category: string;
  color_hex: string;
  display_order: number;
  icon_url: string | null;
};

type PrismaFactionStats = {
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  pick_count: number;
  ban_count: number;
} | null;

export function asFactionDto(faction: PrismaFaction): FactionDto {
  return {
    id: faction.id,
    name: faction.name,
    race: faction.race,
    category: faction.category,
    color_hex: faction.color_hex,
    display_order: faction.display_order,
    icon_url: faction.icon_url,
    initials: computeInitials(faction.name, faction.id),
  };
}

export function asFactionStatsDto(stats: NonNullable<PrismaFactionStats>): FactionStatsDto {
  const win_rate =
    stats.matches_played > 0 ? stats.wins / stats.matches_played : null;
  return {
    matches_played: stats.matches_played,
    wins: stats.wins,
    losses: stats.losses,
    draws: stats.draws,
    win_rate,
    pick_count: stats.pick_count,
    ban_count: stats.ban_count,
  };
}

// ---------------------------------------------------------------------------
// getFactionsWithStats
// ---------------------------------------------------------------------------

export async function getFactionsWithStats(
  prisma: PrismaClient,
  seasonId: string | null,
): Promise<FactionWithStatsDto[]> {
  // Faction master data (name, icon, colour) is global reference data — always
  // returned. Only the per-season stats are gated on a season; with no season
  // (e.g. between seasons) every faction simply comes back with stats: null.
  if (!seasonId) {
    const factions = await prisma.faction.findMany({ orderBy: { display_order: 'asc' } });
    return factions.map((f) => ({ faction: asFactionDto(f), stats: null }));
  }

  const [factions, topPlayers] = await Promise.all([
    prisma.faction.findMany({
      orderBy: { display_order: 'asc' },
      include: {
        stats: {
          where: { season_id: seasonId },
          take: 1,
        },
      },
    }),
    // Top player per faction: the one with the most games on it this season. Counted per
    // faction-SIDE over the same game set as matches_played (COMPLETED, this season, not deleted;
    // no counts_for_leaderboard filter, mirrors count on both sides) so a segment never exceeds
    // its bar. Deterministic tie-break by player id.
    prisma.$queryRaw<{ faction_id: string; username: string; games: number }[]>`
      WITH sides AS (
        SELECT mg.player1_faction_id AS faction_id, m.player1_id AS player_id
        FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
        WHERE mg.status = 'COMPLETED' AND m.season_id = ${seasonId}::uuid AND m.deleted_at IS NULL
          AND mg.player1_faction_id IS NOT NULL AND m.player1_id IS NOT NULL
        UNION ALL
        SELECT mg.player2_faction_id, m.player2_id
        FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
        WHERE mg.status = 'COMPLETED' AND m.season_id = ${seasonId}::uuid AND m.deleted_at IS NULL
          AND mg.player2_faction_id IS NOT NULL AND m.player2_id IS NOT NULL
      ),
      counts AS (
        SELECT faction_id, player_id, COUNT(*)::int AS games,
          ROW_NUMBER() OVER (PARTITION BY faction_id ORDER BY COUNT(*) DESC, player_id) AS rn
        FROM sides GROUP BY faction_id, player_id
      )
      SELECT c.faction_id, c.games, u.username
      FROM counts c JOIN "User" u ON u.id = c.player_id
      WHERE c.rn = 1
    `,
  ]);

  const topByFaction = new Map(topPlayers.map((t) => [t.faction_id, { username: t.username, games: t.games }]));

  return factions.map((f) => {
    const base = f.stats[0] ? asFactionStatsDto(f.stats[0]) : null;
    return {
      faction: asFactionDto(f),
      stats: base ? { ...base, top_player: topByFaction.get(f.id) ?? null } : null,
    };
  });
}
