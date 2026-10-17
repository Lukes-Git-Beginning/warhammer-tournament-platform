/**
 * Admin "Players" report: one row per user with what they use on the site (availability, Open Play,
 * tournaments, hosting, reliability, reachability, replays, questionnaire coverage). The admin UI
 * filters and aggregates these rows client-side (presets, funnel, KPIs, CSV, broadcast audience).
 * Plus two small aggregates: hosts and the schedule fit (availability vs. when events run).
 *
 * The builders are pure (arrays in, rows out) so they are unit-testable; the loaders do the queries.
 */
import type { PrismaClient } from '@rizzotto/db';
import { BATTLE_TYPES } from '@rizzotto/types';
import { localSlotNow, slotToInstant } from './availability-time.js';
import { SITE_TZ } from './site-time.js';
import { loadCalibrationQuestions } from './skill-classification-service.js';

export const REPORT_BATTLE_TYPES = BATTLE_TYPES;
type ReportBattleType = (typeof REPORT_BATTLE_TYPES)[number];

/** One value per battle type (report columns are per type). */
function emptyByType<T>(value: T): Record<ReportBattleType, T> {
  return Object.fromEntries(REPORT_BATTLE_TYPES.map((t) => [t, value])) as Record<ReportBattleType, T>;
}

/** A completed, counted game, reduced to what the report needs. Competitor ids may be team ids. */
export interface ReportGame {
  playedAt: Date;
  type: 'TOURNAMENT' | 'OPEN_PLAY';
  source: 'QUEUE' | 'CHALLENGE' | 'AVAILABILITY' | null;
  tournamentId: string | null;
  hasReplay: boolean;
  competitorIds: string[];
}

export interface ReportParticipant {
  userId: string;
  tournamentId: string;
  status: 'REGISTERED' | 'CHECKED_IN' | 'DISQUALIFIED' | 'WITHDREW' | 'JOIN_REQUESTED';
  tournamentStart: Date;
  tournamentStarted: boolean; // ONGOING or COMPLETED
}

export interface ReportUser {
  id: string;
  username: string;
  createdAt: Date;
  lastLogin: Date | null;
  timezone: string | null;
  botPolicy: 'NORMAL' | 'NO_BROADCASTS' | 'NO_BOT_MESSAGES';
  paused: boolean;
  discordId: string;
  steamVerified: boolean;
  referralSource: string | null;
  /** Battle types (and "general") the player answered at least one questionnaire question for. */
  answered: { general: boolean } & Record<ReportBattleType, boolean>;
}

export interface PlayerReportInput {
  windowStart: Date;
  users: ReportUser[];
  slots: { userId: string; context: 'TOURNAMENT' | 'MATCHMAKING' }[];
  tournamentPrefCustom: Set<string>;
  queuePrefSet: Set<string>;
  teamMembers: Map<string, string[]>;
  games: ReportGame[];
  participants: ReportParticipant[];
  hosted: { userId: string; start: Date }[];
  queueEvents: { userId: string; event: string; at: Date }[];
  dms: { discordId: string; status: 'SENT' | 'FAILED' | 'SKIPPED' }[];
}

