import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { REPLAY_DIR } from './lib/replays.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';
import socketPlugin from './plugins/socket.js';
import cronPlugin from './plugins/cron.js';
import draftPlugin from './plugins/draft.js';
import graphqlPlugin from './plugins/graphql.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import tournamentRoutes from './routes/tournaments.js';
import participantRoutes from './routes/participants.js';
import matchRoutes from './routes/matches.js';
import seasonRoutes from './routes/seasons.js';
import bracketRoutes from './routes/bracket.js';
import leaderboardRoutes from './routes/leaderboard.js';
import ratingRoutes from './routes/rating.js';
import factionsRoutes from './routes/factions.js';
import metaRoutes from './routes/meta.js';
import draftPresetRoutes from './routes/draft-presets.js';
import draftRoutes from './routes/drafts.js';
import adminRoutes from './routes/admin.js';
import armyListsRoutes from './routes/army-lists.js';
import tournamentLifecycleRoutes from './routes/tournament-lifecycle.js';
import matchReportsRoutes from './routes/match-reports.js';
import mapsRoutes from './routes/maps.js';
import matchDecisionRoutes from './routes/match-decision.js';
import factionMatrixRoutes from './routes/faction-matrix.js';
import matchGamesRoutes, { openPlayReplayRoutes } from './routes/match-games.js';
import tournamentArmyListsRoutes from './routes/tournament-army-lists.js';
import tournamentPosterRoutes from './routes/tournament-poster.js';
import openPlayQueueRoutes from './routes/open-play-queue.js';
import availabilityRoutes from './routes/availability.js';
import scheduledMatchupsRoutes from './routes/scheduled-matchups.js';
import discordInteractionsRoutes from './routes/discord-interactions.js';
import activeMatchesRoutes from './routes/active-matches.js';
import skillRoutes from './routes/skill.js';

export interface BuildAppOptions {
  /** Skip socket plugin during unit tests (avoids redis adapter init). */
  withSocket?: boolean;
  /** Skip redis entirely (only valid when withSocket=false). */
  withRedis?: boolean;
  /** Skip cron plugin during tests (default true in production). */
  withCron?: boolean;
  /** Register the /graphql mercurius endpoint (default true). */
  withGraphql?: boolean;
  /** Register the DraftService plugin (default true, requires redis). */
  withDraft?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const {
    withSocket = true,
    withRedis = true,
    withCron = true,
    withGraphql = true,
    withDraft = true,
  } = opts;
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

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
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB
  // Replays are written to REPLAY_DIR (REPLAY_UPLOAD_DIR in prod — a persistent
  // path outside the repo checkout). They must be served from that exact path,
  // not from cwd/uploads, or the static server can't find them and the SPA
  // fallback serves index.html instead. Register the more specific
  // /uploads/replays/ prefix before the general /uploads/ one.
  await app.register(fastifyStatic, {
    root: REPLAY_DIR,
    prefix: '/uploads/replays/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  });
  await app.register(fastifyCors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });
  await app.register(fastifyRateLimit, {
    // The E2E suite runs from a single CI IP and live-draft polls heavily, so
    // the production limit would 429 concurrent tests. Effectively lift it under
    // NODE_ENV=test; production (and dev) keep the real 300/min ceiling.
    max: isTest ? 100_000 : 300,
    timeWindow: '1 minute',
  });

  await app.register(dbPlugin);
  if (withRedis) await app.register(redisPlugin);
  await app.register(authPlugin);
  if (withDraft && withRedis) await app.register(draftPlugin);
  if (withSocket) await app.register(socketPlugin);
  if (withCron) await app.register(cronPlugin);

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(tournamentRoutes);
  await app.register(participantRoutes);
  await app.register(matchRoutes);
  await app.register(seasonRoutes);
  await app.register(bracketRoutes);
  await app.register(leaderboardRoutes);
  await app.register(ratingRoutes);
  await app.register(factionsRoutes);
  await app.register(metaRoutes);
  await app.register(draftPresetRoutes);
  await app.register(draftRoutes);
  await app.register(adminRoutes);
  await app.register(armyListsRoutes);
  await app.register(tournamentLifecycleRoutes);
  await app.register(matchReportsRoutes);
  await app.register(mapsRoutes);
  await app.register(matchDecisionRoutes);
  await app.register(factionMatrixRoutes);
  await app.register(matchGamesRoutes);
  await app.register(openPlayReplayRoutes);
  await app.register(tournamentArmyListsRoutes);
  await app.register(tournamentPosterRoutes);
  await app.register(openPlayQueueRoutes);
  await app.register(availabilityRoutes);
  await app.register(scheduledMatchupsRoutes);
  await app.register(discordInteractionsRoutes);
  await app.register(activeMatchesRoutes);
  await app.register(skillRoutes);
  if (withGraphql) await app.register(graphqlPlugin);

  app.get('/health', async () => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  }));

  return app;
}
