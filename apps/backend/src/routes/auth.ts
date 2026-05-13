import type { FastifyPluginAsync } from 'fastify';
import fastifyOauth2 from '@fastify/oauth2';
import type { Role, JwtPayload } from '@tww3/types';

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USERINFO_URL = 'https://discord.com/api/users/@me';

interface DiscordUserinfo {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const scopeStr = process.env.DISCORD_SCOPES ?? 'identify email';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI must be set',
    );
  }

  await fastify.register(fastifyOauth2, {
    name: 'discordOAuth2',
    scope: scopeStr.split(/\s+/).filter(Boolean),
    credentials: {
      client: { id: clientId, secret: clientSecret },
      auth: {
        authorizeHost: 'https://discord.com',
        authorizePath: '/api/oauth2/authorize',
        tokenHost: 'https://discord.com',
        tokenPath: '/api/oauth2/token',
      },
    },
    startRedirectPath: '/auth/discord',
    callbackUri: redirectUri,
  });

  fastify.get('/auth/discord/callback', async (request, reply) => {
    try {
      const tokenResp =
        await fastify.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenResp.token.access_token;

      const userinfoResp = await fetch(DISCORD_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userinfoResp.ok) {
        request.log.error(
          { status: userinfoResp.status },
          'discord userinfo failed',
        );
        return reply.code(502).send({
          error: 'BadGateway',
          message: 'Discord userinfo unreachable',
          statusCode: 502,
        });
      }
      const profile = (await userinfoResp.json()) as DiscordUserinfo;

      const avatarUrl = profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null;

      const displayName = profile.global_name ?? profile.username;

      const user = await fastify.prisma.user.upsert({
        where: { discord_id: profile.id },
        create: {
          discord_id: profile.id,
          username: displayName,
          email: profile.email ?? null,
          avatar_url: avatarUrl,
          last_login: new Date(),
        },
        update: {
          username: displayName,
          email: profile.email ?? null,
          avatar_url: avatarUrl,
          last_login: new Date(),
        },
        select: { id: true, discord_id: true, username: true, role: true },
      });

      const payload: JwtPayload = {
        sub: user.id,
        discord_id: user.discord_id,
        username: user.username,
        role: user.role as Role,
      };
      fastify.signAuthCookie(reply, payload);

      return reply.redirect(frontendUrl);
    } catch (err) {
      request.log.error({ err }, 'discord callback failed');
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Discord OAuth exchange failed',
        statusCode: 401,
      });
    }
  });

  fastify.post('/auth/logout', async (_request, reply) => {
    fastify.clearAuthCookie(reply);
    return { ok: true };
  });

  // Test-only: directly issue JWT cookie for a given userId.
  // Guarded by NODE_ENV=test — returns 403 in dev/prod.
  fastify.post('/auth/test-login', async (request, reply) => {
    if (process.env.NODE_ENV !== 'test') {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Test-login endpoint is only available in test environment',
        statusCode: 403,
      });
    }

    const body = request.body as { userId?: string } | undefined;
    if (!body?.userId || typeof body.userId !== 'string') {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'userId is required',
        statusCode: 400,
      });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: body.userId, deleted_at: null },
      select: { id: true, discord_id: true, username: true, role: true },
    });
    if (!user) {
      return reply.code(404).send({
        error: 'NotFound',
        message: 'User not found',
        statusCode: 404,
      });
    }

    const payload: JwtPayload = {
      sub: user.id,
      discord_id: user.discord_id,
      username: user.username,
      role: user.role as Role,
    };
    fastify.signAuthCookie(reply, payload);
    return { ok: true, user };
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    discordOAuth2: {
      getAccessTokenFromAuthorizationCodeFlow: (
        request: import('fastify').FastifyRequest,
      ) => Promise<{ token: { access_token: string; refresh_token?: string } }>;
    };
  }
}

export default authRoutes;
