/**
 * Discord Open Play: the join DM (queue settings as on the site, saved on every change), joining
 * through the shared checks (the strike cooldown can't be skipped from Discord), the ticker
 * reconcile, the match card per step, and actions run through the site's own routes (blind pick,
 * lobby, result + replay from a DM upload).
 *
 * Real PostgreSQL + Redis (queue keys snapshotted and restored). Discord's HTTP API is a fetch stub.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { QUEUE_KEY, JOINED_AT_KEY, QUEUE_PREFS_KEY } from '../src/lib/matchmaking-tick.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { handleOpenPlayInteraction, type Interaction } from '../src/lib/discord-open-play-interactions.js';
import { renderJoinDm, renderMatchCard, renderTickerPost, syncTicker, GUILDS_CONFIG_KEY } from '../src/lib/discord-open-play.js';
import { joinOpenPlayQueue } from '../src/lib/open-play-queue-service.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

const MM_KEYS = ['rizzotto:mm:hold', 'rizzotto:mm:ratelimit', 'rizzotto:mm:contacted', 'rizzotto:mm:tick:lock'];
const DOP_KEYS = ['rizzotto:dop:ticker'];
const ALL_KEYS = [QUEUE_KEY, JOINED_AT_KEY, QUEUE_PREFS_KEY, ...MM_KEYS, ...DOP_KEYS];

let app: FastifyInstance;
let users: TestUser[] = [];
const saved = new Map<string, { type: string; value: string[] | Record<string, string> | string | null }>();
let savedGuildConfig: unknown = undefined;

// ---- Discord HTTP stub -------------------------------------------------------------------------
type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let nextMessageId = 1;
let attachmentBody: Buffer = Buffer.alloc(0);

function jsonResponse(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const discordFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  let body: unknown;
  try {
    body = init?.body ? JSON.parse(String(init.body)) : undefined;
  } catch {
    body = init?.body;
  }
  calls.push({ method, url, body });
  if (url.startsWith('https://cdn.test/')) return new Response(attachmentBody, { status: 200 });
  if (url.endsWith('/users/@me/channels')) return jsonResponse(200, { id: `dm-${(body as { recipient_id: string }).recipient_id}` });
  if (method === 'POST' && /\/channels\/[^/]+\/messages$/.test(url)) return jsonResponse(200, { id: `msg-${nextMessageId++}` });
  if (method === 'DELETE') return jsonResponse(204, null);
  return jsonResponse(200, {});
});

const webhookCalls = (token: string) => calls.filter((c) => c.url.includes(`/webhooks/app/${token}`));

async function waitForWebhook(token: string, n = 1) {
  await vi.waitFor(() => expect(webhookCalls(token).length).toBeGreaterThanOrEqual(n), { timeout: 8000, interval: 50 });
}

// ---- helpers -----------------------------------------------------------------------------------
async function player(name: string): Promise<TestUser> {
  const u = await createTestUser({ username: name });
  await prisma.steamLink.create({ data: { user_id: u.id, steam_id: `steam-${u.id}`, persona: name } });
  users.push(u);
  return u;
}

let tokenSeq = 0;
function interaction(u: TestUser, type: number, data: Interaction['data'], message?: Interaction['message']): Interaction {
  return { type, token: `tok${++tokenSeq}`, application_id: 'app', data, user: { id: u.discord_id }, message };
}

type Row = { components: { type: number; custom_id?: string; disabled?: boolean; options?: { value: string; default?: boolean }[] }[] };
const flat = (components: object[]) => (components as Row[]).flatMap((r) => r.components);
const customIds = (components: object[]) => flat(components).map((c) => c.custom_id).filter(Boolean);

beforeAll(async () => {
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  vi.stubGlobal('fetch', discordFetch);
  app = await buildApp({ withSocket: false, withRedis: true, withCron: false, withGraphql: false, withDraft: false });
  for (const key of ALL_KEYS) {
    const type = await app.redis.type(key);
    if (type === 'list') saved.set(key, { type, value: await app.redis.lrange(key, 0, -1) });
    else if (type === 'hash') saved.set(key, { type, value: await app.redis.hgetall(key) });
    else if (type === 'string') saved.set(key, { type, value: await app.redis.get(key) });
  }
  savedGuildConfig = (await prisma.adminConfig.findUnique({ where: { key: GUILDS_CONFIG_KEY } }))?.value;
  await app.redis.del(...ALL_KEYS);
});

afterEach(async () => {
  const ids = users.map((u) => u.id);
  await prisma.matchGame.deleteMany({ where: { match: { type: 'OPEN_PLAY', OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] } } });
  await prisma.match.deleteMany({ where: { type: 'OPEN_PLAY', OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] } });
  await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.userQueuePref.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.botMessage.deleteMany({ where: { target_id: { in: users.map((u) => u.discord_id) } } });
  await cleanupUsers(ids);
  for (const u of users) {
    await app.redis.del(`rizzotto:dop:join:${u.id}`, `rizzotto:queue:timeout:${u.id}`);
  }
  users = [];
  calls = [];
  await app.redis.del(...ALL_KEYS);
  await prisma.adminConfig.deleteMany({ where: { key: GUILDS_CONFIG_KEY } });
});

afterAll(async () => {
  await app.redis.del(...ALL_KEYS);
  for (const [key, { type, value }] of saved) {
    if (type === 'list' && (value as string[]).length) await app.redis.rpush(key, ...(value as string[]));
    else if (type === 'hash' && Object.keys(value as object).length) await app.redis.hset(key, value as Record<string, string>);
    else if (type === 'string' && value !== null) await app.redis.set(key, value as string);
  }
  if (savedGuildConfig !== undefined) {
    await prisma.adminConfig.create({ data: { key: GUILDS_CONFIG_KEY, value: savedGuildConfig as never } });
  }
  await app.close();
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
});

// ---- join DM -----------------------------------------------------------------------------------
describe('join DM', () => {
  it('shows the queue settings like the site, preset from the stored settings', async () => {
    const u = await player('dop_render');
    const dm = await renderJoinDm(app, u.id);
    expect(customIds(dm.components)).toEqual(['oq_bt', 'oq_fmt', 'oq_size', 'oq_join']);
    const bt = flat(dm.components).find((c) => c.custom_id === 'oq_bt')!;
    expect(bt.options!.every((o) => o.default)).toBe(true); // defaults: every battle type
  });

  it('saves every change straight away and re-renders in place', async () => {
    const u = await player('dop_select');
    const res = (await handleOpenPlayInteraction(app, interaction(u, 3, { custom_id: 'oq_bt', values: ['CONQUEST', 'LAND_BATTLE'] }))) as { type: number; data: { components: object[] } };
    expect(res.type).toBe(7);
    const pref = await prisma.userQueuePref.findUnique({ where: { user_id: u.id } });
    expect(pref?.battle_types).toEqual(['CONQUEST', 'LAND_BATTLE']);
    const bt = flat(res.data.components).find((c) => c.custom_id === 'oq_bt')!;
    expect(bt.options!.filter((o) => o.default).map((o) => o.value)).toEqual(['CONQUEST', 'LAND_BATTLE']);
  });

  it('2v2 without a team: Join is disabled', async () => {
    const u = await player('dop_2v2');
    const res = (await handleOpenPlayInteraction(app, interaction(u, 3, { custom_id: 'oq_size', values: ['TWO_V_TWO'] }))) as { data: { components: object[]; content: string } };
    expect(flat(res.data.components).find((c) => c.custom_id === 'oq_join')!.disabled).toBe(true);
    expect(res.data.content).toContain('captain of an active team');
  });

  it('Join queue puts the player in the queue and shows the entry with Leave', async () => {
    const u = await player('dop_join');
    const i = interaction(u, 3, { custom_id: 'oq_join' }, { id: 'm1', channel_id: 'dm-x' });
    const ack = (await handleOpenPlayInteraction(app, i)) as { type: number };
    expect(ack.type).toBe(6);
    await waitForWebhook(i.token);
    expect(await app.redis.lpos(QUEUE_KEY, u.id)).not.toBeNull();
    const edit = webhookCalls(i.token)[0]!;
    expect(edit.method).toBe('PATCH');
    expect(customIds((edit.body as { components: object[] }).components)).toEqual(['oq_leave']);

    const left = (await handleOpenPlayInteraction(app, interaction(u, 3, { custom_id: 'oq_leave' }))) as { data: { components: object[] } };
    expect(await app.redis.lpos(QUEUE_KEY, u.id)).toBeNull();
    expect(customIds(left.data.components)).toContain('oq_join');
  });

  it('the strike cooldown also blocks a join from Discord', async () => {
    const u = await player('dop_cooldown');
    await app.redis.set(`rizzotto:queue:timeout:${u.id}`, '1', 'EX', 600);
    const blocked = await joinOpenPlayQueue(app, u.id, {});
    expect(blocked.ok).toBe(false);

    const i = interaction(u, 3, { custom_id: 'oq_join' }, { id: 'm1', channel_id: 'dm-x' });
    await handleOpenPlayInteraction(app, i);
    await waitForWebhook(i.token, 2);
    expect(await app.redis.lpos(QUEUE_KEY, u.id)).toBeNull();
    const followUp = webhookCalls(i.token).find((c) => c.method === 'POST')!;
    expect(String((followUp.body as { content: string }).content)).toMatch(/cooldown/i);
  });

  it('a player without Steam gets the setup link instead of a DM', async () => {
    const u = await createTestUser({ username: 'dop_nosteam' });
    users.push(u);
    const i = interaction(u, 2, { name: 'join' });
    const ack = (await handleOpenPlayInteraction(app, i)) as { type: number };
    expect(ack.type).toBe(5);
    await waitForWebhook(i.token);
    expect(JSON.stringify(webhookCalls(i.token)[0]!.body)).toContain('/login');
    expect(await app.redis.get(`rizzotto:dop:pending:${u.discord_id}`)).toBe('1');
    await app.redis.del(`rizzotto:dop:pending:${u.discord_id}`);
  });
});

// ---- ticker ------------------------------------------------------------------------------------
describe('ticker', () => {
  it('posts one button per battle type × format; Siege only as Bo2', () => {
    const post = renderTickerPost({ format: 'ONE_V_ONE', battleTypes: ['CONQUEST', 'SIEGE'], matchFormats: ['BO1', 'BO3'] });
    const labels = flat(post.components).map((c) => (c as unknown as { label: string }).label);
    expect(labels).toEqual(['Conquest Bo1', 'Conquest Bo3', 'Siege Bo2']);
  });

  it('shows exactly the open entries: posts new ones, deletes closed ones', async () => {
    await prisma.adminConfig.create({ data: { key: GUILDS_CONFIG_KEY, value: [{ guildId: '1', tickerChannelId: 'tick-1' }] as never } });
    const u = await player('dop_ticker');
    await app.redis.rpush(QUEUE_KEY, u.id);
    await app.redis.hset(QUEUE_PREFS_KEY, u.id, JSON.stringify({ format: 'ONE_V_ONE', battleTypes: ['LAND_BATTLE'], matchFormats: ['BO3'] }));

    await syncTicker(app);
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/channels/tick-1/messages'));
    expect(post).toBeDefined();
    expect(customIds((post!.body as { components: object[] }).components)).toEqual(['tk:L:3:1']);

    await syncTicker(app); // nothing new
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/channels/tick-1/messages'))).toHaveLength(1);

    await app.redis.lrem(QUEUE_KEY, 0, u.id);
    await syncTicker(app);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/channels/tick-1/messages/'))).toBe(true);
  });
});

// ---- match card --------------------------------------------------------------------------------
describe('match card', () => {
  async function match() {
    const a = await player('dop_card_a');
    const b = await player('dop_card_b');
    const { matchId } = await createOpenPlayMatch(prisma, a.id, b.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', 'BO1');
    return { a, b, matchId };
  }

  it('walks pick → locked → revealed with the site routes underneath', async () => {
    const { a, b, matchId } = await match();
    const start = (await renderMatchCard(app, matchId, a.id))!;
    expect(customIds(start.components)[0]).toBe(`mc_pick:${matchId}:1`);
    const faction = flat(start.components)[0]!.options![0]!.value;
    const other = flat(start.components)[0]!.options![1]!.value;

    const pickA = interaction(a, 3, { custom_id: `mc_pick:${matchId}:1`, values: [faction] }, { id: 'card-a', channel_id: 'dm-a' });
    await handleOpenPlayInteraction(app, pickA);
    await waitForWebhook(pickA.token);
    expect((await renderMatchCard(app, matchId, a.id))!.content).toContain('You picked');
    expect((await renderMatchCard(app, matchId, b.id))!.content).toContain('has picked');

    const pickB = interaction(b, 3, { custom_id: `mc_pick:${matchId}:1`, values: [other] }, { id: 'card-b', channel_id: 'dm-b' });
    await handleOpenPlayInteraction(app, pickB);
    await waitForWebhook(pickB.token);
    const revealed = (await renderMatchCard(app, matchId, a.id))!;
    expect(customIds(revealed.components)).toEqual([`mc_lobby:${matchId}:1`, `mc_won:${matchId}:1`, `mc_lost:${matchId}:1`, `mc_cancel:${matchId}`]);
  });

  it('lobby form and a replay uploaded in the DM go through the site routes', async () => {
    const { a, b, matchId } = await match();
    const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId, game_number: 1 } });
    const factions = await prisma.faction.findMany({ take: 2, select: { id: true } });
    await prisma.matchBlindPick.update({
      where: { game_id: game.id },
      data: { player1_faction_id: factions[0]!.id, player2_faction_id: factions[1]!.id, player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date() },
    });

    const lobby = interaction(a, 5, {
      custom_id: `mc_lobbyset:${matchId}:1`,
      components: [
        { type: 18, component: { type: 4, custom_id: 'code', value: 'ABC123' } },
        { type: 18, component: { type: 4, custom_id: 'password', value: 'pw' } },
      ],
    }, { id: 'card-a', channel_id: 'dm-a' });
    await handleOpenPlayInteraction(app, lobby);
    await waitForWebhook(lobby.token);
    const after = await prisma.matchGame.findUniqueOrThrow({ where: { id: game.id } });
    expect([after.lobby_code, after.lobby_password]).toEqual(['ABC123', 'pw']);

    // A minimal ESF replay (signature + timestamp): enough for the upload checks.
    const replay = Buffer.alloc(64);
    replay[0] = 0xcb;
    replay[1] = 0xab;
    replay.writeUInt32LE(Math.floor(Date.now() / 1000), 8);
    attachmentBody = replay;
    const report = interaction(b, 5, {
      custom_id: `mc_report:${matchId}:1:l`,
      components: [{ type: 18, component: { type: 19, custom_id: 'replay', values: ['att1'] } }],
      resolved: { attachments: { att1: { id: 'att1', filename: 'battle.replay', size: replay.length, url: 'https://cdn.test/battle.replay' } } },
    }, { id: 'card-b', channel_id: 'dm-b' });
    await handleOpenPlayInteraction(app, report);
    await waitForWebhook(report.token);
    const reported = await prisma.matchGame.findUniqueOrThrow({ where: { id: game.id } });
    expect(reported.reporter_id).toBe(b.id);
    expect(reported.reported_winner_id).toBe(a.id); // "they won" from b's card
    expect(reported.replay_url).toMatch(/^\/uploads\/replays\//);
  });

  it('a non-replay attachment is refused before anything is reported', async () => {
    const { a, matchId } = await match();
    const report = interaction(a, 5, {
      custom_id: `mc_report:${matchId}:1:w`,
      components: [{ type: 18, component: { type: 19, custom_id: 'replay', values: ['att1'] } }],
      resolved: { attachments: { att1: { id: 'att1', filename: 'screenshot.png', size: 10, url: 'https://cdn.test/x.png' } } },
    });
    await handleOpenPlayInteraction(app, report);
    await waitForWebhook(report.token);
    expect(String((webhookCalls(report.token)[0]!.body as { content: string }).content)).toContain('not a replay file');
    const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId, game_number: 1 } });
    expect(game.reported_at).toBeNull();
  });
});