export interface PlayerReportRow {
  id: string;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  timezone: string | null;
  steamVerified: boolean;
  referralSource: string | null;
  botPolicy: ReportUser['botPolicy'];
  // availability
  mmSlots: number;
  tournamentSlots: number;
  paused: boolean;
  tournamentDmFilterCustom: boolean;
  queuePrefsSaved: boolean;
  // play (window)
  tournamentGames: number;
  openPlayQueue: number;
  openPlayAvailability: number;
  openPlayChallenge: number;
  gamesWithReplay: number;
  // play (all time)
  gamesTotal: number;
  firstGameAt: string | null;
  lastGameAt: string | null;
  // tournaments (window, by tournament start)
  tournamentsEntered: number;
  drops: number;
  noShows: number;
  disqualified: number;
  hosted: number;
  hostedTotal: number;
  lastHostedAt: string | null;
  // queue behaviour (window)
  queueJoins: number;
  queueWarnings: number;
  queueTimeouts: number;
  // bot DMs (window)
  dmSent: number;
  dmFailed: number;
  // questionnaire
  answered: ReportUser['answered'];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Expand a competitor id (user or team) to user ids. */
function usersOf(id: string, teamMembers: Map<string, string[]>): string[] {
  return teamMembers.get(id) ?? [id];
}

export function buildPlayerReportRows(input: PlayerReportInput): PlayerReportRow[] {
  const { windowStart: ws } = input;
  const rows = new Map<string, PlayerReportRow>();
  const byDiscord = new Map<string, PlayerReportRow>();
  for (const u of input.users) {
    const row: PlayerReportRow = {
      id: u.id,
      username: u.username,
      createdAt: u.createdAt.toISOString(),
      lastLogin: iso(u.lastLogin),
      timezone: u.timezone,
      steamVerified: u.steamVerified,
      referralSource: u.referralSource,
      botPolicy: u.botPolicy,
      mmSlots: 0,
      tournamentSlots: 0,
      paused: u.paused,
      tournamentDmFilterCustom: input.tournamentPrefCustom.has(u.id),
      queuePrefsSaved: input.queuePrefSet.has(u.id),
      tournamentGames: 0,
      openPlayQueue: 0,
      openPlayAvailability: 0,
      openPlayChallenge: 0,
      gamesWithReplay: 0,
      gamesTotal: 0,
      firstGameAt: null,
      lastGameAt: null,
      tournamentsEntered: 0,
      drops: 0,
      noShows: 0,
      disqualified: 0,
      hosted: 0,
      hostedTotal: 0,
      lastHostedAt: null,
      queueJoins: 0,
      queueWarnings: 0,
      queueTimeouts: 0,
      dmSent: 0,
      dmFailed: 0,
      answered: u.answered,
    };
    rows.set(u.id, row);
    byDiscord.set(u.discordId, row);
  }

  for (const s of input.slots) {
    const r = rows.get(s.userId);
    if (!r) continue;
    if (s.context === 'MATCHMAKING') r.mmSlots++;
    else r.tournamentSlots++;
  }

  // Which (user, tournament) pairs actually played — for the no-show rule below.
  const playedIn = new Set<string>();
  for (const g of input.games) {
    const players = new Set(g.competitorIds.flatMap((id) => usersOf(id, input.teamMembers)));
    const inWindow = g.playedAt >= ws;
    for (const uid of players) {
      if (g.tournamentId) playedIn.add(`${uid}:${g.tournamentId}`);
      const r = rows.get(uid);
      if (!r) continue;
      r.gamesTotal++;
      const at = g.playedAt.toISOString();
      if (!r.firstGameAt || at < r.firstGameAt) r.firstGameAt = at;
      if (!r.lastGameAt || at > r.lastGameAt) r.lastGameAt = at;
      if (!inWindow) continue;
      if (g.type === 'TOURNAMENT') r.tournamentGames++;
      else if (g.source === 'CHALLENGE') r.openPlayChallenge++;
      else if (g.source === 'AVAILABILITY') r.openPlayAvailability++;
      else r.openPlayQueue++;
      if (g.hasReplay) r.gamesWithReplay++;
    }
  }

  for (const p of input.participants) {
    const r = rows.get(p.userId);
    if (!r || p.tournamentStart < ws || p.status === 'JOIN_REQUESTED') continue;
    r.tournamentsEntered++;
    if (p.status === 'WITHDREW') r.drops++;
    else if (p.status === 'DISQUALIFIED') r.disqualified++;
    // Entered a tournament that ran, never withdrew, never played a game in it.
    else if (p.tournamentStarted && !playedIn.has(`${p.userId}:${p.tournamentId}`)) r.noShows++;
  }

  for (const h of input.hosted) {
    const r = rows.get(h.userId);
    if (!r) continue;
    r.hostedTotal++;
    if (h.start >= ws) r.hosted++;
    const at = h.start.toISOString();
    if (!r.lastHostedAt || at > r.lastHostedAt) r.lastHostedAt = at;
  }

  for (const e of input.queueEvents) {
    const r = rows.get(e.userId);
    if (!r || e.at < ws) continue;
    if (e.event === 'JOIN') r.queueJoins++;
    else if (e.event === 'WARNING') r.queueWarnings++;
    else if (e.event === 'TIMEOUT') r.queueTimeouts++;
  }

  for (const m of input.dms) {
    const r = byDiscord.get(m.discordId);
    if (!r) continue;
    if (m.status === 'SENT') r.dmSent++;
    else if (m.status === 'FAILED') r.dmFailed++;
  }

  return [...rows.values()];
}

/** True when stored tournament DM prefs narrow anything (all types + both sizes = default). */
export function isCustomTournamentPref(
  battleTypes: string[],
  competitorFormats: string[],
): boolean {
  const types = new Set(battleTypes);
  const formats = new Set(competitorFormats);
  return (
    REPORT_BATTLE_TYPES.some((t) => !types.has(t)) ||
    !formats.has('ONE_V_ONE') ||
    !formats.has('TWO_V_TWO')
  );
}

/** Which scopes a set of calibration answers covers, given the question catalog. */
export function answeredScopes(
  answers: Record<string, unknown> | null | undefined,
  questions: { id: string; battleTypes?: string[] }[],
): ReportUser['answered'] {
  const out = { general: false, ...emptyByType(false) };
  if (!answers) return out;
  for (const q of questions) {
    if (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === '') continue;
    if (!q.battleTypes || q.battleTypes.length === 0) out.general = true;
    else for (const t of q.battleTypes) if (t in out) out[t as ReportBattleType] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Completed, counted games on live matches (same source set as the public game history). */
async function loadReportGames(prisma: PrismaClient): Promise<ReportGame[]> {
  const games = await prisma.matchGame.findMany({
    where: {
      status: 'COMPLETED',
      match: {
        deleted_at: null,
        counts_for_leaderboard: true,
        player1_id: { not: null },
        player2_id: { not: null },
      },
    },
    select: {
      played_at: true,
      created_at: true,
      replay_url: true,
      match: {
        select: {
          type: true,
          source: true,
          tournament_id: true,
          player1_id: true,
          player2_id: true,
        },
      },
    },
  });
  return games.map((g) => ({
    playedAt: g.played_at ?? g.created_at,
    type: g.match.type,
    source: g.match.source,
    tournamentId: g.match.tournament_id,
    hasReplay: !!g.replay_url,
    competitorIds: [g.match.player1_id, g.match.player2_id].filter((x): x is string => !!x),
  }));
}

async function loadTeamMembers(prisma: PrismaClient): Promise<Map<string, string[]>> {
  const members = await prisma.teamMember.findMany({ select: { team_id: true, user_id: true } });
  const map = new Map<string, string[]>();
  for (const m of members) map.set(m.team_id, [...(map.get(m.team_id) ?? []), m.user_id]);
  return map;
}

/** Hosting credits: the main host plus every co-host, per non-deleted tournament. */
async function loadHosting(prisma: PrismaClient) {
  const tournaments = await prisma.tournament.findMany({
    where: { deleted_at: null },
    select: { id: true, host_id: true, start_date: true, co_hosts: { select: { user_id: true } } },
  });
  const hosted: { userId: string; start: Date; tournamentId: string }[] = [];
  for (const t of tournaments) {
    const ids = new Set([t.host_id, ...t.co_hosts.map((h) => h.user_id)]);
    for (const userId of ids) hosted.push({ userId, start: t.start_date, tournamentId: t.id });
  }
  return hosted;
}

export async function loadPlayerReport(
  prisma: PrismaClient,
  days: number,
): Promise<PlayerReportRow[]> {
  const windowStart = days > 0 ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const [
    users,
    questions,
    slots,
    tPrefs,
    qPrefs,
    teamMembers,
    games,
    participants,
    hosted,
    queueEvents,
    dms,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        username: true,
        created_at: true,
        last_login: true,
        timezone: true,
        bot_message_policy: true,
        availability_paused: true,
        discord_id: true,
        referral_source: true,
        calibration_answers: true,
        steam_link: { select: { user_id: true } },
      },
    }),
    loadCalibrationQuestions(prisma),
    prisma.availabilitySlot.findMany({ select: { user_id: true, context: true } }),
    prisma.userTournamentNotifyPref.findMany({
      select: { user_id: true, battle_types: true, competitor_formats: true },
    }),
    prisma.userQueuePref.findMany({ select: { user_id: true } }),
    loadTeamMembers(prisma),
    loadReportGames(prisma),
    prisma.tournamentParticipant.findMany({
      where: { deleted_at: null, tournament: { deleted_at: null } },
      select: {
        user_id: true,
        tournament_id: true,
        status: true,
        tournament: { select: { start_date: true, status: true } },
      },
    }),
    loadHosting(prisma),
    prisma.queueActivityLog.findMany({
      where: { created_at: { gte: windowStart }, event: { in: ['JOIN', 'WARNING', 'TIMEOUT'] } },
      select: { user_id: true, event: true, created_at: true },
    }),
    prisma.botMessage.findMany({
      where: {
        target_type: 'DM',
        created_at: { gte: windowStart },
        status: { in: ['SENT', 'FAILED'] },
      },
      select: { target_id: true, status: true },
    }),
  ]);

  return buildPlayerReportRows({
    windowStart,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      createdAt: u.created_at,
      lastLogin: u.last_login,
      timezone: u.timezone,
      botPolicy: u.bot_message_policy,
      paused: u.availability_paused,
      discordId: u.discord_id,
      steamVerified: !!u.steam_link,
      referralSource: u.referral_source,
      answered: answeredScopes(u.calibration_answers as Record<string, unknown> | null, questions),
    })),
    slots: slots.map((s) => ({ userId: s.user_id, context: s.context })),
    tournamentPrefCustom: new Set(
      tPrefs
        .filter((p) => isCustomTournamentPref(p.battle_types, p.competitor_formats))
        .map((p) => p.user_id),
    ),
    queuePrefSet: new Set(qPrefs.map((p) => p.user_id)),
    teamMembers,
    games,
    participants: participants.map((p) => ({
      userId: p.user_id,
      tournamentId: p.tournament_id,
      status: p.status,
      tournamentStart: p.tournament.start_date,
      tournamentStarted: p.tournament.status === 'ONGOING' || p.tournament.status === 'COMPLETED',
    })),
    hosted,
    queueEvents: queueEvents.map((e) => ({ userId: e.user_id, event: e.event, at: e.created_at })),
    dms: dms.map((m) => ({ discordId: m.target_id, status: m.status })),
  });
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

