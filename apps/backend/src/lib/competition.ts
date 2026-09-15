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

/** Site launch — game counts (and the Rankings self-scaling cutoff) count from here. */
export const LAUNCH_DATE = new Date('2026-06-27T00:00:00.000Z');

/** Whole days from `from` until `now` (never negative). */
export function daysSince(from: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Selectable periods — quarter (Qualifier) and month (Ladder) selectors. Past
// periods are computed live via a windowed re-fit (no freeze needed to VIEW them).
// ---------------------------------------------------------------------------

export interface Period {
  /** Stable key, e.g. "2026-Q3" or "2026-09". */
  value: string;
  label: string;
  from: Date;
  to: Date;
}

/** Calendar quarter containing `d` (UTC). */
export function quarterOf(d: Date): TimeWindow {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  return { from: new Date(Date.UTC(y, q * 3, 1)), to: new Date(Date.UTC(y, q * 3 + 3, 1)), label: `Q${q + 1} ${y}` };
}
export function quarterValue(w: TimeWindow): string {
  return `${w.from.getUTCFullYear()}-Q${Math.floor(w.from.getUTCMonth() / 3) + 1}`;
}
/** Parse "YYYY-Qn" → that quarter's window, or null if malformed. */
export function parseQuarter(value: string): TimeWindow | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, q * 3, 1)), to: new Date(Date.UTC(y, q * 3 + 3, 1)), label: `Q${q + 1} ${y}` };
}
export function monthValue(w: TimeWindow): string {
  return `${w.from.getUTCFullYear()}-${String(w.from.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Parse "YYYY-MM" → that month's window, or null. */
export function parseMonth(value: string): TimeWindow | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  const from = new Date(Date.UTC(y, mo, 1));
  return { from, to: new Date(Date.UTC(y, mo + 1, 1)), label: from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

/** Selectable quarters from the launch quarter to the current one (most recent first). */
export function listQuartersSinceLaunch(now: Date = new Date()): Period[] {
  const out: Period[] = [];
  const launchStart = quarterOf(LAUNCH_DATE).from.getTime();
  let cur = quarterOf(now);
  while (cur.from.getTime() >= launchStart) {
    out.push({ value: quarterValue(cur), label: cur.label, from: cur.from, to: cur.to });
    cur = quarterOf(new Date(cur.from.getTime() - 1)); // step back one quarter
  }
  return out;
}
/** Selectable months from the launch month to the current one (most recent first). */
export function listMonthsSinceLaunch(now: Date = new Date()): Period[] {
  const out: Period[] = [];
  const launchStart = currentMonth(LAUNCH_DATE).from.getTime();
  let cur = currentMonth(now);
  while (cur.from.getTime() >= launchStart) {
    out.push({ value: monthValue(cur), label: cur.label, from: cur.from, to: cur.to });
    cur = currentMonth(new Date(cur.from.getTime() - 1)); // step back one month
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quarter overrides — admin-editable per-quarter name / boundaries. Calendar defaults apply
// wherever a field is null. Consumed by the Quarterly Qualifier board + the Quarterly Finals.
// ---------------------------------------------------------------------------

export interface QuarterOverride {
  name: string | null;
  start_date: Date | null;
  end_date: Date | null;
}

/** Load all admin quarter overrides, keyed by "YYYY-Qn". */
export async function loadQuarterOverrides(prisma: PrismaClient): Promise<Map<string, QuarterOverride>> {
  const rows = await prisma.quarterConfig.findMany({
    select: { period: true, name: true, start_date: true, end_date: true },
  });
  return new Map(rows.map((r) => [r.period, { name: r.name, start_date: r.start_date, end_date: r.end_date }]));
}

/** Merge a calendar quarter with an admin override (custom name / shifted boundaries; null = keep). */
export function applyQuarterOverride(base: Period, ov?: QuarterOverride): Period {
  if (!ov) return base;
  return {
    value: base.value,
    label: ov.name ?? base.label,
    from: ov.start_date ?? base.from,
    to: ov.end_date ?? base.to,
  };
}

/** Resolve a "YYYY-Qn" period to its window + label, applying an override if present. */
export function resolveQuarter(period: string, overrides: Map<string, QuarterOverride>): Period | null {
  const w = parseQuarter(period);
  if (!w) return null;
  return applyQuarterOverride({ value: period, label: w.label, from: w.from, to: w.to }, overrides.get(period));
}

/** Selectable quarters (launch→now, newest first) with overrides applied. */
export function listQuartersResolved(overrides: Map<string, QuarterOverride>, now: Date = new Date()): Period[] {
  return listQuartersSinceLaunch(now).map((p) => applyQuarterOverride(p, overrides.get(p.value)));
}

export interface CompetitionConfig {
  /** Cap for the quarterly qualifier's self-scaling gate = min(this, days into the quarter).
   *  90 ≈ "~1 tournament/week + ladder" — the legitimacy bar for a cash-prize final. */
  qualiMinGames: number;
  /** "Permanence" threshold: reaching it lists a player forever on Rankings (HoF badge), immune
   *  to the self-scaling cutoff. Starts generous (50) and is raised over time toward ~250. */
  hallOfFameMinGames: number;
  /** Monthly ladder points per Open-Play result. */
  ladderWinPoints: number;
  ladderDrawPoints: number;
  ladderLossPoints: number;
}

const DEFAULT_COMPETITION_CONFIG: CompetitionConfig = {
  qualiMinGames: 90,
  hallOfFameMinGames: 50,
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

/** Rankings inclusion cutoff = min(permanence, days since launch). A competitor with at least
 *  this many decisive games is listed; reaching `hallOfFameMinGames` makes them permanent (HoF). */
export function rankingsCutoff(cfg: CompetitionConfig, now: Date = new Date()): number {
  return Math.min(cfg.hallOfFameMinGames, daysSince(LAUNCH_DATE, now));
}

/** Quarterly qualifier gate = min(cap, competitive days elapsed in the quarter up to now).
 *  Self-scaling for the CURRENT quarter ("sharpens" toward the full cap by quarter end); a
 *  fully-elapsed PAST quarter uses the full cap. The start is clamped to LAUNCH_DATE so the LAUNCH
 *  quarter (which only had a few weeks of play) doesn't demand a full quarter's worth of games it
 *  never had time to accrue. */
export function qualiGate(cfg: CompetitionConfig, window: TimeWindow, now: Date = new Date()): number {
  const start = new Date(Math.max(window.from.getTime(), LAUNCH_DATE.getTime()));
  const end = new Date(Math.min(now.getTime(), window.to.getTime()));
  return Math.min(cfg.qualiMinGames, Math.max(0, daysSince(start, end)));
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
 * passing the current-month window. The ladder is INDIVIDUAL: 1v1 slots are user ids; 2v2
 * slots are team ids → resolved to their members so BOTH teammates score the same result.
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
    select: { winner_id: true, match: { select: { player1_id: true, player2_id: true, competitor_format: true } } },
  });

  // Resolve any 2v2 team slots → member user ids (both teammates get the individual result).
  const teamIds = new Set<string>();
  for (const g of games) {
    if (g.match.competitor_format === 'TWO_V_TWO') {
      if (g.match.player1_id) teamIds.add(g.match.player1_id);
      if (g.match.player2_id) teamIds.add(g.match.player2_id);
    }
  }
  const membersByTeam = new Map<string, string[]>();
  if (teamIds.size > 0) {
    const members = await prisma.teamMember.findMany({
      where: { team_id: { in: [...teamIds] } },
      select: { team_id: true, user_id: true },
    });
    for (const m of members) {
      const arr = membersByTeam.get(m.team_id) ?? [];
      arr.push(m.user_id);
      membersByTeam.set(m.team_id, arr);
    }
  }
  const usersOf = (slotId: string | null, isTeam: boolean): string[] =>
    !slotId ? [] : isTeam ? (membersByTeam.get(slotId) ?? []) : [slotId];

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
    const isTeam = g.match.competitor_format === 'TWO_V_TWO';
    const side1 = usersOf(g.match.player1_id, isTeam);
    const side2 = usersOf(g.match.player2_id, isTeam);
    const isDraw = g.winner_id === null;
    const side1Won = !isDraw && g.winner_id === g.match.player1_id;
    const credit = (uid: string, won: boolean) => {
      const e = entry(uid);
      e.games++;
      if (isDraw) {
        e.draws++;
        e.points += cfg.ladderDrawPoints;
      } else if (won) {
        e.wins++;
        e.points += cfg.ladderWinPoints;
      } else {
        e.losses++;
        e.points += cfg.ladderLossPoints;
      }
    };
    for (const uid of side1) credit(uid, side1Won);
    for (const uid of side2) credit(uid, !isDraw && !side1Won);
  }

  return [...byPlayer.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.games - b.games);
}
