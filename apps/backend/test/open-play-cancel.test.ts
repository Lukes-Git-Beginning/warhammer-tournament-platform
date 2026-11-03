/**
 * A cancelled Open Play match can't swallow a result: the other side can still report the battle, a
 * report that shows the player who cancelled lost goes to the admins, and an admin can add a result
 * at any time. The match stays on record with CANCELLED as its outcome.
 *
 * Real PostgreSQL + Redis. Discord's HTTP API is a fetch stub.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { cancelOpenPlayMatch, LATE_REPORT_WINDOW_MS } from '../src/lib/cancel-open-play-match.js';
import { createOpenPlayMatch } from '../src/lib/create-open-play-match.js';
import { handleOpenPlayInteraction, type Interaction } from '../src/lib/discord-open-play-interactions.js';
import { renderMatchCard, replayMultipart, ROLLOUT_CONFIG_KEY } from '../src/lib/discord-open-play.js';
import { autoConfirmExpiredGameResults } from '../src/lib/match-games.js';
import { createTestUser, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;
let users: TestUser[] = [];
let savedRollout: unknown = undefined;
const roles = new Map<string, string>();

type Call = { method: string; url: string; body: { content?: string; components?: object[]; allowed_mentions?: { users?: string[] } } };
let calls: Call[] = [];
let nextMessageId = 1;

function jsonResponse(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const discordFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  let body: unknown = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    /* multipart */
  }
  calls.push({ method, url, body: body as Call['body'] });
  if (url.endsWith('/users/@me/channels')) return jsonResponse(200, { id: `dm-${(body as { recipient_id: string }).recipient_id}` });
  if (method === 'POST' && /\/channels\/[^/]+\/messages$/.test(url)) return jsonResponse(200, { id: `msg-${nextMessageId++}` });
  return jsonResponse(200, {});
});

const dmsTo = (u: TestUser) => calls.filter((c) => c.method === 'POST' && c.url.includes(`/channels/dm-${u.discord_id}/messages`));
const anyDmContaining = (u: TestUser, text: string) => dmsTo(u).some((c) => String(c.body.content).includes(text));

async function player(name: string, role: 'USER' | 'ADMIN' = 'USER'): Promise<TestUser> {
  const u = await createTestUser({ username: name });
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  await prisma.steamLink.create({ data: { user_id: u.id, steam_id: `steam-${u.id}`, persona: name } });
  users.push(u);
  roles.set(u.id, role);
  return u;
}

const asUser = (u: TestUser) => ({ auth_token: app.jwt.sign({ sub: u.id, username: u.username, role: roles.get(u.id) ?? 'USER' }) });

let tokenSeq = 0;
const click = (u: TestUser, customId: string): Interaction => ({
  type: 3,
  token: `cancel-tok${++tokenSeq}`,
  application_id: 'app',
  data: { custom_id: customId },
  user: { id: u.discord_id },
  message: { id: 'alert', channel_id: `dm-${u.discord_id}` },
});

/** A match with both factions revealed, so the battle can have been played. */
async function matchAtBattle(format: 'BO1' | 'BO3' = 'BO1') {
  const a = await player(`cancel_a_${Math.random().toString(36).slice(2, 7)}`);
  const b = await player(`cancel_b_${Math.random().toString(36).slice(2, 7)}`);
  const { matchId } = await createOpenPlayMatch(prisma, a.id, b.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', format);
  await reveal(matchId, 1);
  return { a, b, matchId };
}

async function reveal(matchId: string, gameNumber: number) {
  const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId, game_number: gameNumber } });
  const factions = await prisma.faction.findMany({ take: 2, select: { id: true } });
  await prisma.matchBlindPick.update({
    where: { game_id: game.id },
    data: { player1_faction_id: factions[0]!.id, player2_faction_id: factions[1]!.id, player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date() },
  });
  return game;
}

const cancel = (u: TestUser, matchId: string) =>
  app.inject({ method: 'POST', url: `/api/open-play/matches/${matchId}/cancel`, cookies: asUser(u), payload: {} });

function replayFile(): Buffer {
  // A minimal ESF replay (signature + timestamp): enough for the upload checks.
  const replay = Buffer.alloc(64);
  replay[0] = 0xcb;
  replay[1] = 0xab;
  replay.writeUInt32LE(Math.floor(Date.now() / 1000), 8);
  return replay;
}

const report = (u: TestUser, matchId: string, winnerId: string, gameNumber = 1) => {
  const { payload, headers } = replayMultipart(winnerId, 'battle.replay', replayFile());
  return app.inject({ method: 'POST', url: `/api/matches/${matchId}/games/${gameNumber}/result`, cookies: asUser(u), payload, headers });
};

