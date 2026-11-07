/**
 * Discord Open Play: `/join` → a join DM with the full queue settings, a ticker of open requests in
 * the configured server channels, and a match card per player that plays the whole match in DMs
 * (faction pick, lobby, result + replay, confirm/dispute, cancel, Bo3). See plans/discord-open-play.md.
 *
 * Every action goes through the same code as the site: the queue via joinOpenPlayQueue /
 * leaveOpenPlayQueue / claimQueueOffer, match actions by calling the site's own routes as the player
 * (callAsUser). The site stays the source of truth; a card is only a view of the match, re-rendered
 * from the database after every change (refreshMatchCards, plus a per-minute reconcile).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@rizzotto/db';
import { BATTLE_TYPE_LABELS } from '@rizzotto/types';
import { discordRequest, isBotConfigured, openDmChannel } from './discord-notify.js';
import { QUEUE_KEY, QUEUE_PREFS_KEY } from './matchmaking-tick.js';
import {
  ALL_BATTLE_TYPES,
  ALL_QUEUE_MATCH_FORMATS,
  encodeOffer,
  parseQueuePrefs,
  type QueueBattleType,
  type QueueMatchFormat,
  type QueueOffer,
  type QueuePrefs,
} from './queue-matching.js';
import { getStoredQueuePrefs } from './queue-prefs.js';
import { mapNameFromTerrain } from './replay-maps.js';
import { parseReplayMeta } from './replay-parser.js';
import { startOfSiteDay } from './site-time.js';
import { openPlayBannedFactionIds } from './standard-ruleset.js';
import { matchWeeklyBans, weeklyBanOpensAt, type WeeklyBan } from './weekly-ban.js';

// ---------------------------------------------------------------------------
// Discord wire format
// ---------------------------------------------------------------------------

const ROW = 1;
const BUTTON = 2;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
const LABEL = 18;
const FILE_UPLOAD = 19;

const PRIMARY = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;
const LINK = 5;

export interface DiscordMessage {
  content: string;
  components: object[];
  allowed_mentions?: object;
}

const row = (...components: object[]) => ({ type: ROW, components });
const btn = (label: string, custom_id: string, style = SECONDARY, disabled = false) => ({ type: BUTTON, style, label, custom_id, disabled });
const linkBtn = (label: string, url: string) => ({ type: BUTTON, style: LINK, label, url });

function select(custom_id: string, options: { label: string; value: string; default?: boolean }[], min: number, max: number, placeholder: string) {
  return { type: STRING_SELECT, custom_id, options, min_values: min, max_values: max, placeholder };
}

const siteUrl = () => process.env.FRONTEND_URL ?? 'https://rizzotto.gg';
const noMentions = { parse: [] as string[] };

// ---------------------------------------------------------------------------
// Redis state
// ---------------------------------------------------------------------------

const JOIN_DM_KEY = (userId: string) => `rizzotto:dop:join:${userId}`;
const CARD_KEY = (matchId: string, userId: string) => `rizzotto:dop:card:${matchId}:${userId}`;
const TICKER_KEY = 'rizzotto:dop:ticker';
const TICKER_CLOSED_KEY = 'rizzotto:dop:ticker:closed';
const PING_KEY = (guildId: string) => `rizzotto:dop:ping:${guildId}`;
const PANEL_HASH_KEY = (guildId: string) => `rizzotto:dop:panel:${guildId}`;
export const PENDING_JOIN_KEY = (discordId: string) => `rizzotto:dop:pending:${discordId}`;

const JOIN_DM_TTL = 24 * 3600;
const CARD_TTL = 7 * 24 * 3600;
const PING_GAP_SEC = 5 * 60;
/** A closed ticker post stays this long (saying how it ended), then the bot deletes it. */
const TICKER_CLOSED_TTL_MS = 15 * 60_000;
const PENDING_TTL = 15 * 60;

interface StoredMessage {
  channelId: string;
  messageId: string;
  hash?: string;
}

const hashOf = (m: DiscordMessage) => createHash('sha1').update(JSON.stringify(m)).digest('hex');

async function postMessage(channelId: string, body: DiscordMessage): Promise<string | null> {
  const res = await discordRequest('POST', `/channels/${channelId}/messages`, body);
  if (!res.ok) return null;
  return ((await res.json()) as { id: string }).id;
}

