import type { FastifyPluginAsync } from 'fastify';
import fastifyOauth2 from '@fastify/oauth2';
import type { Role, JwtPayload } from '@rizzotto/types';

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USERINFO_URL = 'https://discord.com/api/users/@me';

// ---------------------------------------------------------------------------
// Steam OpenID 2.0 constants
// ---------------------------------------------------------------------------
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_OPENID_NS = 'http://specs.openid.net/auth/2.0';
const STEAM_CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

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

  // -------------------------------------------------------------------------
  // Steam OpenID 2.0 — Manual implementation (no passport, no openid package)
  //
  // Flow:
  //   1. GET /auth/steam/login?return_to=...
  //      Build OpenID checkid_setup request, redirect to Steam.
  //   2. Steam redirects back to GET /auth/steam/return?...
  //      Verify signature via check_authentication mode.
  //      Extract Steam ID from claimed_id.
  //      Persist SteamLink, redirect to return_to or frontend root.
  // -------------------------------------------------------------------------

  const steamReturnUrl =
    process.env.STEAM_OPENID_RETURN_URL ?? `http://localhost:3000/auth/steam/return`;

  fastify.get('/auth/steam/login', async (request, reply) => {
    const { return_to } = request.query as { return_to?: string };

    const params = new URLSearchParams({
      'openid.ns': STEAM_OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': steamReturnUrl,
      'openid.realm': new URL(steamReturnUrl).origin,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });

    // Encode return_to in the return URL so the callback can redirect back
    const redirectUrl = new URL(steamReturnUrl);
    if (return_to) {
      redirectUrl.searchParams.set('app_return_to', return_to);
      params.set('openid.return_to', redirectUrl.toString());
    }

    return reply.redirect(`${STEAM_OPENID_ENDPOINT}?${params.toString()}`);
  });

  fastify.get('/auth/steam/return', async (request, reply) => {
    const query = request.query as Record<string, string>;

    // Verify with Steam: check_authentication mode
    const verifyParams = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (k === 'app_return_to') continue; // our custom param, not part of OpenID
      verifyParams.set(k, v);
    }
    verifyParams.set('openid.mode', 'check_authentication');

    let verifyText: string;
    try {
      const verifyResp = await fetch(STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: verifyParams.toString(),
      });
      verifyText = await verifyResp.text();
    } catch (err) {
      request.log.error({ err }, 'Steam OpenID verify request failed');
      return reply.code(502).send({
        error: 'BadGateway',
        message: 'Could not verify Steam identity',
        statusCode: 502,
      });
    }

    if (!verifyText.includes('is_valid:true')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Steam OpenID signature verification failed',
        statusCode: 401,
      });
    }

    const claimedId = query['openid.claimed_id'] ?? '';
    const match = STEAM_CLAIMED_ID_PATTERN.exec(claimedId);
    if (!match) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'Invalid Steam claimed_id format',
        statusCode: 400,
      });
    }

    const steamId = match[1] as string;

    // User must be authenticated (JWT cookie present) to link Steam
    try {
      await request.jwtVerify();
    } catch {
      // Redirect to login if not authenticated
      return reply.redirect(`${frontendUrl}/login?steam_pending=1`);
    }

    const userId = request.user.sub;

    // Optionally fetch Steam profile via Web API
    let persona = `Steam User ${steamId}`;
    let avatarUrl: string | null = null;
    let profileUrl: string | null = `https://steamcommunity.com/profiles/${steamId}`;

    const steamApiKey = process.env.STEAM_WEB_API_KEY;
    if (steamApiKey) {
      try {
        const profileResp = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${steamId}`,
        );
        if (profileResp.ok) {
          const profileData = (await profileResp.json()) as {
            response: {
              players: Array<{
                personaname?: string;
                avatarfull?: string;
                profileurl?: string;
              }>;
            };
          };
          const player = profileData.response.players[0];
          if (player) {
            persona = player.personaname ?? persona;
            avatarUrl = player.avatarfull ?? null;
            profileUrl = player.profileurl ?? profileUrl;
          }
        }
      } catch (err) {
        request.log.warn({ err }, 'Steam Web API profile fetch failed (non-fatal)');
      }
    }

    // Persist SteamLink (upsert — user may re-link)
    await fastify.prisma.steamLink.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        steam_id: steamId,
        persona,
        avatar_url: avatarUrl,
        profile_url: profileUrl,
        verified_at: new Date(),
      },
      update: {
        steam_id: steamId,
        persona,
        avatar_url: avatarUrl,
        profile_url: profileUrl,
        verified_at: new Date(),
      },
    });

    request.log.info({ userId, steamId }, 'Steam account linked');

    const appReturnTo = query['app_return_to'];
    const redirectTarget =
      appReturnTo && appReturnTo.startsWith('/') ? `${frontendUrl}${appReturnTo}` : frontendUrl;

    return reply.redirect(redirectTarget);
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
