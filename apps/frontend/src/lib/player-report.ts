// Admin Players report — client-side filters (presets), KPIs, signup funnel and CSV export over the
// rows from /api/admin/reports/players. Pure functions, unit-tested in player-report.test.ts.
import type { AdminPlayerReportRow } from './api';

export interface PresetContext {
  nowMs: number;
  /** Start of the report window (ms). */
  windowStartMs: number;
  /** Lapsed = last game older than this many days. */
  lapsedDays: number;
  /** User ids not in the Discord server — only known after the membership check ran. */
  notInDiscord: Set<string> | null;
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  group:
    | 'Availability'
    | 'Play'
    | 'Engagement'
    | 'Hosting & reliability'
    | 'Reach & replays'
    | 'Questionnaire';
  test: (r: AdminPlayerReportRow, ctx: PresetContext) => boolean;
}

export const openPlayGames = (r: AdminPlayerReportRow) =>
  r.openPlayQueue + r.openPlayAvailability + r.openPlayChallenge;
export const windowGames = (r: AdminPlayerReportRow) => r.tournamentGames + openPlayGames(r);
const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);

export const PRESETS: Preset[] = [
  // Availability
  {
    id: 'mmAvail',
    group: 'Availability',
    label: 'Matchmaking availability',
    hint: 'Has matchmaking calendar slots',
    test: (r) => r.mmSlots > 0,
  },
  {
    id: 'tAvail',
    group: 'Availability',
    label: 'Tournament availability',
    hint: 'Has tournament calendar slots',
    test: (r) => r.tournamentSlots > 0,
  },
  {
    id: 'paused',
    group: 'Availability',
    label: 'Paused',
    hint: 'Availability paused (no DMs)',
    test: (r) => r.paused,
  },
  {
    id: 'tFilter',
    group: 'Availability',
    label: 'Narrowed tournament DMs',
    hint: 'Only wants some battle types or team sizes',
    test: (r) => r.tournamentDmFilterCustom,
  },
  {
    id: 'availIdle',
    group: 'Availability',
    label: 'Available, not playing',
    hint: 'Has slots but no game in the window',
    test: (r) => r.mmSlots + r.tournamentSlots > 0 && windowGames(r) === 0,
  },
  // Play
  {
    id: 'openPlay',
    group: 'Play',
    label: 'Open Play',
    hint: 'Any Open Play game in the window',
    test: (r) => openPlayGames(r) > 0,
  },
  {
    id: 'opQueue',
    group: 'Play',
    label: 'via Queue',
    hint: 'Open Play from the queue',
    test: (r) => r.openPlayQueue > 0,
  },
  {
    id: 'opAvail',
    group: 'Play',
    label: 'via Availability DM',
    hint: 'Open Play from an availability DM',
    test: (r) => r.openPlayAvailability > 0,
  },
  {
    id: 'opChallenge',
    group: 'Play',
    label: 'via Challenge',
    hint: 'Open Play from a challenge',
    test: (r) => r.openPlayChallenge > 0,
  },
  {
    id: 'tournaments',
    group: 'Play',
    label: 'Tournaments',
    hint: 'Played or entered a tournament in the window',
    test: (r) => r.tournamentGames > 0 || r.tournamentsEntered > 0,
  },
  {
    id: 'tournamentsOnly',
    group: 'Play',
    label: 'Tournaments only',
    hint: 'Tournament games, no Open Play',
    test: (r) => r.tournamentGames > 0 && openPlayGames(r) === 0,
  },
  {
    id: 'openPlayOnly',
    group: 'Play',
    label: 'Open Play only',
    hint: 'Open Play games, no tournaments',
    test: (r) => openPlayGames(r) > 0 && r.tournamentGames === 0,
  },
  // Engagement
  {
    id: 'active',
    group: 'Engagement',
    label: 'Active',
    hint: 'At least one game in the window',
    test: (r) => windowGames(r) > 0,
  },
  {
    id: 'lapsed',
    group: 'Engagement',
    label: 'Lapsed',
    hint: 'Played 3+ games, but none for a while (see "lapsed after")',
    test: (r, c) => {
      const last = ms(r.lastGameAt);
      return r.gamesTotal >= 3 && last !== null && c.nowMs - last > c.lapsedDays * 86_400_000;
    },
  },
  {
    id: 'neverPlayed',
    group: 'Engagement',
    label: 'Never played',
    hint: 'No completed game ever',
    test: (r) => r.gamesTotal === 0,
  },
  {
    id: 'newSignups',
    group: 'Engagement',
    label: 'New sign-ups',
    hint: 'Registered inside the window',
    test: (r, c) => Date.parse(r.createdAt) >= c.windowStartMs,
  },
  // Hosting & reliability
  {
    id: 'hosts',
    group: 'Hosting & reliability',
    label: 'Hosts',
    hint: 'Hosted or co-hosted in the window',
    test: (r) => r.hosted > 0,
  },
  {
    id: 'drops',
    group: 'Hosting & reliability',
    label: 'Dropped',
    hint: 'Withdrew from a tournament in the window',
    test: (r) => r.drops > 0,
  },
  {
    id: 'unreliable',
    group: 'Hosting & reliability',
    label: 'Unreliable',
    hint: '2+ no-shows, 2+ queue warnings or any queue timeout in the window',
    test: (r) => r.noShows >= 2 || r.queueWarnings >= 2 || r.queueTimeouts >= 1,
  },
  // Reach & replays
  {
    id: 'unreachable',
    group: 'Reach & replays',
    label: 'Hard to reach',
    hint: 'Opted out of DMs, a DM failed, or not in the Discord server (after the check)',
    test: (r, c) =>
      r.botPolicy !== 'NORMAL' || r.dmFailed > 0 || (c.notInDiscord?.has(r.id) ?? false),
  },
  {
    id: 'optedOut',
    group: 'Reach & replays',
    label: 'DMs opted out',
    hint: 'No broadcasts or no bot messages at all',
    test: (r) => r.botPolicy !== 'NORMAL',
  },
  {
    id: 'lowReplay',
    group: 'Reach & replays',
    label: 'Few replays',
    hint: '5+ games in the window, under half with a replay',
    test: (r) => windowGames(r) >= 5 && r.gamesWithReplay / windowGames(r) < 0.5,
  },
  // Questionnaire
  {
    id: 'noQuestionnaire',
    group: 'Questionnaire',
    label: 'No questionnaire',
    hint: 'Never answered any question',
    test: (r) =>
      !r.answered.general && !r.answered.DOMINATION && !r.answered.CONQUEST && !r.answered.SIEGE,
  },
  {
    id: 'missingDomination',
    group: 'Questionnaire',
    label: 'Missing Domination',
    hint: 'No Domination questions answered',
    test: (r) => !r.answered.DOMINATION,
  },
  {
    id: 'missingConquest',
    group: 'Questionnaire',
    label: 'Missing Conquest',
    hint: 'No Conquest questions answered',
    test: (r) => !r.answered.CONQUEST,
  },
  {
    id: 'missingSiege',
    group: 'Questionnaire',
    label: 'Missing Siege',
    hint: 'No Siege questions answered',
    test: (r) => !r.answered.SIEGE,
  },
];

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/** Rows matching ALL selected presets and the name search. */
export function filterRows(
  rows: AdminPlayerReportRow[],
  presetIds: string[],
  search: string,
  ctx: PresetContext,
): AdminPlayerReportRow[] {
  const presets = presetIds.map((id) => PRESET_BY_ID.get(id)).filter((p): p is Preset => !!p);
  const q = search.trim().toLowerCase();
  return rows.filter(
    (r) => (!q || r.username.toLowerCase().includes(q)) && presets.every((p) => p.test(r, ctx)),
  );
}

