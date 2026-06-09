import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply } from 'fastify';
import type { JwtPayload, Role } from '@rizzotto/types';
import { cached } from '../lib/cache.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAuthCookie: (reply: FastifyReply, payload: JwtPayload) => void;
    clearAuthCookie: (reply: FastifyReply) => void;
    requireRole: (
      ...roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSteamLink: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(
  async (fastify) => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set and at least 32 chars long');
    }

    const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
    const cookieDomain = process.env.JWT_COOKIE_DOMAIN ?? 'localhost';
    const expiresInSec = Number(process.env.JWT_EXPIRES_IN ?? 604800);
    const isProd = process.env.NODE_ENV === 'production';

    await fastify.register(fastifyCookie);
    await fastify.register(fastifyJwt, {
      secret,
      cookie: { cookieName, signed: false },
      sign: { expiresIn: `${expiresInSec}s` },
    });

    fastify.decorate('authenticate', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid auth token',
          statusCode: 401,
        });
      }
    });

    fastify.decorate('requireRole', (...roles: Role[]) => async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Not authenticated',
          statusCode: 401,
        });
      }

      const userId = request.user.sub;
      const cacheKey = `user:role:${userId}`;
      const redis = fastify.hasDecorator('redis')
        ? (fastify as unknown as { redis: import('ioredis').Redis }).redis
        : undefined;

      let role: Role | null;
      try {
        role = await cached<Role | null>(
          redis,
          cacheKey,
          async () => {
            const dbUser = await fastify.prisma.user.findUnique({
              where: { id: userId, deleted_at: null },
              select: { role: true },
            });
            return dbUser ? (dbUser.role as Role) : null;
          },
          { ttlSeconds: 60 },
        );
      } catch {
        return reply.code(500).send({
          error: 'InternalServerError',
          message: 'Failed to verify role',
          statusCode: 500,
        });
      }

      if (role === null) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'User not found or deleted',
          statusCode: 401,
        });
      }

      if (!roles.includes(role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: `Required role: ${roles.join(' or ')}`,
          statusCode: 403,
        });
      }
    });

    fastify.decorate('signAuthCookie', (reply, payload) => {
      const token = fastify.jwt.sign(payload);
      reply.setCookie(cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        domain: cookieDomain,
        maxAge: expiresInSec,
      });
    });

    fastify.decorate('clearAuthCookie', (reply) => {
      reply.clearCookie(cookieName, { path: '/', domain: cookieDomain });
    });

    // requireSteamLink: applied selectively to routes that need Steam linking.
    // Must be used AFTER authenticate (needs request.user).
    fastify.decorate('requireSteamLink', async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Not authenticated',
          statusCode: 401,
        });
      }

      const steamLink = await fastify.prisma.steamLink.findUnique({
        where: { user_id: request.user.sub },
        select: { user_id: true },
      });

      if (!steamLink) {
        return reply.code(403).send({
          error: 'Forbidden',
          code: 'STEAM_REQUIRED',
          message: 'Connect Steam to continue',
          statusCode: 403,
        });
      }
    });
  },
  { name: 'auth', dependencies: [] },
);
