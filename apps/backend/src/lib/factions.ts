import type { PrismaClient, $Enums } from '@rizzotto/db';

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
  /** The player with the most games on this faction this version + their count (segmented bar). */
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
// All-Time version decay (Alex, 2026-09-08): the "All time" view weights each game
// by 1/k, k = the version's reverse-chronological rank (newest 1/1, next 1/2, …).
// Older versions are devalued but never dropped; single-version views stay unweighted.
// The weight is applied to the RAW counts (matches/wins/…), then rates are derived
// from the weighted sums — so a version with more games still contributes more.
// ---------------------------------------------------------------------------

/** Per-version decay weight 1/k, newest first. Map<versionId, weight>. */
export async function getVersionDecayWeights(prisma: PrismaClient): Promise<Map<string, number>> {
  const versions = await prisma.gameVersion.findMany({
    orderBy: { start_date: 'desc' },
    select: { id: true },
  });
  const weights = new Map<string, number>();
  versions.forEach((v, i) => weights.set(v.id, 1 / (i + 1)));
  return weights;
}

/** Combine one faction's per-version stats into a single 1/k-weighted All-Time stat block.
 *  Counts are weighted sums (rounded for display); win_rate is derived from the un-rounded
 *  weighted wins/matches. Returns null when the faction has no games in any version. */
export function combineFactionStatsAllTime(
  perVersion: Array<{ stats: FactionStatsDto; weight: number }>,
): FactionStatsDto | null {
  if (perVersion.length === 0) return null;
  let m = 0, w = 0, l = 0, d = 0, pc = 0, bc = 0;
  for (const { stats, weight } of perVersion) {
    m += stats.matches_played * weight;
    w += stats.wins * weight;
    l += stats.losses * weight;
    d += stats.draws * weight;
    pc += stats.pick_count * weight;
    bc += stats.ban_count * weight;
  }
  if (m <= 0) return null;
  return {
    matches_played: Math.round(m),
    wins: Math.round(w),
    losses: Math.round(l),
    draws: Math.round(d),
    win_rate: w / m,
    pick_count: Math.round(pc),
    ban_count: Math.round(bc),
  };
}

// ---------------------------------------------------------------------------
// getFactionsWithStats
// ---------------------------------------------------------------------------

export async function getFactionsWithStats(
  prisma: PrismaClient,
  versionId: string | null,
  battleType: $Enums.BattleType = 'DOMINATION',
): Promise<FactionWithStatsDto[]> {
  // Faction master data (name, icon, colour) is global reference data — always
  // returned. Only the per-version stats are gated on a version; with no version
  // (e.g. between versions) every faction simply comes back with stats: null.
  // FactionStats are keyed per (faction, version, battle_type) — read the requested
  // battle type (default Domination, the standard) rather than an arbitrary first row.
  if (!versionId) {
    const factions = await prisma.faction.findMany({ orderBy: { display_order: 'asc' } });
    return factions.map((f) => ({ faction: asFactionDto(f), stats: null }));
  }

  // "All time": weighted amalgam over every version (1/k by reverse-chronological rank). Combine the
  // precomputed per-version FactionStats; top player is the all-versions leader (unweighted games).
  if (versionId === 'all') {
    const [weights, factions, allStats, topPlayers] = await Promise.all([
      getVersionDecayWeights(prisma),
      prisma.faction.findMany({ orderBy: { display_order: 'asc' } }),
      prisma.factionStats.findMany({ where: { battle_type: battleType } }),
      prisma.$queryRaw<{ faction_id: string; username: string; games: number }[]>`
        WITH sides AS (
          SELECT mg.player1_faction_id AS faction_id, m.player1_id AS player_id
          FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
          WHERE mg.status = 'COMPLETED' AND m.deleted_at IS NULL
            AND mg.player1_faction_id IS NOT NULL AND m.player1_id IS NOT NULL
          UNION ALL
          SELECT mg.player2_faction_id, m.player2_id
          FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
          WHERE mg.status = 'COMPLETED' AND m.deleted_at IS NULL
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
    const byFaction = new Map<string, Array<{ stats: FactionStatsDto; weight: number }>>();
    for (const s of allStats) {
      const weight = weights.get(s.version_id) ?? 0;
      if (weight === 0) continue;
      const list = byFaction.get(s.faction_id) ?? [];
      list.push({ stats: asFactionStatsDto(s), weight });
      byFaction.set(s.faction_id, list);
    }
    return factions.map((f) => {
      const combined = combineFactionStatsAllTime(byFaction.get(f.id) ?? []);
      return {
        faction: asFactionDto(f),
        stats: combined ? { ...combined, top_player: topByFaction.get(f.id) ?? null } : null,
      };
    });
  }

  const [factions, topPlayers] = await Promise.all([
    prisma.faction.findMany({
      orderBy: { display_order: 'asc' },
      include: {
        stats: {
          where: { version_id: versionId, battle_type: battleType },
          take: 1,
        },
      },
    }),
    // Top player per faction: the one with the most games on it this version. Counted per
    // faction-SIDE over the same game set as matches_played (COMPLETED, this version, not deleted;
    // no counts_for_leaderboard filter, mirrors count on both sides) so a segment never exceeds
    // its bar. Deterministic tie-break by player id.
    prisma.$queryRaw<{ faction_id: string; username: string; games: number }[]>`
      WITH sides AS (
        SELECT mg.player1_faction_id AS faction_id, m.player1_id AS player_id
        FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
        WHERE mg.status = 'COMPLETED' AND m.season_id = ${versionId}::uuid AND m.deleted_at IS NULL
          AND mg.player1_faction_id IS NOT NULL AND m.player1_id IS NOT NULL
        UNION ALL
        SELECT mg.player2_faction_id, m.player2_id
        FROM "MatchGame" mg JOIN "Match" m ON m.id = mg.match_id
        WHERE mg.status = 'COMPLETED' AND m.season_id = ${versionId}::uuid AND m.deleted_at IS NULL
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