beforeAll(async () => {
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  vi.stubGlobal('fetch', discordFetch);
  app = await buildApp({ withSocket: false, withRedis: true, withCron: false, withGraphql: false, withDraft: false });
  savedRollout = (await prisma.adminConfig.findUnique({ where: { key: ROLLOUT_CONFIG_KEY } }))?.value;
  await prisma.adminConfig.upsert({
    where: { key: ROLLOUT_CONFIG_KEY },
    create: { key: ROLLOUT_CONFIG_KEY, value: { live: true, testerDiscordIds: [] } as never },
    update: { value: { live: true, testerDiscordIds: [] } as never },
  });
});

afterEach(async () => {
  const ids = users.map((u) => u.id);
  const matches = await prisma.match.findMany({ where: { type: 'OPEN_PLAY', OR: [{ player1_id: { in: ids } }, { player2_id: { in: ids } }] }, select: { id: true } });
  await Promise.all(matches.map((m) => app.redis.del(`rizzotto:dop:cancelalert:${m.id}`)));
  await prisma.matchGame.deleteMany({ where: { match_id: { in: matches.map((m) => m.id) } } });
  await prisma.match.deleteMany({ where: { id: { in: matches.map((m) => m.id) } } });
  await prisma.queueActivityLog.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actor_id: { in: ids } } });
  await prisma.botMessage.deleteMany({ where: { target_id: { in: users.map((u) => u.discord_id) } } });
  await cleanupUsers(ids);
  users = [];
  calls = [];
});

afterAll(async () => {
  if (savedRollout === undefined) await prisma.adminConfig.deleteMany({ where: { key: ROLLOUT_CONFIG_KEY } });
  else await prisma.adminConfig.update({ where: { key: ROLLOUT_CONFIG_KEY }, data: { value: savedRollout as never } });
  await app.close();
  vi.unstubAllGlobals();
});

describe('cancelling', () => {
  it('keeps the match as a cancelled outcome and records who did it', async () => {
    const { a, matchId } = await matchAtBattle();
    expect((await cancel(a, matchId)).statusCode).toBe(200);

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('CANCELLED');
    expect(match.deleted_at).toBeNull();
    expect(match.cancelled_by_id).toBe(a.id);
    expect(match.cancelled_slot).toBe(a.id);
    expect(match.cancelled_at).toBeInstanceOf(Date);

    const games = await app.inject({ method: 'GET', url: `/api/matches/${matchId}/games`, cookies: asUser(a) });
    expect(games.json()).toMatchObject({ cancelledBy: a.username, cancelledSlot: a.id });
    expect(games.json().lateReportUntil).toBeTruthy();
  });

  it('tells the opponent at once when the battle may have been played, not before', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    await vi.waitFor(() => expect(anyDmContaining(b, 'report the result')).toBe(true), { timeout: 5000, interval: 50 });
    expect(dmsTo(a)).toHaveLength(0);

    const c = await player(`cancel_c_${Math.random().toString(36).slice(2, 7)}`);
    const d = await player(`cancel_d_${Math.random().toString(36).slice(2, 7)}`);
    const { matchId: early } = await createOpenPlayMatch(prisma, c.id, d.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', 'BO1');
    await cancel(c, early);
    await new Promise((r) => setTimeout(r, 200));
    expect(dmsTo(d)).toHaveLength(0);
  });

  it('offers the report on the card of the other side only', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    const theirs = (await renderMatchCard(app, matchId, b.id))!;
    expect(theirs.content).toContain(`${a.username} cancelled this match`);
    expect(JSON.stringify(theirs.components)).toContain(`mc_won:${matchId}:1`);
    const mine = (await renderMatchCard(app, matchId, a.id))!;
    expect(mine.content).toContain('You cancelled this match');
    expect(JSON.stringify(mine.components)).not.toContain('mc_won');
  });

  it('opens no late report after a no-show timeout or a staff cancel', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancelOpenPlayMatch(app, { id: matchId, player1_id: a.id, player2_id: b.id });
    expect((await report(b, matchId, b.id)).statusCode).toBe(422);
  });
});