/** Post a DM. 'closed' = the player doesn't accept DMs from the bot (Discord 50007 / 403). */
async function postDm(discordId: string, body: DiscordMessage): Promise<StoredMessage | 'closed' | null> {
  const channelId = await openDmChannel(discordId);
  if (!channelId) return null;
  const res = await discordRequest('POST', `/channels/${channelId}/messages`, body);
  if (res.status === 403) return 'closed';
  if (!res.ok) return null;
  return { channelId, messageId: ((await res.json()) as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Server config (Admin → Settings → Discord Open Play)
// ---------------------------------------------------------------------------

export const GUILDS_CONFIG_KEY = 'discord_open_play_guilds';

export interface OpenPlayGuild {
  guildId: string;
  label?: string;
  tickerChannelId: string;
  pingRoleId?: string | null;
}

export async function getOpenPlayGuilds(fastify: Pick<FastifyInstance, 'prisma'>): Promise<OpenPlayGuild[]> {
  const row = await fastify.prisma.adminConfig.findUnique({ where: { key: GUILDS_CONFIG_KEY } });
  const value = row?.value as unknown;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is OpenPlayGuild =>
      !!g && typeof g === 'object' && typeof (g as OpenPlayGuild).guildId === 'string' && typeof (g as OpenPlayGuild).tickerChannelId === 'string',
  );
}

/**
 * Rollout. Until `live` is switched on (the default is off) Discord Open Play runs for testers only:
 * the listed Discord ids and site admins. `/join` then shows for server admins only and not in DMs,
 * the panel and ticker buttons tell everyone else it isn't open yet, and only testers get match
 * cards (the other player in a tester's match keeps the usual match-found DM).
 */
export const ROLLOUT_CONFIG_KEY = 'discord_open_play_rollout';

export interface OpenPlayRollout {
  live: boolean;
  testerDiscordIds: string[];
}

export async function getOpenPlayRollout(fastify: FastifyInstance): Promise<OpenPlayRollout> {
  const row = await fastify.prisma.adminConfig.findUnique({ where: { key: ROLLOUT_CONFIG_KEY } });
  const value = row?.value as { live?: unknown; testerDiscordIds?: unknown } | null | undefined;
  return {
    live: value?.live === true,
    testerDiscordIds: Array.isArray(value?.testerDiscordIds)
      ? value.testerDiscordIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

/** Whether all these Discord users may use Discord Open Play (everyone, once it is live). */
export async function areOpenPlayTesters(fastify: FastifyInstance, discordIds: string[]): Promise<boolean> {
  const rollout = await getOpenPlayRollout(fastify);
  if (rollout.live) return true;
  const rest = [...new Set(discordIds)].filter((id) => !rollout.testerDiscordIds.includes(id));
  if (rest.length === 0) return true;
  const admins = await fastify.prisma.user.count({ where: { discord_id: { in: rest }, role: 'ADMIN', deleted_at: null } });
  return admins === rest.length;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const BT_LABEL = BATTLE_TYPE_LABELS as Record<string, string>;
const FORMAT_LABEL: Record<string, string> = { BO1: 'Bo1', BO2: 'Bo2', BO3: 'Bo3', BO5: 'Bo5' };
const sizeLabel = (format: string) => (format === 'TWO_V_TWO' ? '2v2' : '1v1');

/** "Land Battle, Conquest · Bo1, Bo3 · 1v1" */
export function describePrefs(p: Pick<QueuePrefs, 'battleTypes' | 'matchFormats' | 'format'>): string {
  return `${p.battleTypes.map((b) => BT_LABEL[b] ?? b).join(', ')} · ${p.matchFormats.map((f) => FORMAT_LABEL[f] ?? f).join(', ')} · ${sizeLabel(p.format)}`;
}

// ---------------------------------------------------------------------------
// Join DM
// ---------------------------------------------------------------------------

/** The queue entry the user is in (as himself or as captain of a team), with its prefs. */
async function findQueuedEntry(fastify: FastifyInstance, userId: string): Promise<{ queueId: string; prefs: QueuePrefs } | null> {
  const redis = fastify.redis;
  if (!redis) return null;
  const teams = await fastify.prisma.team.findMany({ where: { captain_id: userId, status: 'ACTIVE' }, select: { id: true } });
  for (const id of [userId, ...teams.map((t) => t.id)]) {
    if ((await redis.lpos(QUEUE_KEY, id)) !== null) return { queueId: id, prefs: parseQueuePrefs(await redis.hget(QUEUE_PREFS_KEY, id)) };
  }
  return null;
}

/** Teams the user can queue as for 2v2: ACTIVE, captained by him, two accepted members. */
async function queueableTeams(fastify: FastifyInstance, userId: string): Promise<{ id: string; name: string }[]> {
  const teams = await fastify.prisma.team.findMany({
    where: { captain_id: userId, status: 'ACTIVE' },
    select: { id: true, name: true, members: { select: { accepted_at: true } } },
    orderBy: { created_at: 'asc' },
  });
  return teams.filter((t) => t.members.filter((m) => m.accepted_at !== null).length >= 2).map((t) => ({ id: t.id, name: t.name }));
}

/**
 * The join DM: the queue settings exactly as on the Open Play page (battle types and Bo1/Bo3 as
 * multi-selects, team size as a single select, the team for 2v2), preset from the stored settings.
 * Every change is saved straight away, like on the site. While queued it shows the entry + Leave.
 */
export async function renderJoinDm(
  fastify: FastifyInstance,
  userId: string,
  note?: string,
  banStep?: { set: string } | { drop: true },
): Promise<DiscordMessage> {
  const openPlayLink = linkBtn('Open Play page', `${siteUrl()}/open-play`);
  const noteLine = note ? `\n\n${note}` : '';
  const queued = await findQueuedEntry(fastify, userId);
  if (queued) {
    return {
      content: `**You're in the Open Play queue**\n${describePrefs(queued.prefs)}\n\nYour match card comes to this DM as soon as a game is found.${noteLine}`,
      components: [row(btn('Leave queue', 'oq_leave', DANGER), openPlayLink)],
      allowed_mentions: noMentions,
    };
  }

  const stored = await getStoredQueuePrefs(fastify.prisma, userId);
  const is2v2 = stored.competitorFormat === 'TWO_V_TWO';
  const teams = is2v2 ? await queueableTeams(fastify, userId) : [];
  const team = teams.find((t) => t.id === stored.teamId) ?? teams[0];

  // The weekly ban (VL picking): shown here, set or changed here while it isn't locked, dropped here any time.
  const [me, factions] = await Promise.all([
    fastify.prisma.user.findUnique({ where: { id: userId }, select: { weekly_ban_faction_id: true, weekly_ban_set_at: true } }),
    fastify.prisma.faction.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const banName = me?.weekly_ban_faction_id ? (factions.find((f) => f.id === me.weekly_ban_faction_id)?.name ?? me.weekly_ban_faction_id) : null;
  const banOpensAt = weeklyBanOpensAt(me?.weekly_ban_set_at ?? null);
  const banDraft = banStep && 'set' in banStep && !banOpensAt ? banStep.set : undefined;
  const draftName = banDraft ? factions.find((f) => f.id === banDraft)?.name : undefined;
  if (banDraft && draftName) {
    return {
      content: `**Make ${draftName} your weekly ban?**\nIt is banned for both players in all your Open Play matches, and you can't change it again for 7 days.`,
      components: [row(btn(`Ban ${draftName}`.slice(0, 80), `oq_banok:${banDraft}`, DANGER), btn('Back', 'oq_banno'))],
      allowed_mentions: noMentions,
    };
  }
  if (banStep && 'drop' in banStep && banName) {
    const newOne = banOpensAt ? `You can set a new one <t:${Math.floor(banOpensAt.getTime() / 1000)}:R>.` : 'You can set a new one any time.';
    return {
      content:
        `**Drop your weekly ban?**\n${banName} is no longer banned in your new Open Play matches; matches already under way keep it. ` +
        newOne,
      components: [row(btn('Drop ban', 'oq_bandropok', DANGER), btn('Back', 'oq_banno'))],
      allowed_mentions: noMentions,
    };
  }

  const components: object[] = [
    row(select('oq_bt', ALL_BATTLE_TYPES.map((b) => ({ label: BT_LABEL[b] ?? b, value: b, default: stored.battleTypes.includes(b) })), 1, ALL_BATTLE_TYPES.length, 'Battle types')),
    row(select('oq_fmt', ALL_QUEUE_MATCH_FORMATS.map((f) => ({ label: FORMAT_LABEL[f] ?? f, value: f, default: stored.matchFormats.includes(f) })), 1, ALL_QUEUE_MATCH_FORMATS.length, 'Match format')),
    row(select('oq_size', [
      { label: '1v1', value: 'ONE_V_ONE', default: !is2v2 },
      { label: '2v2', value: 'TWO_V_TWO', default: is2v2 },
    ], 1, 1, 'Team size')),
  ];
  if (is2v2 && teams.length > 1) {
    components.push(row(select('oq_team', teams.map((t) => ({ label: t.name.slice(0, 100), value: t.id, default: t.id === team?.id })), 1, 1, 'Queue as team')));
  }
  // Discord allows 5 rows: the ban select only fits without the team select (and while it can change).
  if (!banOpensAt && factions.length <= 25 && components.length < 4) {
    components.push(
      row(select('oq_ban', factions.map((f) => ({ label: f.name, value: f.id, default: f.id === me?.weekly_ban_faction_id })), 1, 1, banName ? 'Change your weekly ban' : 'Set a weekly ban')),
    );
  }
  const cannot2v2 = is2v2 && teams.length === 0;
  components.push(
    row(btn('Join queue', 'oq_join', SUCCESS, cannot2v2), ...(banName ? [btn('Drop weekly ban', 'oq_bandrop', SECONDARY)] : []), openPlayLink),
  );

  const teamLine = is2v2 && team ? `\nTeam: **${team.name}**` : '';
  const blockLine = cannot2v2 ? '\n\nFor 2v2 you need to be the captain of an active team with two members.' : '';
  const banOpensTs = banOpensAt ? `<t:${Math.floor(banOpensAt.getTime() / 1000)}:R>` : null;
  const banLine = banName
    ? `\n🚫 Weekly ban: **${banName}**, banned for both players in your matches.${banOpensTs ? ` You can change it ${banOpensTs}, or drop it any time.` : ''}`
    : banOpensTs
      ? `\n🚫 Weekly ban: none. You can set a new one ${banOpensTs}.`
      : '\n🚫 Weekly ban: none. You can ban one faction for both players in all your matches.';
  return {
    content:
      `**Find an Open Play game**\nPick what you want to play, then join the queue. Your choice is saved, like on the Open Play page. ` +
      `Siege is always Bo2. Bo3 in Land Battle and Conquest is played with the 3×3 matrix.${banLine}${teamLine}${blockLine}${noteLine}`,
    components,
    allowed_mentions: noMentions,
  };
}

/** Send a fresh join DM (or the match card, when the player already has an active match). */
export async function sendJoinDm(fastify: FastifyInstance, user: { id: string; discord_id: string }): Promise<'sent' | 'card' | 'closed' | 'failed'> {
  const active = await activeOpenPlayMatchId(fastify, user.id);
  if (active) {
    const r = await sendMatchCard(fastify, active, user.id);
    return r === 'closed' ? 'closed' : r ? 'card' : 'failed';
  }
  const posted = await postDm(user.discord_id, await renderJoinDm(fastify, user.id));
  if (posted === 'closed') return 'closed';
  if (!posted) return 'failed';
  await fastify.redis?.set(JOIN_DM_KEY(user.id), JSON.stringify(posted), 'EX', JOIN_DM_TTL);
  return 'sent';
}

/** Re-render the player's last join DM in place (queue left on the site, matched, …). Best-effort. */
export async function refreshJoinDm(fastify: FastifyInstance, userId: string, note?: string): Promise<void> {
  try {
    const raw = await fastify.redis?.get(JOIN_DM_KEY(userId));
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredMessage;
    await discordRequest('PATCH', `/channels/${stored.channelId}/messages/${stored.messageId}`, await renderJoinDm(fastify, userId, note));
  } catch {
    /* best-effort */
  }
}

async function activeOpenPlayMatchId(fastify: FastifyInstance, userId: string): Promise<string | null> {
  const match = await fastify.prisma.match.findFirst({
    where: {
      type: 'OPEN_PLAY',
      status: { in: ['ONGOING', 'AWAITING_CONFIRMATION'] },
      deleted_at: null,
      competitor_format: 'ONE_V_ONE',
      OR: [{ player1_id: userId }, { player2_id: userId }],
    },
    select: { id: true },
    orderBy: { created_at: 'desc' },
  });
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Match card
// ---------------------------------------------------------------------------

type ReplayIssue = { type: string; message: string };
type Verification = {
  issues?: ReplayIssue[];
  explanation?: string;
  awaitingOpponent?: boolean;
  escalatedToHost?: boolean;
  replayValues?: { player1FactionSlug: string | null; player2FactionSlug: string | null; mapName: string | null };
} | null;

const BLIND_PICK_TIMEOUT_SEC = 5 * 60; // Open Play — mirrors blind-pick-auto-resolve.ts

// Card pieces shared by the real card and the preview card, so the preview shows the real thing.
const cardHeader = (opp: string, battleType: string, matchFormat: string | null, series = '') =>
  `⚔️ **Open Play vs ${opp}** · ${BT_LABEL[battleType] ?? battleType} · ${FORMAT_LABEL[matchFormat ?? 'BO1'] ?? 'Bo1'}${series}`;
const PICK_TEXT = 'Pick your faction. It stays hidden until both of you have picked.';
const playText = (mine: string, oppName: string, theirs: string, code: string | null, password: string | null) =>
  `You: **${mine}** vs ${oppName}: **${theirs}**` +
  (code ? `\nLobby: \`${code}\`${password ? ` · password \`${password}\`` : ''}` : `\nNo lobby code yet. One of you hosts and sets it here.`) +
  `\n\nAfter the battle, report the result and attach the replay.`;
/** Lobby + result buttons: `mc_lobby:<match>:<game>` on a real card, `pv_lobby` on the preview. */
const playRow = (ns: 'mc' | 'pv', suffix: string, hasLobby: boolean) =>
  row(btn(hasLobby ? 'Change lobby code' : 'Set lobby code', `${ns}_lobby${suffix}`), btn('I won', `${ns}_won${suffix}`, SUCCESS), btn('They won', `${ns}_lost${suffix}`, SECONDARY));

/** The faction select; two halves when more factions are allowed than Discord's 25 options. */
function factionPickRows(customId: string, allowed: { id: string; name: string }[]): object[] {
  const options = (list: { id: string; name: string }[]) => list.map((f) => ({ label: f.name, value: f.id }));
  if (allowed.length <= 25) return [row(select(customId, options(allowed), 1, 1, 'Pick your faction'))];
  const half = Math.ceil(allowed.length / 2);
  const [a, b] = [allowed.slice(0, half), allowed.slice(half)];
  return [
    row(select(`${customId}:a`, options(a), 1, 1, `Pick your faction (${a[0]!.name[0]}–${a[a.length - 1]!.name[0]})`)),
    row(select(`${customId}:b`, options(b), 1, 1, `Pick your faction (${b[0]!.name[0]}–${b[b.length - 1]!.name[0]})`)),
  ];
}

/** The factions a 1v1 Open Play game of this battle type may pick (the Standard Ruleset's and the match's weekly bans out). */
async function allowedFactions(
  fastify: FastifyInstance,
  battleType: QueueBattleType,
  weeklyBans?: Prisma.JsonValue | null,
): Promise<{ id: string; name: string }[]> {
  const [factions, banned] = await Promise.all([
    fastify.prisma.faction.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    openPlayBannedFactionIds({ tournament_id: null, competitor_format: 'ONE_V_ONE', battle_type: battleType, weekly_bans: weeklyBans }),
  ]);
  const out = new Set(banned);
  return factions.filter((f) => !out.has(f.id));
}

/** "🚫 Weekly bans: Empire (yours), Dwarfs (X's)" for the pick steps; empty when the match has none. */
function weeklyBansLine(bans: WeeklyBan[], viewerId: string, oppName: string, name: (id: string) => string): string {
  if (bans.length === 0) return '';
  return `\n🚫 Weekly bans: ${bans.map((b) => `**${name(b.factionId)}** (${b.userId === viewerId ? 'yours' : `${oppName}'s`})`).join(', ')}`;
}

// ---------------------------------------------------------------------------
// 3×3 matrix on the card (Open Play Bo3 in Land Battle and Conquest, plans/discord-open-play.md §11)
// ---------------------------------------------------------------------------

/** Seconds per strike and for the final pick, then one is made at random (mirrors matrix-auto-resolve.ts). */
const MATRIX_TURN_SEC = 30;
/** Who strikes, by strikes made so far: the coin-toss winner 1, the other 2, the winner 2, the other 2 (faction-matrix.ts). */
const STRIKE_BY_TOP = [true, false, false, true, true, false, false] as const;
const MATRIX_CELLS = ['0,0', '0,1', '0,2', '1,0', '1,1', '1,2', '2,0', '2,1', '2,2'];

const MATRIX_PICK_TEXT =
  'Pick 3 factions. They stay hidden until both of you have picked. Then you take turns striking matchups in a 3×3 grid; ' +
  'when two are left, the coin-toss winner picks the one you play.';

/** The pick-3 select, or a way to the site when Discord's 25 options can't hold the list. */
function matrixPickRows(customId: string, allowed: { id: string; name: string }[], siteLink: string): object[] {
  if (allowed.length > 25) return [row(linkBtn('Pick your three on rizzotto.gg', siteLink))];
  return [row(select(customId, allowed.map((f) => ({ label: f.name, value: f.id })), 3, 3, 'Pick 3 factions'))];
}

interface MatrixGridView {
  mine: string[];
  theirs: string[];
  /** Struck cells as "row,col" in the match's own terms (rows = player 1's three). */
  struck: string[];
  viewerIsP1: boolean;
  iAmTop: boolean;
  oppName: string;
  /** Start of the current turn, for its clock; null shows none (the preview). */
  turnStartedAt: Date | null;
  cellId: (row: number, col: number) => string;
}

/** The grid step: both threes, whose turn it is, and the 9 matchups as buttons with the viewer's three as rows. */
function matrixGrid(v: MatrixGridView, name: (id: string | undefined) => string): { body: string; rows: object[] } {
  const strikes = v.struck.length;
  const isPick = strikes >= 7;
  const topActs = isPick || STRIKE_BY_TOP[strikes]!;
  const myTurn = topActs === v.iAmTop;
  let inARow = 1;
  while (!isPick && strikes + inARow < 7 && STRIKE_BY_TOP[strikes + inARow] === topActs) inARow++;
  const clock = v.turnStartedAt
    ? ` ⏱ <t:${Math.floor(v.turnStartedAt.getTime() / 1000) + MATRIX_TURN_SEC}:R>, then ${isPick ? 'one is picked' : 'one is struck'} at random.`
    : '';
  const turn = isPick
    ? myTurn
      ? `**Your pick:** choose the matchup you play.${clock}`
      : `${v.oppName} picks the matchup you play…`
    : myTurn
      ? `**Your turn:** strike ${inARow === 1 ? 'one matchup' : `${inARow} matchups`}.${clock}`
      : `${v.oppName} is striking…`;
  const coin = v.iAmTop ? 'you strike first and pick the matchup at the end' : `${v.oppName} strikes first and picks the matchup at the end`;
  const body =
    `Your three: ${v.mine.map((f) => `**${name(f)}**`).join(', ')}\n` +
    `${v.oppName}'s three: ${v.theirs.map((f) => `**${name(f)}**`).join(', ')}\n` +
    `🪙 Coin toss: ${coin}.\n\n${turn}`;
  const rows = [0, 1, 2].map((r) =>
    row(
      ...[0, 1, 2].map((c) => {
        const [ar, ac] = v.viewerIsP1 ? [r, c] : [c, r];
        const label = `${name(v.mine[r])} v ${name(v.theirs[c])}`;
        if (v.struck.includes(`${ar},${ac}`)) return btn(`✖ ${label}`.slice(0, 80), v.cellId(ar, ac), SECONDARY, true);
        return btn(label.slice(0, 80), v.cellId(ar, ac), !myTurn ? SECONDARY : isPick ? SUCCESS : DANGER, !myTurn);
      }),
    ),
  );
  return { body, rows };
}

/**
 * One player's match card for a 1v1 Open Play match: opponent, battle type, format, map, game n of N
 * and the actions of the current step. Null for anything that isn't a 1v1 Open Play match.
 */
export async function renderMatchCard(fastify: FastifyInstance, matchId: string, viewerId: string): Promise<DiscordMessage | null> {
  const prisma = fastify.prisma;
  const match = await prisma.match.findFirst({
    where: { id: matchId, type: 'OPEN_PLAY', deleted_at: null },
    select: {
      id: true,
      status: true,
      winner_id: true,
      player1_id: true,
      player2_id: true,
      competitor_format: true,
      match_format: true,
      pick_mode: true,
      weekly_bans: true,
      games: {
        orderBy: { game_number: 'asc' },
        select: {
          id: true,
          game_number: true,
          status: true,
          battle_type: true,
          winner_id: true,
          player1_faction_id: true,
          player2_faction_id: true,
          lobby_code: true,
          lobby_password: true,
          reported_winner_id: true,
          reporter_id: true,
          reported_at: true,
          verification: true,
          map_decision: { select: { picked_map_id: true } },
          blind_pick: true,
          faction_matrix: true,
        },
      },
    },
  });
  if (!match || match.competitor_format !== 'ONE_V_ONE' || !match.player1_id || !match.player2_id) return null;
  const isP1 = match.player1_id === viewerId;
  if (!isP1 && match.player2_id !== viewerId) return null;
  const opponentId = isP1 ? match.player2_id : match.player1_id;

  const [opponent, factions] = await Promise.all([
    prisma.user.findUnique({ where: { id: opponentId }, select: { username: true, discord_id: true } }),
    prisma.faction.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const factionName = (id: string | null | undefined) => (id ? factions.find((f) => f.id === id)?.name ?? id : 'unknown');
  const opp = opponent?.discord_id ? `<@${opponent.discord_id}>` : `**${opponent?.username ?? 'your opponent'}**`;
  const oppName = opponent?.username ?? 'your opponent';

  const games = match.games;
  const current = games.find((g) => g.status !== 'COMPLETED') ?? games[games.length - 1];
  const totalGames = match.match_format === 'BO3' ? 3 : match.match_format === 'BO2' ? 2 : match.match_format === 'BO5' ? 5 : 1;
  const won = games.filter((g) => g.status === 'COMPLETED' && g.winner_id === viewerId).length;
  const lost = games.filter((g) => g.status === 'COMPLETED' && g.winner_id === opponentId).length;
  const battleType = current?.battle_type ?? 'DOMINATION';
  const mapId = current?.map_decision?.picked_map_id ?? null;
  const map = mapId ? await prisma.map.findUnique({ where: { id: mapId }, select: { name: true } }) : null;

  const header = cardHeader(
    opp,
    battleType,
    match.match_format,
    totalGames > 1 ? ` · Game ${current?.game_number ?? 1} of ${totalGames} · ${won}–${lost}` : '',
  );
  const mapLine = map ? `\n🗺️ Map: **${map.name}**` : '';
  const siteLink = linkBtn('Open on rizzotto.gg', `${siteUrl()}/matches/${match.id}`);
  const id = `${match.id}:${current?.game_number ?? 1}`;
  const cancelRow = row(btn('Cancel match', `mc_cancel:${match.id}`, DANGER), siteLink);
  const msg = (body: string, components: object[]): DiscordMessage => ({
    content: `${header}${mapLine}\n\n${body}`,
    components,
    // Lists the opponent so Discord can resolve the mention to his name. Nobody gets pinged: the
    // opponent isn't in this DM.
    allowed_mentions: { parse: [], users: opponent?.discord_id ? [opponent.discord_id] : [] },
  });

  if (match.status === 'CANCELLED') return msg('This match was cancelled.', [row(siteLink)]);
  if (match.status === 'COMPLETED' || match.status === 'FORFEIT' || match.status === 'NO_CONTEST') {
    const result = match.winner_id === viewerId ? `You won ${won}–${lost}. GG!` : match.winner_id === opponentId ? `${oppName} won ${lost}–${won}. GG!` : `It ended ${won}–${lost}. GG!`;
    return msg(`**Match over.** ${result}`, [row(btn('Find another game', 'jp_find', PRIMARY), siteLink)]);
  }
  if (!current) return msg('Getting the match ready…', [cancelRow]);

  const v = current.verification as Verification;
  const bp = current.blind_pick;
  const myFaction = bp ? (isP1 ? bp.player1_faction_id : bp.player2_faction_id) : null;
  const oppFaction = bp ? (isP1 ? bp.player2_faction_id : bp.player1_faction_id) : null;
  const myLock = bp ? (isP1 ? bp.player1_locked_at : bp.player2_locked_at) : null;
  const oppLock = bp ? (isP1 ? bp.player2_locked_at : bp.player1_locked_at) : null;
  const iReported = current.reporter_id === viewerId;
  const reportedWinner = current.reported_winner_id === viewerId ? 'you' : current.reported_winner_id ? oppName : null;

  // Disputed: awaiting the opponent's confirmation of an explained replay, or with a moderator.
  if (current.status === 'DISPUTED') {
    if (v?.awaitingOpponent) {
      if (iReported) {
        return msg(`Waiting for ${oppName} to confirm that your replay is this game.`, [row(btn('Ask a moderator', `mc_esc:${id}`), siteLink)]);
      }
      const rv = v.replayValues;
      const replayLine = rv ? `\nThe replay shows: ${factionName(rv.player1FactionSlug)} vs ${factionName(rv.player2FactionSlug)}${rv.mapName ? ` on ${rv.mapName}` : ''}.` : '';
      const why = v.explanation ? `\n${oppName}: "${v.explanation.slice(0, 300)}"` : '';
      return msg(
        `${oppName} reported that **${reportedWinner}** won game ${current.game_number}, but the replay didn't match the match details. Is this replay your game?${replayLine}${why}`,
        [row(btn('Yes, that was our game', `mc_conf:${id}`, SUCCESS), btn('No, it was not', `mc_rej:${id}`, DANGER)), row(siteLink)],
      );
    }
    return msg(`Game ${current.game_number} is disputed. A moderator will settle it.`, [row(siteLink)]);
  }

  // Reported, held for a replay mismatch: the reporter fixes it; the opponent waits.
  if (current.reported_at && v?.issues?.length && !v.explanation) {
    if (iReported) {
      const issues = v.issues.map((i) => `• ${i.message}`).join('\n').slice(0, 900);
      const side = current.reported_winner_id === viewerId ? 'w' : 'l';
      return msg(
        `Your replay doesn't match your report:\n${issues}\n\nUpload the right replay, or confirm that this one is right (${oppName} will be asked to check it).`,
        [row(btn('Upload another replay', `mc_rep:${id}:${side}`, PRIMARY), btn('This replay is right', `mc_assert:${id}`)), cancelRow],
      );
    }
    return msg(`${oppName} reported game ${current.game_number}, but the replay didn't match. Waiting for them to sort it out.`, [cancelRow]);
  }

  const bansLine = weeklyBansLine(matchWeeklyBans(match.weekly_bans), viewerId, oppName, factionName);
  const isMatrix = match.pick_mode === 'MATRIX';
  const mx = current.faction_matrix;

  if (isMatrix && !mx?.decided_at) {
    // 3×3 matrix: both lock three blind, then strike in turns until the coin-toss winner picks.
    const mine = mx ? (isP1 ? mx.p1_factions : mx.p2_factions) : [];
    if (mx?.revealed_at) {
      const grid = matrixGrid(
        {
          mine,
          theirs: isP1 ? mx.p2_factions : mx.p1_factions,
          struck: mx.bans,
          viewerIsP1: isP1,
          iAmTop: mx.top_player_id === viewerId,
          oppName,
          turnStartedAt: mx.last_action_at,
          cellId: (r, c) => `mc_mx:${id}:${r}:${c}`,
        },
        (f) => factionName(f),
      );
      return msg(grid.body, [...grid.rows, cancelRow]);
    }
    const deadline = mx?.first_locked_at ? Math.floor(mx.first_locked_at.getTime() / 1000) + BLIND_PICK_TIMEOUT_SEC : null;
    if (mx && (isP1 ? mx.p1_locked_at : mx.p2_locked_at)) {
      const wait = deadline ? `\n${oppName} has until <t:${deadline}:R> to pick.` : '';
      return msg(`🔒 Your three: ${mine.map((f) => `**${factionName(f)}**`).join(', ')}. Waiting for ${oppName}…${wait}`, [cancelRow]);
    }
    const timer = deadline ? `\n⏱ ${oppName} has picked. You have until <t:${deadline}:R>, or the match is cancelled.` : '';
    const allowed = await allowedFactions(fastify, battleType, match.weekly_bans);
    return msg(`${MATRIX_PICK_TEXT}${bansLine}${timer}`, [
      ...matrixPickRows(`mc_mx3:${id}`, allowed, `${siteUrl()}/matches/${match.id}/decision`),
      cancelRow,
    ]);
  }

  // Faction pick (blind): both lock, then both are revealed.
  if (!isMatrix && !bp?.revealed_at) {
    if (myLock) {
      const deadline = myLock && !oppLock ? `\n${oppName} has until <t:${Math.floor(myLock.getTime() / 1000) + BLIND_PICK_TIMEOUT_SEC}:R> to pick.` : '';
      return msg(`🔒 You picked **${factionName(myFaction)}**. Waiting for ${oppName}…${deadline}`, [cancelRow]);
    }
    const timer = oppLock ? `\n⏱ ${oppName} has picked. You have until <t:${Math.floor(oppLock.getTime() / 1000) + BLIND_PICK_TIMEOUT_SEC}:R>, or the match is cancelled.` : '';
    return msg(`${PICK_TEXT}${bansLine}${timer}`, [...factionPickRows(`mc_pick:${id}`, await allowedFactions(fastify, battleType, match.weekly_bans)), cancelRow]);
  }

  // Revealed (or the matrix decided), not reported yet: lobby + result. The matrix writes the factions onto the game.
  const [mine, theirs] = isMatrix
    ? isP1
      ? [current.player1_faction_id, current.player2_faction_id]
      : [current.player2_faction_id, current.player1_faction_id]
    : [myFaction, oppFaction];
  return msg(playText(factionName(mine), oppName, factionName(theirs), current.lobby_code, current.lobby_password), [
    playRow('mc', `:${id}`, !!current.lobby_code),
    cancelRow,
  ]);
}

/** Send a NEW match card DM (a new message notifies; edits don't). Stores it for later edits. */
export async function sendMatchCard(fastify: FastifyInstance, matchId: string, userId: string): Promise<StoredMessage | 'closed' | null> {
  const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { discord_id: true } });
  if (!user?.discord_id) return null;
  const card = await renderMatchCard(fastify, matchId, userId);
  if (!card) return null;
  const posted = await postDm(user.discord_id, card);
  if (posted && posted !== 'closed') {
    await fastify.redis?.set(CARD_KEY(matchId, userId), JSON.stringify({ ...posted, hash: hashOf(card) }), 'EX', CARD_TTL);
  }
  return posted;
}

/**
 * Match found (1v1): send each player who may use Discord Open Play (everyone once live, testers
 * before) his match card, and turn a join DM that still says "in the queue" into a pointer to it.
 * Returns the Discord ids that were handled; the caller sends the classic match-found DM to the
 * rest (no bot, 2v2, not a tester, card refused).
 */
export async function sendMatchCards(fastify: FastifyInstance, matchId: string): Promise<string[]> {
  if (!isBotConfigured()) return [];
  const match = await fastify.prisma.match.findUnique({ where: { id: matchId }, select: { player1_id: true, player2_id: true, competitor_format: true } });
  if (!match?.player1_id || !match.player2_id || match.competitor_format !== 'ONE_V_ONE') return [];
  const players = await fastify.prisma.user.findMany({ where: { id: { in: [match.player1_id, match.player2_id] } }, select: { id: true, discord_id: true } });
  const handled: string[] = [];
  await Promise.allSettled(
    players.map(async (p) => {
      if (!p.discord_id || !(await areOpenPlayTesters(fastify, [p.discord_id]))) return;
      // DMs closed counts as handled: the classic DM would bounce the same way.
      if (!(await sendMatchCard(fastify, matchId, p.id))) return;
      handled.push(p.discord_id);
      await refreshJoinDm(fastify, p.id, '✅ Match found. Your match card is the message below.');
    }),
  );
  return handled;
}

/** Re-render both players' cards in place where they changed. Best-effort, never throws. */
export async function refreshMatchCards(fastify: FastifyInstance, matchId: string): Promise<void> {
  try {
    if (!fastify.redis || !isBotConfigured()) return;
    const match = await fastify.prisma.match.findUnique({ where: { id: matchId }, select: { player1_id: true, player2_id: true } });
    for (const uid of [match?.player1_id, match?.player2_id]) {
      if (!uid) continue;
      const raw = await fastify.redis.get(CARD_KEY(matchId, uid));
      if (!raw) continue;
      const stored = JSON.parse(raw) as StoredMessage;
      const card = await renderMatchCard(fastify, matchId, uid);
      if (!card) continue;
      const hash = hashOf(card);
      if (hash === stored.hash) continue;
      const res = await discordRequest('PATCH', `/channels/${stored.channelId}/messages/${stored.messageId}`, card);
      if (res.ok) await fastify.redis.set(CARD_KEY(matchId, uid), JSON.stringify({ ...stored, hash }), 'EX', CARD_TTL);
    }
  } catch (err) {
    fastify.log.warn({ err, matchId }, '[discord-open-play] refreshMatchCards failed (non-fatal)');
  }
}

/** Mark a card as already showing `card` (after the interaction response itself edited it). */
export async function rememberCardRender(fastify: FastifyInstance, matchId: string, userId: string, channelId: string, messageId: string, card: DiscordMessage): Promise<void> {
  await fastify.redis?.set(CARD_KEY(matchId, userId), JSON.stringify({ channelId, messageId, hash: hashOf(card) }), 'EX', CARD_TTL);
}

/** Per-minute reconcile: every active 1v1 Open Play match with a card gets re-rendered if it changed. */
export async function reconcileMatchCards(fastify: FastifyInstance): Promise<void> {
  if (!fastify.redis || !isBotConfigured()) return;
  const since = new Date(Date.now() - CARD_TTL * 1000);
  const matches = await fastify.prisma.match.findMany({
    where: {
      type: 'OPEN_PLAY',
      competitor_format: 'ONE_V_ONE',
      deleted_at: null,
      OR: [{ status: { in: ['ONGOING', 'AWAITING_CONFIRMATION', 'DISPUTED'] } }, { updated_at: { gte: new Date(Date.now() - 10 * 60_000) } }],
      created_at: { gte: since },
    },
    select: { id: true },
  });
  for (const m of matches) await refreshMatchCards(fastify, m.id);
}

// ---------------------------------------------------------------------------
// Preview card (Admin → Discord Open Play → "Send me a preview card")
// ---------------------------------------------------------------------------

/**
 * A match card against nobody, to see and click through every step before the cards go out to
 * everyone: faction pick, lobby code, result with the replay upload (the replay is read like on the
 * site), match over. It touches no match, queue or stats; its state lives in Redis.
 */
const PREVIEW_KEY = (userId: string) => `rizzotto:dop:preview:${userId}`;
const PREVIEW_TTL = 24 * 3600;
const PREVIEW_RIVAL = 'RizzBOTto';

export interface PreviewState {
  battleType: QueueBattleType;
  mapName: string | null;
  myFaction?: string;
  rivalFaction?: string;
  lobbyCode?: string | null;
  lobbyPassword?: string | null;
  result?: 'w' | 'l';
  /** What the uploaded replay showed, for the "match over" step. */
  replay?: string;
  /** The 3×3 matrix variant (a Bo3 in Land Battle or Conquest), with the player as player 1. */
  variant?: 'matrix';
  /** Matrix variant: both threes, the struck cells ("row,col", rows = the player's three) and the coin toss. */
  mx?: { mine: string[]; theirs: string[]; struck: string[]; iAmTop: boolean };
}

export async function getPreviewState(fastify: FastifyInstance, userId: string): Promise<PreviewState | null> {
  const raw = await fastify.redis?.get(PREVIEW_KEY(userId));
  return raw ? (JSON.parse(raw) as PreviewState) : null;
}

/** Store the preview's new state and render it. */
export async function savePreviewState(fastify: FastifyInstance, userId: string, s: PreviewState): Promise<DiscordMessage> {
  await fastify.redis?.set(PREVIEW_KEY(userId), JSON.stringify(s), 'EX', PREVIEW_TTL);
  return renderPreviewCard(fastify, s);
}

/** A fresh preview on a random map, nothing picked yet: the queue's first battle type, or Conquest for the matrix. */
async function newPreviewState(fastify: FastifyInstance, variant?: 'matrix'): Promise<PreviewState> {
  const battleType: QueueBattleType = variant === 'matrix' ? 'CONQUEST' : ALL_BATTLE_TYPES[0]!;
  const maps = await fastify.prisma.map.findMany({ where: { battle_type: battleType, available: true, deleted_at: null }, select: { name: true } });
  return { battleType, mapName: maps.length ? maps[Math.floor(Math.random() * maps.length)]!.name : null, ...(variant ? { variant } : {}) };
}

/** Matrix preview: the matchup in a cell becomes the factions both play. */
function pickPreviewCell(s: PreviewState, cell: string): PreviewState {
  const [r, c] = cell.split(',').map(Number);
  return { ...s, myFaction: s.mx!.mine[r!], rivalFaction: s.mx!.theirs[c!] };
}

/** Matrix preview: RizzBOTto strikes while it is his turn, and picks at the end when he won the coin toss. */
function previewBotTurns(s: PreviewState): PreviewState {
  let mx = s.mx!;
  for (;;) {
    const strikes = mx.struck.length;
    if ((strikes >= 7 || STRIKE_BY_TOP[strikes]!) === mx.iAmTop) return { ...s, mx };
    const open = MATRIX_CELLS.filter((cell) => !mx.struck.includes(cell));
    const cell = open[Math.floor(Math.random() * open.length)]!;
    if (strikes >= 7) return pickPreviewCell({ ...s, mx }, cell);
    mx = { ...mx, struck: [...mx.struck, cell] };
  }
}

/** Matrix preview: the player locked three; RizzBOTto names three at random, the coin is tossed. */
export async function lockPreviewThree(fastify: FastifyInstance, userId: string, s: PreviewState, three: string[]): Promise<DiscordMessage> {
  const pool = (await allowedFactions(fastify, s.battleType)).map((f) => f.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const next = previewBotTurns({ ...s, mx: { mine: three, theirs: pool.slice(0, 3), struck: [], iAmTop: Math.random() < 0.5 } });
  return savePreviewState(fastify, userId, next);
}

/** Matrix preview: the player struck (or, last, picked) a cell; RizzBOTto takes his turns at once. */
export async function strikePreviewCell(fastify: FastifyInstance, userId: string, s: PreviewState, cell: string): Promise<DiscordMessage> {
  const mx = s.mx;
  if (!mx || s.myFaction || !MATRIX_CELLS.includes(cell) || mx.struck.includes(cell)) return renderPreviewCard(fastify, s);
  const strikes = mx.struck.length;
  if ((strikes >= 7 || STRIKE_BY_TOP[strikes]!) !== mx.iAmTop) return renderPreviewCard(fastify, s);
  const next = strikes >= 7 ? pickPreviewCell(s, cell) : previewBotTurns({ ...s, mx: { ...mx, struck: [...mx.struck, cell] } });
  return savePreviewState(fastify, userId, next);
}

/** The player picked: RizzBOTto picks at once (any allowed faction), and both are revealed. */
export async function pickPreviewFactions(fastify: FastifyInstance, userId: string, s: PreviewState, factionId: string): Promise<DiscordMessage> {
  const allowed = await allowedFactions(fastify, s.battleType);
  const rival = allowed[Math.floor(Math.random() * allowed.length)]?.id;
  return savePreviewState(fastify, userId, { ...s, myFaction: factionId, rivalFaction: rival });
}

export async function restartPreview(fastify: FastifyInstance, userId: string, variant?: 'matrix'): Promise<DiscordMessage> {
  return savePreviewState(fastify, userId, await newPreviewState(fastify, variant));
}

/** One line on what a replay file shows: players with their factions, map, when it was recorded. */
export async function describeReplay(fastify: FastifyInstance, file: Buffer): Promise<string> {
  const meta = parseReplayMeta(file);
  if (meta.players.length === 0) return 'No players could be read from this file. On a real card the replay check would flag it.';
  const factions = await fastify.prisma.faction.findMany({ select: { id: true, name: true } });
  const faction = (id: string | null) => (id ? factions.find((f) => f.id === id)?.name ?? id : 'unknown faction');
  const players = meta.players.map((p) => `**${p.name}** (${faction(p.faction)})`).join(' vs ');
  const map = mapNameFromTerrain(meta.mapTerrain);
  const when = meta.recordedAt ? `, recorded <t:${Math.floor(meta.recordedAt.getTime() / 1000)}:f>` : '';
  return `Read from your replay: ${players}${map ? ` on **${map}**` : ''}${when}.`;
}

export async function renderPreviewCard(fastify: FastifyInstance, s: PreviewState): Promise<DiscordMessage> {
  const isMatrix = s.variant === 'matrix';
  const header =
    `-# 🧪 Preview: not a real match. ${PREVIEW_RIVAL} plays the other side.\n` +
    (isMatrix ? cardHeader(`**${PREVIEW_RIVAL}**`, s.battleType, 'BO3', ' · Game 1 of 3 · 0–0') : cardHeader(`**${PREVIEW_RIVAL}**`, s.battleType, 'BO1'));
  const mapLine = s.mapName ? `\n🗺️ Map: **${s.mapName}**` : '';
  const siteLink = linkBtn('Open on rizzotto.gg', `${siteUrl()}/open-play`);
  const cancelRow = row(btn('Cancel match', 'pv_cancel', DANGER), siteLink);
  const msg = (body: string, components: object[]): DiscordMessage => ({ content: `${header}${mapLine}\n\n${body}`, components, allowed_mentions: noMentions });

  if (s.result) {
    const result = isMatrix
      ? '**Game 1 reported.** In a real Bo3 the card now moves on to game 2, with a new map and a new matrix.'
      : `**Match over.** ${s.result === 'w' ? 'You won 1–0. GG!' : `${PREVIEW_RIVAL} won 1–0. GG!`}`;
    return msg(`${result}${s.replay ? `\n\n${s.replay}` : ''}`, [
      row(btn('Find another game', 'jp_find', PRIMARY), btn('Start the preview again', 'pv_again'), siteLink),
    ]);
  }
  if (isMatrix && !s.myFaction) {
    if (!s.mx) return msg(MATRIX_PICK_TEXT, [...matrixPickRows('pv_mx3', await allowedFactions(fastify, s.battleType), `${siteUrl()}/open-play`), cancelRow]);
    const ids = [...s.mx.mine, ...s.mx.theirs];
    const names = await fastify.prisma.faction.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const grid = matrixGrid(
      { ...s.mx, viewerIsP1: true, oppName: PREVIEW_RIVAL, turnStartedAt: null, cellId: (r, c) => `pv_mx:${r}:${c}` },
      (id) => names.find((f) => f.id === id)?.name ?? 'unknown',
    );
    return msg(grid.body, [...grid.rows, cancelRow]);
  }
  if (!s.myFaction) return msg(PICK_TEXT, [...factionPickRows('pv_pick', await allowedFactions(fastify, s.battleType)), cancelRow]);
  const factions = await fastify.prisma.faction.findMany({ where: { id: { in: [s.myFaction, s.rivalFaction ?? ''] } }, select: { id: true, name: true } });
  const name = (id?: string) => factions.find((f) => f.id === id)?.name ?? 'unknown';
  return msg(playText(name(s.myFaction), PREVIEW_RIVAL, name(s.rivalFaction), s.lobbyCode ?? null, s.lobbyPassword ?? null), [
    playRow('pv', '', !!s.lobbyCode),
    cancelRow,
  ]);
}

/** DM a fresh preview card to a player (an admin, from the admin panel). */
export async function sendPreviewCard(
  fastify: FastifyInstance,
  user: { id: string; discord_id: string },
  variant?: 'matrix',
): Promise<'sent' | 'closed' | 'failed'> {
  if (!isBotConfigured() || !fastify.redis) return 'failed';
  const posted = await postDm(user.discord_id, await restartPreview(fastify, user.id, variant));
  return posted === 'closed' ? 'closed' : posted ? 'sent' : 'failed';
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

/** One button per (battle type × series length) the waiting entry plays. Siege is always Bo2. */
export function tickerOffers(prefs: QueuePrefs): QueueOffer[] {
  const size: 1 | 2 = prefs.format === 'TWO_V_TWO' ? 2 : 1;
  const out: QueueOffer[] = [];
  for (const battleType of prefs.battleTypes as QueueBattleType[]) {
    const formats: ('BO1' | 'BO2' | 'BO3')[] = battleType === 'SIEGE' ? ['BO2'] : (prefs.matchFormats as QueueMatchFormat[]);
    for (const matchFormat of formats) out.push({ battleType, size, matchFormat });
  }
  return out.slice(0, 25);
}

export function renderTickerPost(prefs: QueuePrefs, pingRoleId?: string | null): DiscordMessage {
  const offers = tickerOffers(prefs);
  const rows: object[] = [];
  for (let i = 0; i < offers.length; i += 5) {
    rows.push(row(...offers.slice(i, i + 5).map((o) => btn(`${BT_LABEL[o.battleType] ?? o.battleType} ${FORMAT_LABEL[o.matchFormat]}`, `tk:${encodeOffer(o)}`, PRIMARY))));
  }
  const ping = pingRoleId ? `<@&${pingRoleId}> ` : '';
  return {
    content: `${ping}🎯 **Someone is looking for a ${sizeLabel(prefs.format)} game:** ${describePrefs(prefs)}\nClick what you want to play to take the match.`,
    components: rows,
    allowed_mentions: pingRoleId ? { parse: [], roles: [pingRoleId] } : noMentions,
  };
}

interface TickerState {
  posts: { channelId: string; messageId: string }[];
  /** When the request was posted: a match created after it means the request was taken. */
  postedAt?: number;
  /** "Land Battle, Siege · Bo1 · 1v1", for the closed line. */
  summary?: string;
}

interface ClosedTickerPost {
  queueId: string;
  matched: boolean;
  deleteAt: number;
}

/**
 * How a request ended: "Matched" with who plays what, or a quiet "no longer looking". The names
 * only show once matched (so the two can find each other); an open or abandoned request stays
 * anonymous. The names are mentions, but in an edit, which Discord never notifies.
 */
async function renderClosedTickerPost(
  fastify: FastifyInstance,
  queueId: string,
  s: TickerState,
): Promise<{ message: DiscordMessage; matched: boolean }> {
  const match = await fastify.prisma.match.findFirst({
    where: {
      type: 'OPEN_PLAY',
      deleted_at: null,
      created_at: { gte: new Date(s.postedAt ?? Date.now() - TICKER_CLOSED_TTL_MS) },
      OR: [{ player1_id: queueId }, { player2_id: queueId }],
    },
    orderBy: { created_at: 'desc' },
    select: {
      created_at: true,
      player1_id: true,
      player2_id: true,
      match_format: true,
      competitor_format: true,
      games: { where: { game_number: 1 }, select: { battle_type: true } },
    },
  });
  if (!match) {
    return { matched: false, message: { content: `-# No longer looking${s.summary ? ` · ${s.summary}` : ''}`, components: [], allowed_mentions: noMentions } };
  }
  const sides = [match.player1_id, match.player2_id].filter((id): id is string => !!id);
  // 1v1: the players (as mentions when they have Discord); 2v2: the team names.
  const named =
    match.competitor_format === 'TWO_V_TWO'
      ? (await fastify.prisma.team.findMany({ where: { id: { in: sides } }, select: { id: true, name: true } })).map((t) => ({ id: t.id, label: `**${t.name}**`, discordId: null }))
      : (await fastify.prisma.user.findMany({ where: { id: { in: sides } }, select: { id: true, username: true, discord_id: true } })).map((u) => ({
          id: u.id,
          label: u.discord_id ? `<@${u.discord_id}>` : `**${u.username}**`,
          discordId: u.discord_id,
        }));
  const who = sides.map((id) => named.find((n) => n.id === id)?.label).filter(Boolean).join(' vs ');
  const battleType = match.games[0]?.battle_type;
  const what = [battleType ? (BT_LABEL[battleType] ?? battleType) : null, FORMAT_LABEL[match.match_format ?? 'BO1'], sizeLabel(match.competitor_format)];
  return {
    matched: true,
    message: {
      content: `⚔️ **Matched:** ${who ? `${who} · ` : ''}${what.filter(Boolean).join(' · ')} · <t:${Math.floor(match.created_at.getTime() / 1000)}:R>`,
      components: [],
      allowed_mentions: { parse: [], users: named.map((n) => n.discordId).filter((id): id is string => !!id) },
    },
  };
}

let tickerRunning = false;

/**
 * Make every configured ticker channel show the open queue entries: post the new ones, and turn the
 * ones that closed into one line (matched, or no longer looking) that the bot deletes after 15
 * minutes. So whoever follows a ping still sees what happened, while the channel stays short and
 * the pinned panel stays in view. A player who queues again loses his "no longer looking" lines at
 * once. Also keeps the panels' live line current. Called after every tick and leave, and each
 * minute; a reconcile, so no queue path needs its own hook.
 */
export async function syncTicker(fastify: FastifyInstance): Promise<void> {
  const redis = fastify.redis;
  if (!redis || !isBotConfigured() || tickerRunning) return;
  tickerRunning = true;
  try {
    const guilds = await getOpenPlayGuilds(fastify);
    const ids = await redis.lrange(QUEUE_KEY, 0, -1);
    const open = new Set(ids);
    const state = await redis.hgetall(TICKER_KEY);
    const now = Date.now();

    for (const [queueId, raw] of Object.entries(state)) {
      if (open.has(queueId)) continue;
      const s = JSON.parse(raw) as TickerState;
      const closed = await renderClosedTickerPost(fastify, queueId, s);
      for (const p of s.posts) {
        await discordRequest('PATCH', `/channels/${p.channelId}/messages/${p.messageId}`, closed.message).catch(() => null);
        const entry: ClosedTickerPost = { queueId, matched: closed.matched, deleteAt: now + TICKER_CLOSED_TTL_MS };
        await redis.hset(TICKER_CLOSED_KEY, `${p.channelId}/${p.messageId}`, JSON.stringify(entry));
      }
      await redis.hdel(TICKER_KEY, queueId);
    }

    for (const [key, raw] of Object.entries(await redis.hgetall(TICKER_CLOSED_KEY))) {
      const c = JSON.parse(raw) as ClosedTickerPost;
      if (c.deleteAt > now && (c.matched || !open.has(c.queueId))) continue;
      const [channelId, messageId] = key.split('/');
      await discordRequest('DELETE', `/channels/${channelId}/messages/${messageId}`).catch(() => null);
      await redis.hdel(TICKER_CLOSED_KEY, key);
    }

    for (const queueId of guilds.length > 0 ? ids : []) {
      if (state[queueId]) continue;
      const prefs = parseQueuePrefs(await redis.hget(QUEUE_PREFS_KEY, queueId));
      const posts: TickerState['posts'] = [];
      for (const g of guilds) {
        // The role ping goes out at most once per few minutes per server.
        const ping = g.pingRoleId ? (await redis.set(PING_KEY(g.guildId), '1', 'EX', PING_GAP_SEC, 'NX')) === 'OK' : false;
        const messageId = await postMessage(g.tickerChannelId, renderTickerPost(prefs, ping ? g.pingRoleId : null));
        if (messageId) posts.push({ channelId: g.tickerChannelId, messageId });
      }
      await redis.hset(TICKER_KEY, queueId, JSON.stringify({ posts, postedAt: now, summary: describePrefs(prefs) } satisfies TickerState));
    }

    await refreshPanels(fastify, guilds, ids.length);
  } catch (err) {
    fastify.log.warn({ err }, '[discord-open-play] syncTicker failed (non-fatal)');
  } finally {
    tickerRunning = false;
  }
}

interface PanelStats {
  matchesToday: number;
  queued: number;
}

/** The pinned panel in a ticker channel: how to join, a "Find a game" button and a live line. */
export function renderJoinPanel(stats?: PanelStats): DiscordMessage {
  const live = stats
    ? `\n\n📊 Today: **${stats.matchesToday}** ${stats.matchesToday === 1 ? 'match' : 'matches'} · **${stats.queued}** in the queue right now`
    : '';
  return {
    content:
      `**Find an Open Play game**\nType \`/join\` anywhere on this server, or press the button. RizzBOTto sends you a DM where you ` +
      `pick battle types, Bo1/Bo3 and team size, then you play the whole match in that DM or on rizzotto.gg.\n` +
      `Open requests show up in this channel. Click one to take the match.${live}`,
    components: [row(btn('Find a game', 'jp_find', PRIMARY), linkBtn('How Open Play works', `${siteUrl()}/how-to-play#discord`))],
    allowed_mentions: noMentions,
  };
}

/** The posted panel per server (guildId → message), so its live line can be kept current. */
export const PANELS_CONFIG_KEY = 'discord_open_play_panels';
type PanelRefs = Record<string, { channelId: string; messageId: string }>;

async function getPanels(fastify: FastifyInstance): Promise<PanelRefs> {
  const row = await fastify.prisma.adminConfig.findUnique({ where: { key: PANELS_CONFIG_KEY } });
  const value = row?.value as unknown;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PanelRefs) : {};
}

async function panelStats(fastify: FastifyInstance, queued: number): Promise<PanelStats> {
  const matchesToday = await fastify.prisma.match.count({
    where: { type: 'OPEN_PLAY', deleted_at: null, status: { not: 'CANCELLED' }, created_at: { gte: startOfSiteDay(new Date()) } },
  });
  return { matchesToday, queued };
}

/** Post the panel in a server's ticker channel, replacing the one posted there before. */
export async function postJoinPanel(fastify: FastifyInstance, guild: OpenPlayGuild): Promise<string | null> {
  const queued = fastify.redis ? await fastify.redis.llen(QUEUE_KEY) : 0;
  const messageId = await postMessage(guild.tickerChannelId, renderJoinPanel(await panelStats(fastify, queued)));
  if (!messageId) return null;
  const panels = await getPanels(fastify);
  const previous = panels[guild.guildId];
  if (previous) await discordRequest('DELETE', `/channels/${previous.channelId}/messages/${previous.messageId}`).catch(() => null);
  panels[guild.guildId] = { channelId: guild.tickerChannelId, messageId };
  await fastify.prisma.adminConfig.upsert({
    where: { key: PANELS_CONFIG_KEY },
    create: { key: PANELS_CONFIG_KEY, value: panels as never },
    update: { value: panels as never },
  });
  await fastify.redis?.del(PANEL_HASH_KEY(guild.guildId));
  return messageId;
}

/** Edit each configured server's panel when its live line changed (edits don't notify anyone). */
async function refreshPanels(fastify: FastifyInstance, guilds: OpenPlayGuild[], queued: number): Promise<void> {
  const panels = await getPanels(fastify);
  const targets = guilds.filter((g) => panels[g.guildId]);
  if (targets.length === 0 || !fastify.redis) return;
  const panel = renderJoinPanel(await panelStats(fastify, queued));
  const hash = hashOf(panel);
  for (const g of targets) {
    if ((await fastify.redis.get(PANEL_HASH_KEY(g.guildId))) === hash) continue;
    const ref = panels[g.guildId]!;
    const res = await discordRequest('PATCH', `/channels/${ref.channelId}/messages/${ref.messageId}`, panel);
    if (res.ok) await fastify.redis.set(PANEL_HASH_KEY(g.guildId), hash, 'EX', 24 * 3600);
  }
}

// ---------------------------------------------------------------------------
// Registration (setup) + pending join
// ---------------------------------------------------------------------------

export function renderSetupPrompt(reason: 'account' | 'steam'): DiscordMessage {
  const what = reason === 'account' ? 'log in with Discord and connect Steam' : 'connect your Steam account';
  return {
    content: `To play Open Play you need an account on rizzotto.gg first: ${what} (one-time, about a minute). When you're done, your queue settings come to your DMs.`,
    components: [row(linkBtn('Set up on rizzotto.gg', `${siteUrl()}/login`))],
    allowed_mentions: noMentions,
  };
}

export async function rememberPendingJoin(fastify: FastifyInstance, discordId: string): Promise<void> {
  await fastify.redis?.set(PENDING_JOIN_KEY(discordId), '1', 'EX', PENDING_TTL);
}

/** Steam just got linked: if the player came from `/join`, send his join DM now. */
export async function onSteamLinked(fastify: FastifyInstance, userId: string): Promise<void> {
  try {
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true, discord_id: true } });
    if (!user?.discord_id || !fastify.redis) return;
    if ((await fastify.redis.del(PENDING_JOIN_KEY(user.discord_id))) !== 1) return;
    await sendJoinDm(fastify, { id: user.id, discord_id: user.discord_id });
  } catch (err) {
    fastify.log.warn({ err, userId }, '[discord-open-play] pending join DM failed (non-fatal)');
  }
}

// ---------------------------------------------------------------------------
// /join command registration
// ---------------------------------------------------------------------------

/**
 * Register the global `/join` command (bulk overwrite, idempotent; on boot and when the rollout
 * changes). Before go-live it is limited to server admins (default_member_permissions "0"; they
 * can open it to a role or channel under Server Settings → Integrations) and to servers, so nobody
 * else sees it. Returns null when done, else Discord's reason (shown in the admin panel).
 */
export async function registerDiscordCommands(fastify: FastifyInstance): Promise<string | null> {
  if (!isBotConfigured()) return 'The Discord bot is not configured';
  const failed = async (res: Response) => {
    const error = `Discord ${res.status}: ${(await res.text()).slice(0, 300)}`;
    fastify.log.warn({ error }, '[discord-open-play] command registration failed');
    return error;
  };
  try {
    // The bot token's own application: the login app (DISCORD_CLIENT_ID) need not be the bot's.
    const appRes = await discordRequest('GET', '/applications/@me');
    if (!appRes.ok) return failed(appRes);
    const appId = ((await appRes.json()) as { id: string }).id;
    const { live } = await getOpenPlayRollout(fastify);
    const res = await discordRequest('PUT', `/applications/${appId}/commands`, [
      {
        name: 'join',
        type: 1,
        description: 'Find an Open Play game: set up your queue in a DM',
        contexts: live ? [0, 1] : [0],
        integration_types: [0],
        default_member_permissions: live ? null : '0',
      },
    ]);
    return res.ok ? null : failed(res);
  } catch (err) {
    fastify.log.warn({ err }, '[discord-open-play] command registration failed (non-fatal)');
    return err instanceof Error ? err.message : 'Command registration failed';
  }
}

// ---------------------------------------------------------------------------
// Calling the site's routes as the player
// ---------------------------------------------------------------------------

/**
 * Run one of the site's own routes as `userId` (a short-lived token for him), so a Discord action
 * goes through exactly the checks and side effects of the same action on the site.
 */
export async function callAsUser(
  fastify: FastifyInstance,
  userId: string,
  opts: { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown; headers?: Record<string, string> },
): Promise<{ statusCode: number; json: () => Record<string, unknown> }> {
  const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user) return { statusCode: 401, json: () => ({ message: 'Unknown player' }) };
  // Always a player's rights: a DM action is a player action, even when the player is staff.
  const token = fastify.jwt.sign({ sub: userId, username: user.username, role: 'USER' } as never, { expiresIn: '2m' });
  const res = await fastify.inject({
    method: opts.method,
    url: opts.url,
    payload: opts.payload as never,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  return {
    statusCode: res.statusCode,
    json: () => {
      try {
        return res.json() as Record<string, unknown>;
      } catch {
        return {};
      }
    },
  };
}

/** A multipart body with the winner field first, then the replay file (the order the route reads). */
export function replayMultipart(winnerId: string, filename: string, file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----rizzotto${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="winner_id"\r\n\r\n${winnerId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="replay"; filename="${filename.replace(/["\r\n]/g, '_')}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

// Modals -----------------------------------------------------------------------------------------

export function lobbyModal(matchId: string, gameNumber: number, code: string | null, password: string | null) {
  return {
    custom_id: `mc_lobbyset:${matchId}:${gameNumber}`,
    title: `Lobby for game ${gameNumber}`,
    components: [
      { type: LABEL, label: 'Lobby code', component: { type: TEXT_INPUT, custom_id: 'code', style: 1, required: true, max_length: 64, ...(code ? { value: code } : {}) } },
      { type: LABEL, label: 'Password (optional)', component: { type: TEXT_INPUT, custom_id: 'password', style: 1, required: false, max_length: 64, ...(password ? { value: password } : {}) } },
    ],
  };
}

export function reportModal(matchId: string, gameNumber: number, side: 'w' | 'l') {
  return {
    custom_id: `mc_report:${matchId}:${gameNumber}:${side}`,
    title: side === 'w' ? `Game ${gameNumber}: you won` : `Game ${gameNumber}: they won`,
    components: [
      {
        type: LABEL,
        label: 'Replay file (.replay)',
        description: 'Saved in %APPDATA%\\The Creative Assembly\\Warhammer3\\replays',
        component: { type: FILE_UPLOAD, custom_id: 'replay', min_values: 1, max_values: 1, required: true },
      },
    ],
  };
}
