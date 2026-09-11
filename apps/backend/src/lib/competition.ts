// ---------------------------------------------------------------------------
// Competition tracks (design doc §6) — time-boxed helpers, decoupled from game
// versions:
//   - Tournament track: a QUARTERLY GS fit (current form) → quarterly major final.
//   - Ladder track:     MONTHLY Open-Play points (drives activity) → monthly final.
//   - Hall of Fame:     the timeless GS, players with >= N games listed forever.
//
// The numeric dials (§9: quali min-games gate, ladder points formula, HoF threshold)
// are AdminConfig-tunable without a deploy — sensible defaults below.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';

export interface TimeWindow {
  from: Date;
  to: Date;
  label: string;
}

/** Current calendar quarter [from, to) in UTC. */
export function currentQuarter(now: Date = new Date()): TimeWindow {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  return {
    from: new Date(Date.UTC(y, q * 3, 1)),
    to: new Date(Date.UTC(y, q * 3 + 3, 1)),
    label: `Q${q + 1} ${y}`,
  };
}

/** Current calendar month [from, to) in UTC. */
export function currentMonth(now: Date = new Date()): TimeWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  return {
    from,
    to: new Date(Date.UTC(y, m + 1, 1)),
    label: from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

export interface CompetitionConfig {
  /** Min games this quarter to appear on the quarterly quali board. */
  qualiMinGames: number;
  /** Games threshold for Hall of Fame membership (two-class sort above everyone else). */
  hallOfFameMinGames: number;
  /** Monthly ladder points per Open-Play result. */
  ladderWinPoints: number;
  ladderDrawPoints: number;
  ladderLossPoints: number;
}

const DEFAULT_COMPETITION_CONFIG: CompetitionConfig = {
  qualiMinGames: 10,
  hallOfFameMinGames: 250,
  ladderWinPoints: 3,
  ladderDrawPoints: 1,
  ladderLossPoints: 0,
};

/** Read the calibration dials from AdminConfig, falling back to the defaults. */
export async function loadCompetitionConfig(prisma: PrismaClient): Promise<CompetitionConfig> {
  const rows = await prisma.adminConfig.findMany({
    where: {
      key: {
        in: [
          'quali_min_games',
          'hall_of_fame_min_games',
          'ladder_win_points',
          'ladder_draw_points',
          'ladder_loss_points',
        ],
      },
    },
  });
  const num = (key: string, def: number): number => {
    const row = rows.find((r) => r.key === key);
    if (!row) return def;
    const n = typeof row.value === 'number' ? row.value : Number(row.value);
    return Number.isFinite(n) ? n : def;
  };
  return {
    qualiMinGames: num('quali_min_games', DEFAULT_COMPETITION_CONFIG.qualiMinGames),
    hallOfFameMinGames: num('hall_of_fame_min_games', DEFAULT_COMPETITION_CONFIG.hallOfFameMinGames),
    ladderWinPoints: num('ladder_win_points', DEFAULT_COMPETITION_CONFIG.ladderWinPoints),
    ladderDrawPoints: num('ladder_draw_points', DEFAULT_COMPETITION_CONFIG.ladderDrawPoints),
    ladderLossPoints: num('ladder_loss_points', DEFAULT_COMPETITION_CONFIG.ladderLossPoints),
  };
}

export interface LadderStanding {
  playerId: string;
  points: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * Monthly ladder standings from Open-Play games in the window. Points reward activity ×
 * success (the ladder's job is to drive Open-Play activity); reset each month by the caller
 * passing the current-month window. Open Play is always 1v1 → slots are user ids.
 */
export async function computeLadderStandings(
  prisma: PrismaClient,
  window: TimeWindow,
  cfg: CompetitionConfig,
): Promise<LadderStanding[]> {
  const games = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      played_at: { gte: window.from, lt: window.to },
      counts_for_leaderboard: true,
      match: {
        type: 'OPEN_PLAY',
        deleted_at: null,
        player1_id: { not: null },
        player2_id: { not: null },
      },
    },
    select: { winner_id: true, match: { select: { player1_id: true, player2_id: true } } },
  });

  const byPlayer = new Map<string, LadderStanding>();
  const entry = (id: string): LadderStanding => {
    let e = byPlayer.get(id);
    if (!e) {
      e = { playerId: id, points: 0, games: 0, wins: 0, losses: 0, draws: 0 };
      byPlayer.set(id, e);
    }
    return e;
  };

  for (const g of games) {
    const p1 = g.match.player1_id;
    const p2 = g.match.player2_id;
    if (!p1 || !p2) continue;
    const e1 = entry(p1);
    const e2 = entry(p2);
    e1.games++;
    e2.games++;
    if (g.winner_id === null) {
      e1.draws++; e2.draws++;
      e1.points += cfg.ladderDrawPoints; e2.points += cfg.ladderDrawPoints;
    } else if (g.winner_id === p1) {
      e1.wins++; e2.losses++;
      e1.points += cfg.ladderWinPoints; e2.points += cfg.ladderLossPoints;
    } else {
      e2.wins++; e1.losses++;
      e2.points += cfg.ladderWinPoints; e1.points += cfg.ladderLossPoints;
    }
  }

  return [...byPlayer.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.games - b.games);
}
