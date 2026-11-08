/**
 * Interaction handlers for Discord Open Play (`/join`, join DM, ticker, match card). The route in
 * routes/discord-interactions.ts verifies the signature and hands every interaction here first;
 * a null return means "not ours" and the route carries on with its own buttons.
 */
import type { FastifyInstance } from 'fastify';
import {
  areOpenPlayTesters,
  callAsUser,
  describeReplay,
  getPreviewState,
  lobbyModal,
  lockPreviewThree,
  pickPreviewFactions,
  refreshMatchCards,
  rememberCardRender,
  rememberPendingJoin,
  renderJoinDm,
  renderMatchCard,
  renderSetupPrompt,
  replayMultipart,
  reportModal,
  restartPreview,
  savePreviewState,
  sendJoinDm,
  strikePreviewCell,
  syncTicker,
  type DiscordMessage,
} from './discord-open-play.js';
import { joinOpenPlayQueue, leaveOpenPlayQueue } from './open-play-queue-service.js';
import { claimQueueOffer } from './queue-offer.js';
import { logDiscordClick } from './queue-activity.js';
import { ALL_BATTLE_TYPES, ALL_QUEUE_MATCH_FORMATS, decodeOffer, type QueueBattleType, type QueueMatchFormat } from './queue-matching.js';
import { getStoredQueuePrefs, saveQueuePrefs } from './queue-prefs.js';
import { setWeeklyBan } from './weekly-ban.js';

// Mirrors the multipart file limit in app.ts (5 MB).
const REPLAY_MAX_BYTES = 5 * 1024 * 1024;

export const APPLICATION_COMMAND = 2;
export const MESSAGE_COMPONENT = 3;
export const MODAL_SUBMIT = 5;

const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const UPDATE_MESSAGE = 7;
const MODAL = 9;
const EPHEMERAL = 64;

type ModalNode = { type?: number; custom_id?: string; value?: string; values?: string[]; component?: ModalNode; components?: ModalNode[] };

export interface Interaction {
  type: number;
  token: string;
  application_id: string;
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    components?: ModalNode[];
    resolved?: { attachments?: Record<string, Attachment> };
  };
  member?: { user: { id: string } };
  user?: { id: string };
  guild_id?: string;
  message?: { id: string; channel_id: string };
}

const ephemeral = (content: string, components: object[] = []) => ({ type: CHANNEL_MESSAGE, data: { content, components, flags: EPHEMERAL } });
const update = (message: DiscordMessage) => ({ type: UPDATE_MESSAGE, data: message });

