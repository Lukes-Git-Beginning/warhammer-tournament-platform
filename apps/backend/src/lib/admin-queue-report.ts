/**
 * Admin "Open Play queue" report: what became of every queue join. Each JOIN in the queue activity log
 * ends one of four ways:
 *   - MATCHED: the player's next MATCH (paired in the queue, or an available player took the
 *     availability DM's offer; the match's source tells which);
 *   - LEFT: the player's own LEAVE;
 *   - EXPIRED: nothing within the queue's longest stay. The queue cleanup (plugins/cron.ts) removes
 *     entries after 30 minutes without logging it, so an expiry shows as a JOIN with no outcome;
 *   - WAITING: joined less than that long ago, nothing yet.
 * Daily rows and weekday × hour grids in site time (Europe/Berlin).
 *
 * The builder is pure (events in, report out) so it is unit-testable; the loader does the queries.
 */
import type { PrismaClient } from '@rizzotto/db';
import { emptyGrid, bump, siteCell, type Grid } from './admin-player-report.js';
import { addSiteDays, SITE_TZ, siteDayKey } from './site-time.js';

/**
 * Longest a join can sit in the queue: the cleanup runs every 15 minutes and evicts entries older
 * than 30, so every entry is gone by 45 minutes. Plus a little slack.
 */
export const MAX_QUEUE_STAY_MS = 50 * 60 * 1000;

/**
 * A join is logged after the player is already in the queue, so a tick started by someone else can
 * pair him (and log his MATCH) a moment before his JOIN is written. A MATCH this close before a JOIN
 * belongs to it.
 */
const JOIN_LOG_RACE_MS = 10_000;

export type QueueJoinOutcome = 'MATCHED' | 'LEFT' | 'EXPIRED' | 'WAITING';

export interface QueueReportEvent {
  userId: string;
  event: 'JOIN' | 'LEAVE' | 'MATCH';
  at: Date;
  /** MATCH only: how the match came about. */
  source?: 'QUEUE' | 'AVAILABILITY' | 'CHALLENGE' | null;
}

export interface QueueJoin {
  userId: string;
  at: Date;
  outcome: QueueJoinOutcome;
  /** MATCHED via an availability DM (an available player took the offer). */
  viaDm: boolean;
  /** Time from join to match or leave; null when expired or still waiting. */
  waitMs: number | null;
}