export interface HostReportRow {
  id: string;
  username: string;
  hosted: number;
  hostedTotal: number;
  lastHostedAt: string | null;
  avgField: number | null;
  battleTypes: Record<ReportBattleType, number>;
  upcoming: number;
}

export async function loadHostReport(prisma: PrismaClient, days: number): Promise<HostReportRow[]> {
  const windowStart = days > 0 ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const now = new Date();
  const tournaments = await prisma.tournament.findMany({
    where: { deleted_at: null },
    select: {
      host_id: true,
      start_date: true,
      status: true,
      battle_type: true,
      co_hosts: { select: { user_id: true } },
      _count: {
        select: {
          participants: {
            where: {
              deleted_at: null,
              status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW', 'DISQUALIFIED'] },
            },
          },
        },
      },
    },
  });
  const acc = new Map<
    string,
    {
      hosted: number;
      total: number;
      last: Date | null;
      fields: number[];
      bt: Record<ReportBattleType, number>;
      upcoming: number;
    }
  >();
  for (const t of tournaments) {
    for (const userId of new Set([t.host_id, ...t.co_hosts.map((h) => h.user_id)])) {
      const a = acc.get(userId) ?? {
        hosted: 0,
        total: 0,
        last: null,
        fields: [],
        bt: emptyByType(0),
        upcoming: 0,
      };
      if (t.start_date > now && t.status !== 'COMPLETED') a.upcoming++;
      else {
        a.total++;
        if (!a.last || t.start_date > a.last) a.last = t.start_date;
        if (t.start_date >= windowStart) {
          a.hosted++;
          a.fields.push(t._count.participants);
          a.bt[t.battle_type as ReportBattleType]++;
        }
      }
      acc.set(userId, a);
    }
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...acc.keys()] } },
    select: { id: true, username: true },
  });
  const names = new Map(users.map((u) => [u.id, u.username]));
  return [...acc.entries()]
    .map(([id, a]) => ({
      id,
      username: names.get(id) ?? '(deleted)',
      hosted: a.hosted,
      hostedTotal: a.total,
      lastHostedAt: iso(a.last),
      avgField: a.fields.length
        ? Math.round((a.fields.reduce((x, y) => x + y, 0) / a.fields.length) * 10) / 10
        : null,
      battleTypes: a.bt,
      upcoming: a.upcoming,
    }))
    .sort((x, y) => y.hosted - x.hosted || y.hostedTotal - x.hostedTotal);
}