export interface ReportKpis {
  players: number;
  active: number;
  pct: (n: number) => number;
  mmAvail: number;
  tAvail: number;
  openPlay: number;
  tournaments: number;
  hosts: number;
  lapsed: number;
}

/** Headline numbers; feature shares are relative to active players (a game in the window). */
export function computeKpis(rows: AdminPlayerReportRow[], ctx: PresetContext): ReportKpis {
  const active = rows.filter((r) => windowGames(r) > 0);
  const count = (id: string, pool = active) =>
    pool.filter((r) => PRESET_BY_ID.get(id)!.test(r, ctx)).length;
  return {
    players: rows.length,
    active: active.length,
    pct: (n) => (active.length ? Math.round((n / active.length) * 100) : 0),
    mmAvail: count('mmAvail'),
    tAvail: count('tAvail'),
    openPlay: count('openPlay'),
    tournaments: count('tournaments'),
    hosts: count('hosts', rows),
    lapsed: count('lapsed', rows),
  };
}

export interface FunnelCohort {
  month: string; // YYYY-MM
  registered: number;
  verified: number;
  played1: number;
  played5: number;
  active30: number;
}

/** Sign-up cohorts by month: registered → Steam verified → 1st game → 5 games → a game in the last 30 days. */
export function buildFunnel(rows: AdminPlayerReportRow[], nowMs: number): FunnelCohort[] {
  const byMonth = new Map<string, FunnelCohort>();
  for (const r of rows) {
    const month = r.createdAt.slice(0, 7);
    const c = byMonth.get(month) ?? {
      month,
      registered: 0,
      verified: 0,
      played1: 0,
      played5: 0,
      active30: 0,
    };
    c.registered++;
    if (r.steamVerified) c.verified++;
    if (r.gamesTotal >= 1) c.played1++;
    if (r.gamesTotal >= 5) c.played5++;
    const last = ms(r.lastGameAt);
    if (last !== null && nowMs - last <= 30 * 86_400_000) c.active30++;
    byMonth.set(month, c);
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Timezones of the given players, most common first ("unknown" when not set). */
export function timezoneCounts(rows: AdminPlayerReportRow[]): { zone: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.timezone ?? 'unknown', (m.get(r.timezone ?? 'unknown') ?? 0) + 1);
  return [...m.entries()]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone));
}