describe('the late report', () => {
  it('counts as a normal result and completes the match', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    const res = await report(b, matchId, b.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ confirmed: true });

    const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId } });
    expect(game).toMatchObject({ status: 'COMPLETED', winner_id: b.id, counts_for_leaderboard: true });
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match).toMatchObject({ status: 'COMPLETED', winner_id: b.id, cancelled_by_id: a.id });
  });

  it('is closed to the player who cancelled', async () => {
    const { a, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    const res = await report(a, matchId, a.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('You cancelled');
  });

  it('closes after the window', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    await prisma.match.update({ where: { id: matchId }, data: { cancelled_at: new Date(Date.now() - LATE_REPORT_WINDOW_MS - 1000) } });
    const res = await report(b, matchId, b.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain('An admin can still add');
  });

  it('needs a game that got to the battle', async () => {
    const a = await player(`cancel_a_${Math.random().toString(36).slice(2, 7)}`);
    const b = await player(`cancel_b_${Math.random().toString(36).slice(2, 7)}`);
    const { matchId } = await createOpenPlayMatch(prisma, a.id, b.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', 'BO1');
    await cancel(a, matchId);
    expect((await report(b, matchId, b.id)).statusCode).toBe(422);
    // No game row may appear for a number that never existed either.
    expect((await report(b, matchId, b.id, 2)).statusCode).toBe(422);
    expect(await prisma.matchGame.count({ where: { match_id: matchId } })).toBe(1);
  });

  it('counts the game of a cancelled series without starting the next one', async () => {
    const { a, b, matchId } = await matchAtBattle('BO3');
    await cancel(a, matchId);
    expect((await report(b, matchId, b.id)).statusCode).toBe(200);

    const games = await prisma.matchGame.findMany({ where: { match_id: matchId } });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ status: 'COMPLETED', winner_id: b.id });
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe('CANCELLED');
  });

  it('never counts by waiting when its replay does not match', async () => {
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    const game = await prisma.matchGame.findFirstOrThrow({ where: { match_id: matchId } });
    await prisma.matchGame.update({
      where: { id: game.id },
      data: { status: 'PENDING', reported_winner_id: b.id, reporter_id: b.id, reported_at: new Date(Date.now() - 3600_000), counts_for_leaderboard: true, verification: { issues: [{ type: 'map', message: 'wrong map' }] } },
    });
    await autoConfirmExpiredGameResults(app);
    expect((await prisma.matchGame.findUniqueOrThrow({ where: { id: game.id } })).status).toBe('PENDING');
  });
});