// ---------------------------------------------------------------------------
// Schedule fit — 7×24 grids in site time (Europe/Berlin), Monday-first
// ---------------------------------------------------------------------------

export type Grid = number[][];
const emptyGrid = (): Grid => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
/** Add `n` to a grid cell (cells always exist: 7 days × 24 hours). */
function bump(grid: Grid, d: number, h: number, n = 1): void {
  const row = grid[d];
  if (row) row[h] = (row[h] ?? 0) + n;
}

export interface ScheduleReport {
  timezone: string;
  tournamentAvailability: Grid;
  matchmakingAvailability: Grid;
  tournamentsStarted: Grid;
  avgTournamentField: Grid;
  openPlayGames: Grid;
}

/** Site-time cell of an instant. */
function siteCell(at: Date): { d: number; h: number } {
  const c = localSlotNow(at, SITE_TZ);
  return { d: c.day_of_week, h: c.hour };
}

export async function loadScheduleReport(
  prisma: PrismaClient,
  days: number,
): Promise<ScheduleReport> {
  const windowStart = days > 0 ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const now = new Date();
  const [slots, tournaments, opGames] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { user: { deleted_at: null, availability_paused: false } },
      select: {
        day_of_week: true,
        hour_local: true,
        context: true,
        user: { select: { timezone: true } },
      },
    }),
    prisma.tournament.findMany({
      where: {
        deleted_at: null,
        start_date: { gte: windowStart, lte: now },
        status: { in: ['ONGOING', 'COMPLETED'] },
      },
      select: {
        start_date: true,
        _count: {
          select: {
            participants: {
              where: {
                deleted_at: null,
                status: { in: ['CHECKED_IN', 'WITHDREW', 'DISQUALIFIED'] },
              },
            },
          },
        },
      },
    }),
    prisma.matchGame.findMany({
      where: {
        status: 'COMPLETED',
        match: { type: 'OPEN_PLAY', deleted_at: null },
        OR: [
          { played_at: { gte: windowStart } },
          { played_at: null, created_at: { gte: windowStart } },
        ],
      },
      select: { played_at: true, created_at: true },
    }),
  ]);

  const tAvail = emptyGrid();
  const mAvail = emptyGrid();
  for (const s of slots) {
    // Project the owner's local slot onto site time for the current week (DST-correct per zone).
    const at = slotToInstant(
      { day_of_week: s.day_of_week, hour: s.hour_local },
      s.user.timezone,
      now,
    );
    const { d, h } = siteCell(at);
    bump(s.context === 'TOURNAMENT' ? tAvail : mAvail, d, h);
  }

  const started = emptyGrid();
  const fieldSum = emptyGrid();
  for (const t of tournaments) {
    const { d, h } = siteCell(t.start_date);
    bump(started, d, h);
    bump(fieldSum, d, h, t._count.participants);
  }
  const avgField = fieldSum.map((row, d) =>
    row.map((sum, h) => {
      const n = started[d]?.[h] ?? 0;
      return n ? Math.round((sum / n) * 10) / 10 : 0;
    }),
  );

  const op = emptyGrid();
  for (const g of opGames) {
    const { d, h } = siteCell(g.played_at ?? g.created_at);
    bump(op, d, h);
  }

  return {
    timezone: SITE_TZ,
    tournamentAvailability: tAvail,
    matchmakingAvailability: mAvail,
    tournamentsStarted: started,
    avgTournamentField: avgField,
    openPlayGames: op,
  };
}
