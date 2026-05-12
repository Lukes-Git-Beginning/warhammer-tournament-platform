import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@tww3/db';

const DISCORD_USER = {
  id: '999000111222333444',
  username: 'testorga',
  global_name: 'Test Organizer',
  email: 'test@example.org',
  avatar: 'abcdef0123456789abcdef0123456789',
};

const msw = setupServer(
  http.post('https://discord.com/api/oauth2/token', () =>
    HttpResponse.json({
      access_token: 'mock_access_token',
      token_type: 'Bearer',
      expires_in: 604800,
      refresh_token: 'mock_refresh_token',
      scope: 'identify email',
    }),
  ),
  http.get('https://discord.com/api/users/@me', () => HttpResponse.json(DISCORD_USER)),
);

let app: FastifyInstance;

beforeAll(async () => {
  msw.listen({ onUnhandledRequest: 'bypass' });
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  msw.close();
  await prisma.$disconnect();
});

afterEach(() => msw.resetHandlers());

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { discord_id: DISCORD_USER.id } });
});

describe('Discord OAuth callback', () => {
  it('returns 302 to discord.com on /auth/discord', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/discord' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize/);
    expect(res.headers.location).toContain('client_id=');
  });

  it('upserts user, sets auth cookie and redirects on callback', async () => {
    const initial = await app.inject({ method: 'GET', url: '/auth/discord' });
    const stateCookie = initial.cookies.find((c) => c.name === 'oauth2-redirect-state');
    expect(stateCookie).toBeDefined();
    const location = new URL(initial.headers.location as string);
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/discord/callback?code=fake_code&state=${state}`,
      cookies: { 'oauth2-redirect-state': stateCookie!.value },
    });

    expect(callback.statusCode).toBe(302);
    const authCookie = callback.cookies.find((c) => c.name === 'auth_token');
    expect(authCookie).toBeDefined();
    expect(authCookie!.value.length).toBeGreaterThan(40);

    const dbUser = await prisma.user.findUnique({ where: { discord_id: DISCORD_USER.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.username).toBe(DISCORD_USER.global_name);
    expect(dbUser!.email).toBe(DISCORD_USER.email);
    expect(dbUser!.avatar_url).toContain(DISCORD_USER.id);
    expect(dbUser!.last_login).not.toBeNull();
  });

  it('GET /api/users/me returns 401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/users/me returns user with cookie', async () => {
    const created = await prisma.user.create({
      data: {
        discord_id: DISCORD_USER.id,
        username: DISCORD_USER.global_name,
        email: DISCORD_USER.email,
      },
      select: { id: true, discord_id: true, username: true, role: true },
    });
    const token = app.jwt.sign({
      sub: created.id,
      discord_id: created.discord_id,
      username: created.username,
      role: created.role,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      cookies: { auth_token: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; username: string; email: string | null };
    expect(body.id).toBe(created.id);
    expect(body.email).toBe(DISCORD_USER.email);
  });

  it('POST /auth/logout clears the auth cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === 'auth_token');
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe('');
  });
});
