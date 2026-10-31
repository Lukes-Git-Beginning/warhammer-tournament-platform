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
import { openPlayBannedFactionIds } from './standard-ruleset.js';

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
const PING_KEY = (guildId: string) => `rizzotto:dop:ping:${guildId}`;
export const PENDING_JOIN_KEY = (discordId: string) => `rizzotto:dop:pending:${discordId}`;

const JOIN_DM_TTL = 24 * 3600;
const CARD_TTL = 7 * 24 * 3600;
const PING_GAP_SEC = 5 * 60;
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

export async function getOpenPlayGuilds(fastify: FastifyInstance): Promise<OpenPlayGuild[]> {
  const row = await fastify.prisma.adminConfig.findUnique({ where: { key: GUILDS_CONFIG_KEY } });
  const value = row?.value as unknown;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is OpenPlayGuild =>
      !!g && typeof g === 'object' && typeof (g as OpenPlayGuild).guildId === 'string' && typeof (g as OpenPlayGuild).tickerChannelId === 'string',
  );
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
export async function renderJoinDm(fastify: FastifyInstance, userId: string, note?: string): Promise<DiscordMessage> {
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
  const cannot2v2 = is2v2 && teams.length === 0;
  components.push(row(btn('Join queue', 'oq_join', SUCCESS, cannot2v2), openPlayLink));

  const teamLine = is2v2 && team ? `\nTeam: **${team.name}**` : '';
  const blockLine = cannot2v2 ? '\n\nFor 2v2 you need to be the captain of an active team with two members.' : '';
  return {
    content:
      `**Find an Open Play game**\nPick what you want to play, then join the queue. Your choice is saved, like on the Open Play page. ` +
      `Siege is always Bo2.${teamLine}${blockLine}${noteLine}`,
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
      games: {
        orderBy: { game_number: 'asc' },
        select: {
          id: true,
          game_number: true,
          status: true,
          battle_type: true,
          winner_id: true,
          lobby_code: true,
          lobby_password: true,
          reported_winner_id: true,
          reporter_id: true,
          reported_at: true,
          verification: true,
          map_decision: { select: { picked_map_id: true } },
          blind_pick: true,
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

  const header =
    `⚔️ **Open Play vs ${opp}** · ${BT_LABEL[battleType] ?? battleType} · ${FORMAT_LABEL[match.match_format ?? 'BO1'] ?? 'Bo1'}` +
    (totalGames > 1 ? ` · Game ${current?.game_number ?? 1} of ${totalGames} · ${won}–${lost}` : '');
  const mapLine = map ? `\n🗺️ Map: **${map.name}**` : '';
  const siteLink = linkBtn('Open on rizzotto.gg', `${siteUrl()}/matches/${match.id}`);
  const id = `${match.id}:${current?.game_number ?? 1}`;
  const cancelRow = row(btn('Cancel match', `mc_cancel:${match.id}`, DANGER), siteLink);
  const msg = (body: string, components: object[]): DiscordMessage => ({
    content: `${header}${mapLine}\n\n${body}`,
    components,
    allowed_mentions: noMentions,
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

  // Faction pick (blind): both lock, then both are revealed.
  if (!bp?.revealed_at) {
    if (myLock) {
      const deadline = myLock && !oppLock ? `\n${oppName} has until <t:${Math.floor(myLock.getTime() / 1000) + BLIND_PICK_TIMEOUT_SEC}:R> to pick.` : '';
      return msg(`🔒 You picked **${factionName(myFaction)}**. Waiting for ${oppName}…${deadline}`, [cancelRow]);
    }
    const banned = new Set(await openPlayBannedFactionIds({ tournament_id: null, competitor_format: 'ONE_V_ONE', battle_type: battleType }));
    const allowed = factions.filter((f) => !banned.has(f.id));
    const timer = oppLock ? `\n⏱ ${oppName} has picked. You have until <t:${Math.floor(oppLock.getTime() / 1000) + BLIND_PICK_TIMEOUT_SEC}:R>, or the match is cancelled.` : '';
    const pickRows =
      allowed.length <= 25
        ? [row(select(`mc_pick:${id}`, allowed.map((f) => ({ label: f.name, value: f.id })), 1, 1, 'Pick your faction'))]
        : [
            row(select(`mc_pick:${id}:a`, allowed.slice(0, Math.ceil(allowed.length / 2)).map((f) => ({ label: f.name, value: f.id })), 1, 1, `Pick your faction (${allowed[0]!.name[0]}–${allowed[Math.ceil(allowed.length / 2) - 1]!.name[0]})`)),
            row(select(`mc_pick:${id}:b`, allowed.slice(Math.ceil(allowed.length / 2)).map((f) => ({ label: f.name, value: f.id })), 1, 1, `Pick your faction (${allowed[Math.ceil(allowed.length / 2)]!.name[0]}–${allowed[allowed.length - 1]!.name[0]})`)),
          ];
    return msg(`Pick your faction. It stays hidden until both of you have picked.${timer}`, [...pickRows, cancelRow]);
  }

  // Revealed, not reported yet: lobby + result.
  const lobby = current.lobby_code
    ? `\nLobby: \`${current.lobby_code}\`${current.lobby_password ? ` · password \`${current.lobby_password}\`` : ''}`
    : `\nNo lobby code yet. One of you hosts and sets it here.`;
  return msg(
    `You: **${factionName(myFaction)}** vs ${oppName}: **${factionName(oppFaction)}**${lobby}\n\nAfter the battle, report the result and attach the replay.`,
    [
      row(btn(current.lobby_code ? 'Change lobby code' : 'Set lobby code', `mc_lobby:${id}`), btn('I won', `mc_won:${id}`, SUCCESS), btn('They won', `mc_lost:${id}`, SECONDARY)),
      cancelRow,
    ],
  );
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
 * Match found (1v1): send both players their match card, and turn a join DM that still says
 * "in the queue" into a pointer to it. Returns false when the cards can't replace the old DM
 * (no bot, 2v2), so the caller sends the classic match-found DM instead.
 */
export async function sendMatchCards(fastify: FastifyInstance, matchId: string): Promise<boolean> {
  if (!isBotConfigured()) return false;
  const match = await fastify.prisma.match.findUnique({ where: { id: matchId }, select: { player1_id: true, player2_id: true, competitor_format: true } });
  if (!match?.player1_id || !match.player2_id || match.competitor_format !== 'ONE_V_ONE') return false;
  await Promise.allSettled(
    [match.player1_id, match.player2_id].map(async (uid) => {
      await sendMatchCard(fastify, matchId, uid);
      await refreshJoinDm(fastify, uid, '✅ Match found. Your match card is the message below.');
    }),
  );
  return true;
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
}

let tickerRunning = false;

/**
 * Make every configured ticker channel show exactly the open queue entries: post the new ones,
 * delete the ones that closed (matched, left, timed out). Called after every tick and leave, and
 * each minute; a reconcile, so no queue path needs its own hook.
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

    for (const [queueId, raw] of Object.entries(state)) {
      if (open.has(queueId)) continue;
      const s = JSON.parse(raw) as TickerState;
      await Promise.allSettled(s.posts.map((p) => discordRequest('DELETE', `/channels/${p.channelId}/messages/${p.messageId}`)));
      await redis.hdel(TICKER_KEY, queueId);
    }
    if (guilds.length === 0) return;

    for (const queueId of ids) {
      if (state[queueId]) continue;
      const prefs = parseQueuePrefs(await redis.hget(QUEUE_PREFS_KEY, queueId));
      const posts: TickerState['posts'] = [];
      for (const g of guilds) {
        // The role ping goes out at most once per few minutes per server.
        const ping = g.pingRoleId ? (await redis.set(PING_KEY(g.guildId), '1', 'EX', PING_GAP_SEC, 'NX')) === 'OK' : false;
        const messageId = await postMessage(g.tickerChannelId, renderTickerPost(prefs, ping ? g.pingRoleId : null));
        if (messageId) posts.push({ channelId: g.tickerChannelId, messageId });
      }
      await redis.hset(TICKER_KEY, queueId, JSON.stringify({ posts } satisfies TickerState));
    }
  } catch (err) {
    fastify.log.warn({ err }, '[discord-open-play] syncTicker failed (non-fatal)');
  } finally {
    tickerRunning = false;
  }
}

/** The pinned panel in a ticker channel: how to join, plus a "Find a game" button. */
export function renderJoinPanel(): DiscordMessage {
  return {
    content:
      `**Find an Open Play game**\nType \`/join\` anywhere on this server, or press the button. RizzBOTto sends you a DM where you ` +
      `pick battle types, Bo1/Bo3 and team size, then you play the whole match in that DM or on rizzotto.gg.\n` +
      `Open requests show up in this channel. Click one to take the match.`,
    components: [row(btn('Find a game', 'jp_find', PRIMARY), linkBtn('How Open Play works', `${siteUrl()}/how-to-play`))],
    allowed_mentions: noMentions,
  };
}

export async function postJoinPanel(channelId: string): Promise<string | null> {
  return postMessage(channelId, renderJoinPanel());
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

/** Register the global `/join` command (bulk overwrite, idempotent). Only with a bot token. */
export async function registerDiscordCommands(fastify: FastifyInstance): Promise<void> {
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId || !isBotConfigured()) return;
  try {
    const res = await discordRequest('PUT', `/applications/${appId}/commands`, [
      {
        name: 'join',
        type: 1,
        description: 'Find an Open Play game: set up your queue in a DM',
        contexts: [0, 1],
        integration_types: [0],
      },
    ]);
    if (!res.ok) fastify.log.warn({ status: res.status, body: await res.text() }, '[discord-open-play] command registration failed');
  } catch (err) {
    fastify.log.warn({ err }, '[discord-open-play] command registration failed (non-fatal)');
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
