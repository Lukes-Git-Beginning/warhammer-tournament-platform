import Fastify, { type FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';
import socketPlugin from './plugins/socket.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import tournamentRoutes from './routes/tournaments.js';
import participantRoutes from './routes/participants.js';
import matchRoutes from './routes/matches.js';
import bracketRoutes from './routes/bracket.js';

export interface BuildAppOptions {
  /** Skip socket plugin during unit tests (avoids redis adapter init). */
  withSocket?: boolean;
  /** Skip redis entirely (only valid when withSocket=false). */
  withRedis?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { withSocket = true, withRedis = true } = opts;
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
    },
    trustProxy: isProd,
  });

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });
  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(dbPlugin);
  if (withRedis) await app.register(redisPlugin);
  await app.register(authPlugin);
  if (withSocket) await app.register(socketPlugin);

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(tournamentRoutes);
  await app.register(participantRoutes);
  await app.register(matchRoutes);
  await app.register(bracketRoutes);

  app.get('/health', async () => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  }));

  return app;
}
