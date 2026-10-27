/**
 * One-time site notices: the Arena Mod release notice goes to players who aren't on the RizzOttoverse
 * Discord server, until they dismiss it. CI has no bot token, so membership is unknown there unless the
 * user row already carries a fresh answer. Requires real PostgreSQL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';
import { createTestUser, cleanupUsers } from './helpers/db-fixtures.js';
import { flagDiscordInvites } from '../src/lib/discord-invite.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const createdUserIds: string[] = [];
afterEach(async () => {
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdUserIds.length = 0;
});

async function userWithToken(data: { discord_member?: boolean; discord_member_checked_at?: Date } = {}) {
  const u = await createTestUser();
  createdUserIds.push(u.id);
  if (Object.keys(data).length) await prisma.user.update({ where: { id: u.id }, data });
  return { id: u.id, token: app.jwt.sign({ sub: u.id, username: u.username, role: 'USER' }) };
}

const notices = async (token: string) =>
  (await app.inject({ method: 'GET', url: '/api/users/me/notices', cookies: { auth_token: token } })).json<{ notices: string[] }>().notices;

describe('site notices', () => {
  it('shows the release notice when membership is unknown, and hides it once dismissed', async () => {
    const { token } = await userWithToken();
    expect(await notices(token)).toEqual(['arena-mod-release']);

    const res = await app.inject({ method: 'POST', url: '/api/users/me/notices/arena-mod-release/dismiss', cookies: { auth_token: token } });
    expect(res.statusCode).toBe(200);
    expect(await notices(token)).toEqual([]);
  });

  it('skips the notice for a known member of the Discord server', async () => {
    const { token } = await userWithToken({ discord_member: true, discord_member_checked_at: new Date() });
    expect(await notices(token)).toEqual([]);
  });

  it('shows it to a known non-member', async () => {
    const { token } = await userWithToken({ discord_member: false, discord_member_checked_at: new Date() });
    expect(await notices(token)).toEqual(['arena-mod-release']);
  });

  it('rejects dismissing an unknown notice', async () => {
    const { token } = await userWithToken();
    const res = await app.inject({ method: 'POST', url: '/api/users/me/notices/nope/dismiss', cookies: { auth_token: token } });
    expect(res.statusCode).toBe(400);
  });
});

describe('weekly Discord prompt', () => {
  async function withSteam(id: string) {
    await prisma.steamLink.create({
      data: { user_id: id, steam_id: `7656119${id.replace(/-/g, '').slice(0, 10)}`, persona: 'p', verified_at: new Date() },
    });
  }

  it('the weekly check flags registered players who are not on the server, and only them', async () => {
    const away = await createTestUser();
    const member = await createTestUser();
    const unknown = await createTestUser();
    const noSteam = await createTestUser();
    createdUserIds.push(away.id, member.id, unknown.id, noSteam.id);
    await Promise.all([withSteam(away.id), withSteam(member.id), withSteam(unknown.id)]);
    await prisma.user.update({ where: { id: member.id }, data: { discord_invite_due_at: new Date(0) } });

    const answers = new Map([
      [away.discord_id, false],
      [member.discord_id, true],
      [noSteam.discord_id, false],
    ]);
    // Everyone else in the DB answers "unknown", so the run leaves them untouched.
    await flagDiscordInvites(prisma, async (id) => answers.get(id) ?? null);

    const due = async (id: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { id }, select: { discord_invite_due_at: true } })).discord_invite_due_at;
    expect(await due(away.id)).not.toBeNull();
    expect(await due(member.id)).toBeNull(); // on the server: a pending prompt is dropped
    expect(await due(unknown.id)).toBeNull(); // the bot couldn't tell: no prompt
    expect(await due(noSteam.id)).toBeNull(); // not fully registered
  });

  it('shows the prompt while it is due, and clicking it away clears it until the next check', async () => {
    const { id, token } = await userWithToken();
    await prisma.user.update({ where: { id }, data: { discord_invite_due_at: new Date(), dismissed_notices: ['arena-mod-release'] } });
    expect(await notices(token)).toEqual(['discord-invite']);

    const res = await app.inject({ method: 'POST', url: '/api/users/me/notices/discord-invite/dismiss', cookies: { auth_token: token } });
    expect(res.statusCode).toBe(200);
    expect(await notices(token)).toEqual([]);
    const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { dismissed_notices: true } });
    expect(row.dismissed_notices).not.toContain('discord-invite'); // not for good: next week asks again
  });

  it("drops the prompt for a player who joined the server since the check", async () => {
    const { id, token } = await userWithToken({ discord_member: true, discord_member_checked_at: new Date() });
    await prisma.user.update({ where: { id }, data: { discord_invite_due_at: new Date() } });
    expect(await notices(token)).toEqual([]);
  });
});