/** The outcome of every JOIN, walking each player's events in time order. */
export function classifyQueueJoins(events: QueueReportEvent[], now: Date): QueueJoin[] {
  const byUser = new Map<string, QueueReportEvent[]>();
  for (const e of events) {
    const list = byUser.get(e.userId);
    if (list) list.push(e);
    else byUser.set(e.userId, [e]);
  }

  const joins: QueueJoin[] = [];
  const close = (join: QueueReportEvent, outcome: QueueJoinOutcome, end?: QueueReportEvent) =>
    joins.push({
      userId: join.userId,
      at: join.at,
      outcome,
      viaDm: outcome === 'MATCHED' && end?.source === 'AVAILABILITY',
      waitMs: end && (outcome === 'MATCHED' || outcome === 'LEFT') ? Math.max(0, end.at.getTime() - join.at.getTime()) : null,
    });

  for (const list of byUser.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let open: QueueReportEvent | null = null;
    // A MATCH no join claimed (yet): it may belong to a JOIN logged right after it.
    let stray: QueueReportEvent | null = null;
    for (const e of list) {
      const t = e.at.getTime();
      if (open && t - open.at.getTime() > MAX_QUEUE_STAY_MS) {
        close(open, 'EXPIRED');
        open = null;
      }
      if (e.event === 'JOIN') {
        // Joining again while the last join is open: that one ended without a logged outcome.
        if (open) close(open, 'EXPIRED');
        open = e;
        if (stray && t - stray.at.getTime() <= JOIN_LOG_RACE_MS) {
          close(open, 'MATCHED', { ...stray, at: e.at });
          open = null;
        }
        stray = null;
      } else if (e.event === 'MATCH') {
        if (open) {
          close(open, 'MATCHED', e);
          open = null;
        } else {
          stray = e;
        }
      } else if (open) {
        close(open, 'LEFT', e);
        open = null;
      }
    }
    if (open) close(open, now.getTime() - open.at.getTime() < MAX_QUEUE_STAY_MS ? 'WAITING' : 'EXPIRED');
  }
  return joins.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface QueueReportDay {
  /** Site-time calendar day, "YYYY-MM-DD". */
  day: string;
  joins: number;
  matched: number;
  /** Of `matched`: an available player took the availability DM's offer. */
  matchedViaDm: number;
  left: number;
  expired: number;
  waiting: number;
  /** Players who joined that day. */
  players: number;
  /** Players whose joins that day all ended without a match (left or expired). */
  playersWithoutGame: number;
}

export interface QueueReport {
  timezone: string;
  /** Newest first, every day of the window (all time: from the first join). */
  daily: QueueReportDay[];
  /** Median time from join to match, in seconds (null without matches). */
  medianWaitToMatchSec: number | null;
  /** Median time from join to leaving, in seconds (null without leaves). */
  medianWaitBeforeLeavingSec: number | null;
  /** Weekday × hour of every join. */
  joinsGrid: Grid;
  /** Weekday × hour of the joins that ended without a match (left or expired). */
  unmatchedGrid: Grid;
}

function medianSec(ms: number[]): number | null {
  if (ms.length === 0) return null;
  const s = [...ms].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
  return Math.round(m / 1000);
}

/** The report for the joins from `windowStart` on (earlier events only settle outcomes). */
export function buildQueueReport(events: QueueReportEvent[], windowStart: Date, now: Date): QueueReport {
  const joins = classifyQueueJoins(events, now).filter((j) => j.at >= windowStart);

  const rows = new Map<string, QueueReportDay>();
  const firstDay = joins[0] && windowStart.getTime() === 0 ? joins[0].at : windowStart;
  if (joins.length > 0 || windowStart.getTime() > 0) {
    for (let i = 0, d = addSiteDays(firstDay, 0); d <= now; i++, d = addSiteDays(firstDay, i)) {
      const day = siteDayKey(d);
      rows.set(day, {
        day,
        joins: 0,
        matched: 0,
        matchedViaDm: 0,
        left: 0,
        expired: 0,
        waiting: 0,
        players: 0,
        playersWithoutGame: 0,
      });
    }
  }

  const joinsGrid = emptyGrid();
  const unmatchedGrid = emptyGrid();
  // Per day and player: did any join match, is any still waiting?
  const perPlayer = new Map<string, Map<string, { matched: boolean; waiting: boolean }>>();
  for (const j of joins) {
    const day = siteDayKey(j.at);
    const row = rows.get(day);
    if (!row) continue;
    row.joins++;
    if (j.outcome === 'MATCHED') {
      row.matched++;
      if (j.viaDm) row.matchedViaDm++;
    } else if (j.outcome === 'LEFT') row.left++;
    else if (j.outcome === 'EXPIRED') row.expired++;
    else row.waiting++;

    const { d, h } = siteCell(j.at);
    bump(joinsGrid, d, h);
    if (j.outcome === 'LEFT' || j.outcome === 'EXPIRED') bump(unmatchedGrid, d, h);

    const players = perPlayer.get(day) ?? new Map<string, { matched: boolean; waiting: boolean }>();
    perPlayer.set(day, players);
    const p = players.get(j.userId) ?? { matched: false, waiting: false };
    p.matched ||= j.outcome === 'MATCHED';
    p.waiting ||= j.outcome === 'WAITING';
    players.set(j.userId, p);
  }
  for (const [day, players] of perPlayer) {
    const row = rows.get(day);
    if (!row) continue;
    row.players = players.size;
    row.playersWithoutGame = [...players.values()].filter((p) => !p.matched && !p.waiting).length;
  }

  return {
    timezone: SITE_TZ,
    daily: [...rows.values()].reverse(),
    medianWaitToMatchSec: medianSec(joins.filter((j) => j.outcome === 'MATCHED').map((j) => j.waitMs ?? 0)),
    medianWaitBeforeLeavingSec: medianSec(joins.filter((j) => j.outcome === 'LEFT').map((j) => j.waitMs ?? 0)),
    joinsGrid,
    unmatchedGrid,
  };
}

/** `days` site-time days up to and including today (0 = all time). */
export async function loadQueueReport(prisma: PrismaClient, days: number, now = new Date()): Promise<QueueReport> {
  const windowStart = days > 0 ? addSiteDays(now, -(days - 1)) : new Date(0);
  const logs = await prisma.queueActivityLog.findMany({
    where: {
      created_at: { gte: new Date(Math.max(0, windowStart.getTime() - JOIN_LOG_RACE_MS)) },
      event: { in: ['JOIN', 'LEAVE', 'MATCH'] },
    },
    select: { user_id: true, event: true, match_id: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });
  const matchIds = [...new Set(logs.map((l) => l.match_id).filter((id): id is string => id !== null))];
  const matches =
    matchIds.length > 0
      ? await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { id: true, source: true } })
      : [];
  const sourceById = new Map(matches.map((m) => [m.id, m.source]));

  return buildQueueReport(
    logs.map((l) => ({
      userId: l.user_id,
      event: l.event as QueueReportEvent['event'],
      at: l.created_at,
      source: l.match_id ? (sourceById.get(l.match_id) ?? null) : undefined,
    })),
    windowStart,
    now,
  );
}