describe('the admin alert', () => {
  async function reportedLoss() {
    const admin = await player(`cancel_admin_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const other = await player(`cancel_admin2_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    await report(b, matchId, b.id);
    await vi.waitFor(() => expect(anyDmContaining(admin, 'Cancelled after losing')).toBe(true), { timeout: 5000, interval: 50 });
    await vi.waitFor(() => expect(anyDmContaining(other, 'Cancelled after losing')).toBe(true), { timeout: 5000, interval: 50 });
    await vi.waitFor(async () => {
      expect(await app.redis.hlen(`rizzotto:dop:cancelalert:${matchId}`)).toBeGreaterThanOrEqual(4); // body, links, 2 DMs
    }, { timeout: 5000, interval: 50 });
    return { admin, other, a, b, matchId };
  }

  it('goes to every admin with the ban option, naming both players', async () => {
    const { admin, a, b, matchId } = await reportedLoss();
    const dm = dmsTo(admin).find((c) => String(c.body.content).includes('Cancelled after losing'))!;
    expect(dm.body.content).toContain(a.username);
    expect(dm.body.content).toContain(b.username);
    expect(JSON.stringify(dm.body.components)).toContain(`ca_ban:${matchId}`);
    expect(JSON.stringify(dm.body.components)).toContain(`ca_no:${matchId}`);
    // Nothing happens to the player until an admin decides.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deleted_at).toBeNull();
    expect(dmsTo(a).some((c) => String(c.body.content).includes('banned'))).toBe(false);
  });

  it('stays quiet when the report says the player who cancelled won', async () => {
    const admin = await player(`cancel_admin_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    expect((await report(b, matchId, a.id)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(anyDmContaining(admin, 'Cancelled after losing')).toBe(false);
  });

  it('only lets admins press the buttons', async () => {
    const { b, a, matchId } = await reportedLoss();
    const res = (await handleOpenPlayInteraction(app, click(b, `ca_banyes:${matchId}`))) as { data: { content: string } };
    expect(res.data.content).toContain('Only admins');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deleted_at).toBeNull();
  });

  it('a ban locks the player, tells him why with every admin linked, and closes it for all admins', async () => {
    const { admin, other, a, b, matchId } = await reportedLoss();
    const confirm = (await handleOpenPlayInteraction(app, click(admin, `ca_ban:${matchId}`))) as { data: { components: object[] } };
    expect(JSON.stringify(confirm.data.components)).toContain(`ca_banyes:${matchId}`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deleted_at).toBeNull();

    await handleOpenPlayInteraction(app, click(admin, `ca_banyes:${matchId}`));
    await vi.waitFor(() => expect(anyDmContaining(a, 'You have been banned')).toBe(true), { timeout: 5000, interval: 50 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deleted_at).toBeInstanceOf(Date);

    const notice = dmsTo(a).find((c) => String(c.body.content).includes('You have been banned'))!;
    expect(notice.body.content).toContain('unsportsmanlike');
    expect(notice.body.content).toContain(b.username);
    for (const adm of [admin, other]) {
      expect(notice.body.content).toContain(`<@${adm.discord_id}>`);
      expect(notice.body.allowed_mentions?.users).toContain(adm.discord_id);
    }

    await vi.waitFor(() => {
      const closed = calls.filter((c) => c.method === 'PATCH' && String(c.body.content).includes('banned'));
      expect(closed.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 5000, interval: 50 });
    const audit = await prisma.auditLog.findFirst({ where: { entity_id: a.id, action: 'BAN' } });
    expect(audit?.actor_id).toBe(admin.id);
  });

  it('a second decision changes nothing', async () => {
    const { admin, other, a, matchId } = await reportedLoss();
    await handleOpenPlayInteraction(app, click(admin, `ca_no:${matchId}`));
    await vi.waitFor(async () => {
      expect(await app.redis.hget(`rizzotto:dop:cancelalert:${matchId}`, 'outcome')).toContain('decided against');
    }, { timeout: 5000, interval: 50 });

    const late = click(other, `ca_banyes:${matchId}`);
    await handleOpenPlayInteraction(app, late);
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes(`/webhooks/app/${late.token}`))).toBe(true), { timeout: 5000, interval: 50 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deleted_at).toBeNull();
    expect(anyDmContaining(a, 'You have been banned')).toBe(false);
  });
});

describe('an admin adding the result', () => {
  it('lists the cancelled game for staff only, then a winner makes it count', async () => {
    const admin = await player(`cancel_admin_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);

    const anon = await app.inject({ method: 'GET', url: '/api/meta/games?cancelled=1' });
    expect(anon.statusCode).toBe(401);
    const asPlayer = await app.inject({ method: 'GET', url: '/api/meta/games?cancelled=1', cookies: asUser(b) });
    expect(asPlayer.statusCode).toBe(403);

    const list = await app.inject({ method: 'GET', url: `/api/meta/games?cancelled=1&q=${a.username}`, cookies: asUser(admin) });
    expect(list.statusCode).toBe(200);
    const row = list.json().games.find((g: { matchId: string }) => g.matchId === matchId);
    expect(row).toMatchObject({ cancelledBy: a.username, winnerId: null });
    expect(row.player1FactionId).toBeTruthy();
    expect(row.playedAt).toBeTruthy();

    // The public list is unchanged until there is a result.
    const before = await app.inject({ method: 'GET', url: `/api/meta/games?q=${a.username}` });
    expect(before.json().total).toBe(0);

    const added = await app.inject({ method: 'PATCH', url: `/api/matches/${matchId}/games/1`, cookies: asUser(admin), payload: { winnerId: b.id } });
    expect(added.statusCode).toBe(200);
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match).toMatchObject({ status: 'COMPLETED', winner_id: b.id });
    const after = await app.inject({ method: 'GET', url: `/api/meta/games?q=${a.username}` });
    expect(after.json().total).toBe(1);
    const gone = await app.inject({ method: 'GET', url: `/api/meta/games?cancelled=1&q=${a.username}`, cookies: asUser(admin) });
    expect(gone.json().total).toBe(0);
  });

  it('works long after the window and still asks the admins about the player', async () => {
    const admin = await player(`cancel_admin_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const { a, b, matchId } = await matchAtBattle();
    await cancel(a, matchId);
    await prisma.match.update({ where: { id: matchId }, data: { cancelled_at: new Date(Date.now() - 30 * 24 * 3600_000) } });
    const added = await app.inject({ method: 'PATCH', url: `/api/matches/${matchId}/games/1`, cookies: asUser(admin), payload: { winnerId: b.id } });
    expect(added.statusCode).toBe(200);
    await vi.waitFor(() => expect(anyDmContaining(admin, 'An admin then added')).toBe(true), { timeout: 5000, interval: 50 });
  });

  it('refuses a game that never got to the battle, and anything but a winner', async () => {
    const admin = await player(`cancel_admin_${Math.random().toString(36).slice(2, 7)}`, 'ADMIN');
    const a = await player(`cancel_a_${Math.random().toString(36).slice(2, 7)}`);
    const b = await player(`cancel_b_${Math.random().toString(36).slice(2, 7)}`);
    const { matchId } = await createOpenPlayMatch(prisma, a.id, b.id, 'QUEUE', 'DOMINATION', 'ONE_V_ONE', 'BO1');
    await cancel(a, matchId);
    const never = await app.inject({ method: 'PATCH', url: `/api/matches/${matchId}/games/1`, cookies: asUser(admin), payload: { winnerId: b.id } });
    expect(never.statusCode).toBe(422);

    const revealed = await matchAtBattle();
    await cancel(revealed.a, revealed.matchId);
    const noWinner = await app.inject({ method: 'PATCH', url: `/api/matches/${revealed.matchId}/games/1`, cookies: asUser(admin), payload: { countsForLeaderboard: true } });
    expect(noWinner.statusCode).toBe(422);
  });
});
