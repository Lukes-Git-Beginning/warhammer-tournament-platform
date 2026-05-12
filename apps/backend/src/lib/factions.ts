import type { PrismaClient } from '@tww3/db';

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

/**
 * Derive a 2-char initials string from a faction name.
 * - Multi-word: first letter of first two words, uppercased.
 * - Single-word: first two letters uppercased.
 *
 * Examples:
 *   "Empire"           → "EM"
 *   "High Elves"       → "HE"
 *   "Daemons of Chaos" → "DC"  (skips prepositions; takes first two words)
 *   "Lizardmen"        → "LI"
 */
export function computeInitials(name: string): string {
  const words = name.trim().split(/\s+/);
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
    initials: computeInitials(faction.name),
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
  seasonId: string,
): Promise<FactionWithStatsDto[]> {
  const factions = await prisma.faction.findMany({
    orderBy: { display_order: 'asc' },
    include: {
      stats: {
        where: { season_id: seasonId },
        take: 1,
      },
    },
  });

  return factions.map((f) => ({
    faction: asFactionDto(f),
    stats: f.stats[0] ? asFactionStatsDto(f.stats[0]) : null,
  }));
}