// Interaction webhooks (no bot token; the interaction token authorises them for 15 minutes).
async function webhook(method: 'PATCH' | 'POST' | 'DELETE', appId: string, token: string, path: string, body?: object): Promise<void> {
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}${path}`, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    console.error('[discord-open-play] interaction webhook failed:', err);
  }
}
const editOriginal = (i: Interaction, body: object) => webhook('PATCH', i.application_id, i.token, '/messages/@original', body);
const followUp = (i: Interaction, content: string) => webhook('POST', i.application_id, i.token, '', { content, flags: EPHEMERAL });

/** How long an "Only you can see this" confirmation stays in the channel (errors stay until dismissed). */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

/** Remove the interaction's own reply after a while (in-process; the token allows it for 15 minutes). */
export function deleteOriginalLater(i: Interaction, ms = CONFIRMATION_TTL_MS): void {
  setTimeout(() => void webhook('DELETE', i.application_id, i.token, '/messages/@original'), ms).unref();
}

type Attachment = { id: string; filename: string; size: number; url: string };

/** Why an uploaded file can't be used as the replay, or null when it can. */
function replayProblem(attachment: Attachment | undefined): string | null {
  if (!attachment) return 'Attach the replay file to report the game.';
  if (!attachment.filename.toLowerCase().endsWith('.replay')) return 'That is not a replay file. Attach the `.replay` file of this battle.';
  if (attachment.size > REPLAY_MAX_BYTES) return 'That replay file is too large.';
  return null;
}

/** Acknowledge now, finish in the background (Discord's 3-second window never bites). */
function deferred(fastify: FastifyInstance, ack: object, work: () => Promise<void>) {
  setImmediate(() => {
    work().catch((err) => fastify.log.error({ err }, '[discord-open-play] interaction failed'));
  });
  return ack;
}

/** All submitted modal values by custom_id (text inputs → value, file uploads/selects → values). */
function modalValues(nodes: ModalNode[] | undefined): Map<string, { value?: string; values?: string[] }> {
  const out = new Map<string, { value?: string; values?: string[] }>();
  const walk = (list?: ModalNode[]) => {
    for (const n of list ?? []) {
      if (n.custom_id) out.set(n.custom_id, { value: n.value, values: n.values });
      if (n.component) walk([n.component]);
      if (n.components) walk(n.components);
    }
  };
  walk(nodes);
  return out;
}

async function playerByDiscord(fastify: FastifyInstance, discordId: string) {
  return fastify.prisma.user.findFirst({
    where: { discord_id: discordId, deleted_at: null },
    select: { id: true, discord_id: true, steam_link: { select: { user_id: true } } },
  });
}

// The server a player last came from. The join itself happens in a DM, where Discord names no server.
const JOIN_SERVER_KEY = (discordId: string) => `rizzotto:dop:server:${discordId}`;
const JOIN_SERVER_TTL = 30 * 24 * 3600;

async function rememberJoinServer(fastify: FastifyInstance, i: Interaction, discordId: string): Promise<void> {
  if (i.guild_id) await fastify.redis?.set(JOIN_SERVER_KEY(discordId), i.guild_id, 'EX', JOIN_SERVER_TTL);
}

/** `/join` and the panel's "Find a game": the join DM (registration first, when missing). */
function startJoin(fastify: FastifyInstance, i: Interaction, discordId: string, kind: 'JOIN_COMMAND' | 'PANEL_BUTTON') {
  return deferred(fastify, { type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } }, async () => {
    await rememberJoinServer(fastify, i, discordId);
    const user = await playerByDiscord(fastify, discordId);
    if (!user || !user.steam_link) {
      await rememberPendingJoin(fastify, discordId);
      await editOriginal(i, renderSetupPrompt(user ? 'steam' : 'account'));
      await logDiscordClick(fastify.prisma, { kind, outcome: 'SETUP_LINK', guildId: i.guild_id, userId: user?.id });
      return;
    }
    const r = await sendJoinDm(fastify, { id: user.id, discord_id: discordId });
    await logDiscordClick(fastify.prisma, {
      kind,
      outcome: r === 'sent' ? 'DM_SENT' : r === 'card' ? 'ACTIVE_MATCH' : r === 'closed' ? 'DMS_CLOSED' : 'FAILED',
      guildId: i.guild_id,
      userId: user.id,
    });
    const text =
      r === 'sent'
        ? '✉️ Check your DMs: your queue settings are waiting there.'
        : r === 'card'
          ? '✉️ You have a match going. Your match card is in your DMs.'
          : r === 'closed'
            ? "I can't send you DMs. Allow direct messages from server members (Privacy Settings of this server), then try again."
            : 'Something went wrong. Please try again, or join on rizzotto.gg/open-play.';
    await editOriginal(i, { content: text, components: [] });
    if (r === 'sent' || r === 'card') deleteOriginalLater(i);
  });
}

const BATTLE_TYPES = ALL_BATTLE_TYPES as readonly string[];
const MATCH_FORMATS = ALL_QUEUE_MATCH_FORMATS as readonly string[];

async function handleJoinDm(fastify: FastifyInstance, i: Interaction, userId: string, action: string, parts: string[]) {
  const values = i.data?.values ?? [];

  // The weekly ban: choosing one asks first (it locks for 7 days), then it is set. Dropping it asks first too.
  if (action === 'oq_ban') return update(await renderJoinDm(fastify, userId, undefined, values[0] ? { set: values[0] } : undefined));
  if (action === 'oq_banno') return update(await renderJoinDm(fastify, userId));
  if (action === 'oq_bandrop') return update(await renderJoinDm(fastify, userId, undefined, { drop: true }));
  if (action === 'oq_bandropok') {
    await setWeeklyBan(fastify.prisma, userId, null);
    return update(await renderJoinDm(fastify, userId, '✅ Your weekly ban is dropped.'));
  }
  if (action === 'oq_banok') {
    const result = await setWeeklyBan(fastify.prisma, userId, parts[0] ?? null);
    const note = result.ok
      ? '✅ Your weekly ban is set.'
      : result.reason === 'locked'
        ? `Your weekly ban can change again <t:${Math.floor(result.opensAt.getTime() / 1000)}:R>.`
        : result.reason === 'ruleset_banned'
          ? 'The Standard Ruleset already bans that faction in every Open Play game. Pick another one.'
          : 'That faction is unknown.';
    return update(await renderJoinDm(fastify, userId, note));
  }

  if (action === 'oq_bt' || action === 'oq_fmt' || action === 'oq_size' || action === 'oq_team') {
    const stored = await getStoredQueuePrefs(fastify.prisma, userId);
    if (action === 'oq_bt') {
      const picked = values.filter((v): v is QueueBattleType => BATTLE_TYPES.includes(v));
      if (picked.length > 0) stored.battleTypes = picked;
    } else if (action === 'oq_fmt') {
      const picked = values.filter((v): v is QueueMatchFormat => MATCH_FORMATS.includes(v));
      if (picked.length > 0) stored.matchFormats = picked;
    } else if (action === 'oq_size') {
      stored.competitorFormat = values[0] === 'TWO_V_TWO' ? 'TWO_V_TWO' : 'ONE_V_ONE';
    } else if (values[0]) {
      stored.teamId = values[0];
    }
    await saveQueuePrefs(fastify.prisma, userId, stored);
    return update(await renderJoinDm(fastify, userId));
  }

  if (action === 'oq_leave') {
    await leaveOpenPlayQueue(fastify, userId);
    void syncTicker(fastify);
    return update(await renderJoinDm(fastify, userId));
  }

  if (action === 'oq_join') {
    return deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
      // Remember this DM so a match, or leaving on the site, can update it later.
      if (i.message) {
        await fastify.redis?.set(`rizzotto:dop:join:${userId}`, JSON.stringify({ channelId: i.message.channel_id, messageId: i.message.id }), 'EX', 24 * 3600);
      }
      const stored = await getStoredQueuePrefs(fastify.prisma, userId);
      const discordId = i.member?.user.id ?? i.user?.id;
      const guildId = discordId ? await fastify.redis?.get(JOIN_SERVER_KEY(discordId)) : null;
      const result = await joinOpenPlayQueue(
        fastify,
        userId,
        {
          battleTypes: stored.battleTypes,
          matchFormats: stored.matchFormats,
          competitorFormat: stored.competitorFormat,
          ...(stored.competitorFormat === 'TWO_V_TWO' && stored.teamId ? { teamId: stored.teamId } : {}),
          save: true,
        },
        { via: 'JOIN_DM', guildId },
      );
      if (!result.ok) {
        await editOriginal(i, await renderJoinDm(fastify, userId));
        await followUp(i, result.code === 'QUEUED' ? "You're already in the queue." : result.message);
        return;
      }
      const note = result.matched
        ? '✅ Match found. Your match card is the message below.'
        : result.fellBackTo1v1
          ? 'Your 2v2 team can\'t queue right now, so you joined for 1v1.'
          : undefined;
      await editOriginal(i, await renderJoinDm(fastify, userId, note));
    });
  }
  return null;
}

/** A ticker button: take that open game (the clicker never joins the queue). */
function handleTicker(fastify: FastifyInstance, i: Interaction, discordId: string, offerParts: string[]) {
  const offer = decodeOffer(offerParts);
  if (!offer) return ephemeral('Invalid button.');
  return deferred(fastify, { type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } }, async () => {
    const user = await playerByDiscord(fastify, discordId);
    if (!user || !user.steam_link) {
      await rememberJoinServer(fastify, i, discordId);
      await rememberPendingJoin(fastify, discordId);
      await editOriginal(i, renderSetupPrompt(user ? 'steam' : 'account'));
      await logDiscordClick(fastify.prisma, { kind: 'TICKER_OFFER', outcome: 'SETUP_LINK', guildId: i.guild_id, userId: user?.id });
      return;
    }
    const result = await claimQueueOffer(fastify, user.id, offer);
    await logDiscordClick(fastify.prisma, {
      kind: 'TICKER_OFFER',
      outcome: result.status === 'matched' ? 'MATCHED' : result.status === 'blocked' ? 'BLOCKED' : 'GONE',
      guildId: i.guild_id,
      userId: user.id,
      matchId: result.status === 'matched' ? result.matchId : null,
    });
    const text =
      result.status === 'matched'
        ? `⚔️ Match found vs **${result.opponentName}**! Check your DMs.`
        : result.status === 'blocked'
          ? result.message
          : 'Someone else just took that game.';
    await editOriginal(i, { content: text, components: [] });
    if (result.status === 'matched') deleteOriginalLater(i);
    void syncTicker(fastify);
  });
}

/** After a match action: show the fresh card in the clicked message and update the other card. */
async function settleCard(fastify: FastifyInstance, i: Interaction, matchId: string, userId: string): Promise<void> {
  const card = await renderMatchCard(fastify, matchId, userId);
  if (card) {
    await editOriginal(i, card);
    if (i.message) await rememberCardRender(fastify, matchId, userId, i.message.channel_id, i.message.id, card);
  }
  await refreshMatchCards(fastify, matchId);
}

const errorText = (res: { statusCode: number; json: () => Record<string, unknown> }) =>
  String(res.json().message ?? 'That did not work. Please try again on rizzotto.gg.');

async function handleMatchCard(fastify: FastifyInstance, i: Interaction, userId: string, action: string, parts: string[]) {
  const [matchId, gameStr, extra] = parts;
  if (!matchId) return ephemeral('Invalid button.');
  const gameNumber = Number(gameStr ?? 1) || 1;
  const base = `/api/matches/${matchId}/games/${gameNumber}`;

  // Run a site route as the player, then re-render. Errors come back privately.
  const act = (method: 'POST' | 'PATCH', url: string, payload?: unknown) =>
    deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
      const res = await callAsUser(fastify, userId, { method, url, payload: payload ?? {} });
      if (res.statusCode >= 400) await followUp(i, errorText(res));
      await settleCard(fastify, i, matchId, userId);
    });

  switch (action) {
    case 'mc_pick': {
      const factionId = i.data?.values?.[0];
      if (!factionId) return ephemeral('Pick a faction.');
      return act('POST', `/api/matches/${matchId}/decision/blind-pick/lock`, { faction_id: factionId });
    }
    case 'mc_mx3': {
      const three = i.data?.values ?? [];
      if (three.length !== 3) return ephemeral('Pick 3 factions.');
      return act('POST', `/api/matches/${matchId}/matrix/lock`, { factions: three });
    }
    case 'mc_mx':
      return act('POST', `/api/matches/${matchId}/matrix/ban`, { row: Number(extra), col: Number(parts[3]) });
    case 'mc_lobby': {
      const game = await fastify.prisma.matchGame.findFirst({
        where: { match_id: matchId, game_number: gameNumber },
        select: { lobby_code: true, lobby_password: true },
      });
      return { type: MODAL, data: lobbyModal(matchId, gameNumber, game?.lobby_code ?? null, game?.lobby_password ?? null) };
    }
    case 'mc_won':
      return { type: MODAL, data: reportModal(matchId, gameNumber, 'w') };
    case 'mc_lost':
      return { type: MODAL, data: reportModal(matchId, gameNumber, 'l') };
    case 'mc_rep':
      return { type: MODAL, data: reportModal(matchId, gameNumber, extra === 'l' ? 'l' : 'w') };
    case 'mc_assert':
      return act('POST', `${base}/assert-replay-correct`);
    case 'mc_conf':
      return act('POST', `${base}/opponent-confirm`);
    case 'mc_rej':
      return act('POST', `${base}/opponent-reject`);
    case 'mc_esc':
      return act('POST', `${base}/escalate`);
    case 'mc_cancel':
      return ephemeral('Cancel this match? A game that already has a reported result keeps it; the rest is dropped.', [
        { type: 1, components: [{ type: 2, style: 4, label: 'Yes, cancel the match', custom_id: `mc_cancelyes:${matchId}` }] },
      ]);
    case 'mc_cancelyes':
      return deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
        const res = await callAsUser(fastify, userId, { method: 'POST', url: `/api/open-play/matches/${matchId}/cancel`, payload: {} });
        await editOriginal(i, { content: res.statusCode < 400 ? 'The match is cancelled.' : errorText(res), components: [] });
        await refreshMatchCards(fastify, matchId);
      });
  }
  return null;
}

async function handleModal(fastify: FastifyInstance, i: Interaction, userId: string, action: string, parts: string[]) {
  const [matchId, gameStr, side] = parts;
  if (!matchId) return ephemeral('Invalid form.');
  const gameNumber = Number(gameStr ?? 1) || 1;
  const base = `/api/matches/${matchId}/games/${gameNumber}`;
  const values = modalValues(i.data?.components);

  if (action === 'mc_lobbyset') {
    const code = values.get('code')?.value?.trim() ?? '';
    const password = values.get('password')?.value?.trim() ?? '';
    return deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
      const a = await callAsUser(fastify, userId, { method: 'PATCH', url: `${base}/lobby-code`, payload: { lobby_code: code || null } });
      const b = await callAsUser(fastify, userId, { method: 'PATCH', url: `${base}/lobby-password`, payload: { lobby_password: password || null } });
      const failed = [a, b].find((r) => r.statusCode >= 400);
      if (failed) await followUp(i, errorText(failed));
      await settleCard(fastify, i, matchId, userId);
    });
  }

  if (action === 'mc_report') {
    const attachmentId = values.get('replay')?.values?.[0];
    const attachment = attachmentId ? i.data?.resolved?.attachments?.[attachmentId] : undefined;
    return deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
      const problem = replayProblem(attachment);
      if (problem || !attachment) {
        await followUp(i, problem ?? 'Attach the replay file to report the game.');
        return;
      }
      const match = await fastify.prisma.match.findUnique({ where: { id: matchId }, select: { player1_id: true, player2_id: true } });
      const opponentId = match?.player1_id === userId ? match?.player2_id : match?.player1_id;
      const winnerId = side === 'l' ? opponentId : userId;
      if (!winnerId) {
        await followUp(i, 'Match not found.');
        return;
      }
      const file = Buffer.from(await (await fetch(attachment.url)).arrayBuffer());
      const { payload, headers } = replayMultipart(winnerId, attachment.filename, file);
      const res = await callAsUser(fastify, userId, { method: 'POST', url: `${base}/result`, payload, headers });
      if (res.statusCode >= 400) await followUp(i, errorText(res));
      await settleCard(fastify, i, matchId, userId);
    });
  }
  return null;
}

/** The preview card: the same steps as a real card, with RizzBOTto on the other side and no match. */
async function handlePreview(fastify: FastifyInstance, i: Interaction, userId: string, action: string, parts: string[]) {
  const s = await getPreviewState(fastify, userId);
  if (!s) return ephemeral('This preview has expired. Send a new one from the admin panel.');
  const values = modalValues(i.data?.components);

  switch (action) {
    case 'pv_pick': {
      const factionId = i.data?.values?.[0];
      if (!factionId) return ephemeral('Pick a faction.');
      return update(await pickPreviewFactions(fastify, userId, s, factionId));
    }
    case 'pv_lobby':
      return { type: MODAL, data: { ...lobbyModal('preview', 1, s.lobbyCode ?? null, s.lobbyPassword ?? null), custom_id: 'pv_lobbyset' } };
    case 'pv_lobbyset':
      return update(
        await savePreviewState(fastify, userId, {
          ...s,
          lobbyCode: values.get('code')?.value?.trim() || null,
          lobbyPassword: values.get('password')?.value?.trim() || null,
        }),
      );
    case 'pv_won':
    case 'pv_lost': {
      const side = action === 'pv_won' ? 'w' : 'l';
      return { type: MODAL, data: { ...reportModal('preview', 1, side), custom_id: `pv_report:${side}` } };
    }
    case 'pv_report': {
      const attachmentId = values.get('replay')?.values?.[0];
      const attachment = attachmentId ? i.data?.resolved?.attachments?.[attachmentId] : undefined;
      return deferred(fastify, { type: DEFERRED_UPDATE }, async () => {
        const problem = replayProblem(attachment);
        if (problem || !attachment) {
          await followUp(i, problem ?? 'Attach the replay file to report the game.');
          return;
        }
        const file = Buffer.from(await (await fetch(attachment.url)).arrayBuffer());
        const replay = await describeReplay(fastify, file);
        await editOriginal(i, await savePreviewState(fastify, userId, { ...s, result: parts[0] === 'l' ? 'l' : 'w', replay }));
      });
    }
    case 'pv_cancel':
      return ephemeral('On a real card this asks you to confirm, then cancels the match. A game that already has a reported result keeps it.');
    case 'pv_mx3': {
      const three = i.data?.values ?? [];
      if (three.length !== 3) return ephemeral('Pick 3 factions.');
      return update(await lockPreviewThree(fastify, userId, s, three));
    }
    case 'pv_mx':
      return update(await strikePreviewCell(fastify, userId, s, `${parts[0]},${parts[1]}`));
    case 'pv_again':
      return update(await restartPreview(fastify, userId, s.variant));
  }
  return null;
}

/**
 * Handle a Discord Open Play interaction, or return null when it isn't one. The returned value is
 * the interaction response body.
 */
export async function handleOpenPlayInteraction(fastify: FastifyInstance, i: Interaction): Promise<object | null> {
  const discordId = i.member?.user.id ?? i.user?.id;
  if (!discordId) return null;

  // The ways in (before go-live, testers only). Join DMs and match cards only ever reach players
  // who came through here (preview cards only admins), so their buttons need no check of their own.
  const notOpenYet = () => ephemeral("Open Play on Discord isn't open yet. You can join the queue on rizzotto.gg/open-play.");
  if (i.type === APPLICATION_COMMAND) {
    if (i.data?.name !== 'join') return null;
    return (await areOpenPlayTesters(fastify, [discordId])) ? startJoin(fastify, i, discordId, 'JOIN_COMMAND') : notOpenYet();
  }

  const [action = '', ...parts] = (i.data?.custom_id ?? '').split(':');
  if (i.type === MESSAGE_COMPONENT) {
    if (action === 'jp_find' || action === 'tk') {
      if (!(await areOpenPlayTesters(fastify, [discordId]))) return notOpenYet();
      return action === 'jp_find' ? startJoin(fastify, i, discordId, 'PANEL_BUTTON') : handleTicker(fastify, i, discordId, parts);
    }
    if (!action.startsWith('oq_') && !action.startsWith('mc_') && !action.startsWith('pv_')) return null;
  } else if (i.type !== MODAL_SUBMIT) {
    return null;
  }

  const user = await playerByDiscord(fastify, discordId);
  if (!user) return ephemeral('You need an account on rizzotto.gg first. Use /join to set it up.');
  if (!fastify.redis) return ephemeral('Open Play is temporarily unavailable.');

  if (action.startsWith('pv_')) return handlePreview(fastify, i, user.id, action, parts);
  if (i.type === MODAL_SUBMIT) return handleModal(fastify, i, user.id, action, parts);
  if (action.startsWith('oq_')) return handleJoinDm(fastify, i, user.id, action, parts);
  return handleMatchCard(fastify, i, user.id, action, parts);
}