const CSV_COLUMNS: {
  key: string;
  get: (r: AdminPlayerReportRow) => string | number | boolean | null;
}[] = [
  { key: 'username', get: (r) => r.username },
  { key: 'id', get: (r) => r.id },
  { key: 'registered', get: (r) => r.createdAt.slice(0, 10) },
  { key: 'last_login', get: (r) => r.lastLogin?.slice(0, 10) ?? '' },
  { key: 'last_game', get: (r) => r.lastGameAt?.slice(0, 10) ?? '' },
  { key: 'games_total', get: (r) => r.gamesTotal },
  { key: 'tournament_games', get: (r) => r.tournamentGames },
  { key: 'open_play_queue', get: (r) => r.openPlayQueue },
  { key: 'open_play_availability', get: (r) => r.openPlayAvailability },
  { key: 'open_play_challenge', get: (r) => r.openPlayChallenge },
  { key: 'mm_slots', get: (r) => r.mmSlots },
  { key: 'tournament_slots', get: (r) => r.tournamentSlots },
  { key: 'paused', get: (r) => r.paused },
  { key: 'tournaments_entered', get: (r) => r.tournamentsEntered },
  { key: 'no_shows', get: (r) => r.noShows },
  { key: 'drops', get: (r) => r.drops },
  { key: 'hosted', get: (r) => r.hosted },
  { key: 'hosted_total', get: (r) => r.hostedTotal },
  { key: 'queue_warnings', get: (r) => r.queueWarnings },
  { key: 'queue_timeouts', get: (r) => r.queueTimeouts },
  { key: 'games_with_replay', get: (r) => r.gamesWithReplay },
  { key: 'dm_sent', get: (r) => r.dmSent },
  { key: 'dm_failed', get: (r) => r.dmFailed },
  { key: 'dm_policy', get: (r) => r.botPolicy },
  { key: 'steam_verified', get: (r) => r.steamVerified },
  { key: 'timezone', get: (r) => r.timezone ?? '' },
  { key: 'referral_source', get: (r) => r.referralSource ?? '' },
  { key: 'q_domination', get: (r) => r.answered.DOMINATION },
  { key: 'q_conquest', get: (r) => r.answered.CONQUEST },
  { key: 'q_siege', get: (r) => r.answered.SIEGE },
];

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: AdminPlayerReportRow[]): string {
  const lines = [CSV_COLUMNS.map((c) => c.key).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(c.get(r))).join(','));
  return lines.join('\n');
}

/** Hand-off of a report list to the Broadcast tab (sessionStorage; the URL would get too long). */
export const BROADCAST_LIST_KEY = 'rizzotto.admin.broadcastList';
export interface BroadcastListHandoff {
  label: string;
  userIds: string[];
}
