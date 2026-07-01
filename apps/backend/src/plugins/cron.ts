import fp from 'fastify-plugin';
import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { takeFactionsSnapshot } from '../lib/faction-snapshot.js';
import { sendDm } from '../lib/discord-notify.js';
import { autoConfirmExpiredGameResults } from '../lib/match-games.js';
import { autoResolveStaleBlindPicks } from '../lib/blind-pick-auto-resolve.js';
import { autoResolveStaleMatrixActions } from '../lib/matrix-auto-resolve.js';
import { startAutoSwiss, advanceAutoSwissRound, repairBrokenAutoSwiss } from '../lib/auto-swiss-service.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';
import { notifyChallengeMatchFound, notifyScheduledMatchReminder, notifyReQueuePrompt } from '../lib/discord-notify.js';

declare module 'fastify' {
  interface FastifyInstance {
    cronTasks?: cron.ScheduledTask[];
  }
}

const remindedMatchupIds = new Set<string>();

// Check-in reminder dedup key: rizzotto:checkin-reminded:<tournamentId>:<userId>
// TTL 4 h — covers the check-in window (1 h) with a large safety margin.
const CHECKIN_REMINDER_TTL = 4 * 60 * 60; // seconds

async function sendPerUserCheckInReminders(
  fastify: FastifyInstance,
  tournament: { id: string; name: string; slug: string; start_date: Date },
  now: Date,
): Promise<void> {
  const participants = await fastify.prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournament.id, status: 'REGISTERED', deleted_at: null },
    select: { user: { select: { id: true, discord_id: true } } },
  });
  if (participants.length === 0) return;

  const startTs = Math.floor(tournament.start_date.getTime() / 1000);
  const message =
    `**[RizzOtto's Arena] Check-in Reminder: ${tournament.name}**\n\n` +
    `The tournament starts <t:${startTs}:R>. ` +
    `Please check in at ${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug} before the start time!`;

  for (const { user } of participants) {
    const redisKey = `rizzotto:checkin-reminded:${tournament.id}:${user.id}`;
    try {
      const alreadySent = fastify.redis ? await fastify.redis.get(redisKey) : null;
      if (alreadySent) continue;
      await sendDm(user.discord_id, message).catch(() => {});
      if (fastify.redis) {
        await fastify.redis.set(redisKey, '1', 'EX', CHECKIN_REMINDER_TTL).catch(() => {});
      }
      fastify.log.info({ tournamentId: tournament.id, userId: user.id }, 'Check-in reminder sent');
    } catch {
      // non-fatal per-user failure
    }
  }
}

export default fp(
  async (fastify) => {

    // Pre-populate matchup reminder ids to avoid duplicate DMs after restart.
    const alreadyRemindedMatchups = await fastify.prisma.auditLog.findMany({
      where: { action: 'matchup_reminder_sent' },
      select: { entity_id: true },
    });
    alreadyRemindedMatchups.forEach(({ entity_id }) => remindedMatchupIds.add(entity_id));

    // -----------------------------------------------------------------------
    // Startup repair: fix ONGOING tournaments stuck due to wrong format at
    // creation time (e.g. SINGLE_ELIMINATION instead of AUTO_SWISS).
    // Idempotent — skips any tournament that already has playoff matches.
    // -----------------------------------------------------------------------
    await repairBrokenAutoSwiss(fastify.prisma).catch((err) =>
      fastify.log.error({ err }, 'repairBrokenAutoSwiss startup check failed'),
    );

    // -----------------------------------------------------------------------
    // Daily faction stats snapshot — 00:05 UTC
    // -----------------------------------------------------------------------
    const snapshotTask = cron.schedule(
      '5 0 * * *',
      async () => {
        fastify.log.info('Running daily faction stats snapshot');
        try {
          const count = await takeFactionsSnapshot(fastify.prisma);
          fastify.log.info({ count }, 'Faction snapshot completed');
        } catch (err) {
          fastify.log.error({ err }, 'Faction snapshot failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Check-in window transitions — every 5 minutes
    //
    // For tournaments with status=ANNOUNCED (mapped to REGISTRATION_CLOSED in
    // the current schema) and start_date within the next hour:
    //   - Send check-in reminder DMs once per tournament.
    //
    // For tournaments where start_date has passed:
    //   - Transition status to ONGOING (i.e. LIVE).
    // -----------------------------------------------------------------------
    const checkinTask = cron.schedule(
      '*/5 * * * *',
      async () => {
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

        try {
          // Tournaments entering check-in window (start_date between now and now+1h)
          const upcomingTournaments = await fastify.prisma.tournament.findMany({
            where: {
              status: 'REGISTRATION_CLOSED', // announced state
              start_date: {
                gt: now,
                lte: oneHourFromNow,
              },
              deleted_at: null,
            },
            select: { id: true, name: true, slug: true, start_date: true },
          });

          for (const tournament of upcomingTournaments) {
            await sendPerUserCheckInReminders(fastify, tournament, now);
          }

          // Tournaments that have started — transition REGISTRATION_CLOSED → ONGOING
          const startedTournaments = await fastify.prisma.tournament.findMany({
            where: {
              status: 'REGISTRATION_CLOSED',
              start_date: { lte: now },
              deleted_at: null,
            },
            select: { id: true, name: true, slug: true },
          });

          for (const tournament of startedTournaments) {
            fastify.log.info(
              { tournamentId: tournament.id, slug: tournament.slug },
              'Auto-transitioning tournament to ONGOING',
            );
            await fastify.prisma.tournament
              .update({
                where: { id: tournament.id },
                data: { status: 'ONGOING' },
              })
              .catch((err) => {
                fastify.log.warn({ err, tournamentId: tournament.id }, 'Auto-transition failed');
              });

            await fastify.prisma.auditLog
              .create({
                data: {
                  entity_type: 'Tournament',
                  entity_id: tournament.slug,
                  action: 'auto_status_transition',
                  actor_id: null,
                  old_value: { status: 'REGISTRATION_CLOSED' },
                  new_value: { status: 'ONGOING' },
                },
              })
              .catch(() => {
                /* non-fatal */
              });
          }
        } catch (err) {
          fastify.log.error({ err }, 'Check-in cron job failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Auto-confirm provisional game results — every minute
    // -----------------------------------------------------------------------
    const gameConfirmTask = cron.schedule(
      '*/1 * * * *',
      async () => {
        try {
          const count = await autoConfirmExpiredGameResults(fastify);
          if (count > 0) {
            fastify.log.info({ count }, 'Auto-confirmed expired game results');
          }
        } catch (err) {
          fastify.log.error({ err }, 'Auto-confirm cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Auto-resolve stale blind picks — every minute
    // If one player locked their faction but the opponent hasn't responded
    // within 2 minutes, a random faction is assigned and the pick is revealed.
    // -----------------------------------------------------------------------
    const blindPickTask = cron.schedule(
      '*/1 * * * *',
      async () => {
        try {
          const count = await autoResolveStaleBlindPicks(fastify);
          if (count > 0) {
            fastify.log.info({ count }, 'Auto-resolved stale blind picks');
          }
        } catch (err) {
          fastify.log.error({ err }, 'Blind-pick auto-resolve cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Expire open ScheduledMatchups past their expiry date — every 15 min.
    // Runs frequently so short-lived (30-min) challenges expire promptly.
    // -----------------------------------------------------------------------
    const matchupExpiryTask = cron.schedule(
      '*/15 * * * *',
      async () => {
        try {
          const { count } = await fastify.prisma.scheduledMatchup.updateMany({
            where: { status: 'OPEN', expires_at: { lt: new Date() } },
            data: { status: 'EXPIRED' },
          });
          if (count > 0) {
            fastify.log.info({ count }, 'Expired stale scheduled matchups');
          }
        } catch (err) {
          fastify.log.error({ err }, 'Matchup expiry cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Queue cleanup — every 15 min: remove entries older than 30 min from Redis
    // -----------------------------------------------------------------------
    const queueCleanupTask = cron.schedule(
      '*/15 * * * *',
      async () => {
        if (!fastify.redis) return;
        try {
          const key = 'rizzotto:queue:open_play';
          const joinedAtKey = 'rizzotto:queue:open_play:joined_at';
          const items = await fastify.redis.lrange(key, 0, -1);
          const cutoffMs = Date.now() - 30 * 60 * 1000;
          for (const userId of items) {
            const joinedAt = await fastify.redis.hget(joinedAtKey, userId);
            // Evict when in the queue for 30+ min, or when the join time is unknown
            // (orphaned entry, e.g. from before this timestamp tracking existed).
            if (joinedAt === null || Number(joinedAt) < cutoffMs) {
              await fastify.redis.lrem(key, 0, userId);
              await fastify.redis.hdel(joinedAtKey, userId);
            }
          }
        } catch (err) {
          fastify.log.error({ err }, 'Queue cleanup cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Re-queue reminder — every 30 min: DM queued players who have been idle
    // for 25–30 min (about to be cleaned up) to ask if they're still available.
    // -----------------------------------------------------------------------
    const reQueueReminderTask = cron.schedule(
      '*/30 * * * *',
      async () => {
        if (!fastify.redis) return;
        try {
          const key = 'rizzotto:queue:open_play';
          const joinedAtKey = 'rizzotto:queue:open_play:joined_at';
          const items = await fastify.redis.lrange(key, 0, -1);
          const now = Date.now();
          const lowerMs = now - 30 * 60 * 1000; // joined 30 min ago
          const upperMs = now - 25 * 60 * 1000; // joined 25 min ago
          for (const userId of items) {
            const joinedAt = await fastify.redis.hget(joinedAtKey, userId);
            if (joinedAt === null) continue;
            const t = Number(joinedAt);
            if (t >= lowerMs && t < upperMs) {
              const user = await fastify.prisma.user.findUnique({
                where: { id: userId },
                select: { discord_id: true },
              });
              if (user) await notifyReQueuePrompt(user.discord_id).catch(() => {});
            }
          }
        } catch (err) {
          fastify.log.error({ err }, 'Re-queue reminder cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Cancel abandoned open-play matches — hourly at :15.
    // Open-play (ladder/challenge) matches go ONGOING immediately but have no
    // built-in timeout: if neither player ever reports a result, the match sits
    // ONGOING forever and keeps showing up as an "active ladder match". After
    // STALE_OPEN_PLAY_HOURS without resolution we cancel it as a safety net.
    // -----------------------------------------------------------------------
    const STALE_OPEN_PLAY_HOURS = 24;
    const staleOpenPlayTask = cron.schedule(
      '15 * * * *',
      async () => {
        try {
          const cutoff = new Date(Date.now() - STALE_OPEN_PLAY_HOURS * 60 * 60 * 1000);
          const { count } = await fastify.prisma.match.updateMany({
            where: {
              type: 'OPEN_PLAY',
              status: 'ONGOING',
              deleted_at: null,
              created_at: { lt: cutoff },
            },
            data: { status: 'CANCELLED' },
          });
          if (count > 0) {
            fastify.log.info({ count }, 'Cancelled abandoned open-play matches');
          }
        } catch (err) {
          fastify.log.error({ err }, 'Stale open-play cancel cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Auto Swiss — check-in opener + starter + round progression
    // Runs every minute. Handles three phases:
    //   1. OPEN_REGISTRATION → REGISTRATION_CLOSED (1h before start_date)
    //   2. REGISTRATION_CLOSED → ONGOING at start_date (starts tournament + round 1)
    //   3. ONGOING → advance rounds when current round is complete
    // -----------------------------------------------------------------------
    const autoSwissTask = cron.schedule('* * * * *', async () => {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      try {
        // Phase 1: open check-in 1h before start
        // Emergency fix: reopen any AUTO_SWISS stuck in REGISTRATION_CLOSED before start_date
        // (registration stays open until start_date — closing it early was a bug)
        const stuckTournaments = await fastify.prisma.tournament.findMany({
          where: { format: 'AUTO_SWISS', status: 'REGISTRATION_CLOSED', start_date: { gt: now }, deleted_at: null },
          select: { id: true },
        });
        for (const t of stuckTournaments) {
          await fastify.prisma.tournament.update({ where: { id: t.id }, data: { status: 'OPEN_REGISTRATION' } });
          fastify.log.info({ tournamentId: t.id }, 'Auto Swiss: reopened registration (was closed early)');
        }

        // Check-in reminder at start_date - 1h (no status change — registration stays open)
        const reminderTournaments = await fastify.prisma.tournament.findMany({
          where: {
            format: 'AUTO_SWISS',
            status: 'OPEN_REGISTRATION',
            start_date: { gt: now, lte: oneHourFromNow },
            deleted_at: null,
          },
          select: { id: true, name: true, slug: true, start_date: true },
        });
        for (const t of reminderTournaments) {
          await sendPerUserCheckInReminders(fastify, t, now);
        }

        // Phase 2: start tournament at start_date (registration was open until now)
        const startingTournaments = await fastify.prisma.tournament.findMany({
          where: {
            format: 'AUTO_SWISS',
            status: 'OPEN_REGISTRATION',
            start_date: { lte: now },
            deleted_at: null,
          },
          select: { id: true },
        });
        for (const t of startingTournaments) {
          fastify.log.info({ tournamentId: t.id }, 'Auto Swiss: starting tournament');
          await startAutoSwiss(fastify.prisma, t.id).catch((err) =>
            fastify.log.error({ err, tournamentId: t.id }, 'Auto Swiss start failed'),
          );
        }

        // Phase 3: advance rounds for ongoing tournaments
        const ongoingTournaments = await fastify.prisma.tournament.findMany({
          where: { format: 'AUTO_SWISS', status: 'ONGOING', deleted_at: null },
          select: { id: true },
        });
        for (const t of ongoingTournaments) {
          await advanceAutoSwissRound(fastify.prisma, t.id).catch((err) =>
            fastify.log.error({ err, tournamentId: t.id }, 'Auto Swiss advance failed'),
          );
        }
      } catch (err) {
        fastify.log.error({ err }, 'autoSwissTask failed');
      }
    });

    // -----------------------------------------------------------------------
    // Matrix auto-resolve — every 15 seconds via setInterval
    // Ban/pick timeout is 15s, too short for node-cron (1-minute resolution).
    // -----------------------------------------------------------------------
    const matrixInterval = setInterval(async () => {
      try {
        const count = await autoResolveStaleMatrixActions(fastify);
        if (count > 0) {
          fastify.log.info({ count }, 'Matrix auto-resolve ran');
        }
      } catch (err) {
        fastify.log.error({ err }, 'Matrix auto-resolve failed');
      }
    }, 15_000);

    // -----------------------------------------------------------------------
    // Scheduled matchup reminder — every 5 minutes
    // Sends a "1 hour to go" DM with a ready-check button to both players of
    // ACCEPTED challenges whose proposed_at is within the next hour.
    // -----------------------------------------------------------------------
    const matchupReminderTask = cron.schedule('*/5 * * * *', async () => {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      try {
        const upcoming = await fastify.prisma.scheduledMatchup.findMany({
          where: {
            status: 'ACCEPTED',
            match_id: null,
            proposed_at: { gt: now, lte: oneHourFromNow },
          },
          include: {
            proposer: { select: { id: true, username: true, discord_id: true } },
            accepted_by: { select: { id: true, username: true, discord_id: true } },
          },
        });

        for (const matchup of upcoming) {
          if (remindedMatchupIds.has(matchup.id)) continue;
          if (!matchup.proposer.discord_id || !matchup.accepted_by?.discord_id) continue;

          remindedMatchupIds.add(matchup.id);

          await notifyScheduledMatchReminder(
            matchup.id,
            matchup.proposed_at,
            matchup.format,
            { discordId: matchup.proposer.discord_id, username: matchup.proposer.username },
            { discordId: matchup.accepted_by.discord_id, username: matchup.accepted_by.username },
          ).catch((err) => {
            fastify.log.warn({ err, matchupId: matchup.id }, 'Matchup reminder failed');
          });

          await fastify.prisma.auditLog.create({
            data: {
              entity_type: 'ScheduledMatchup',
              entity_id: matchup.id,
              action: 'matchup_reminder_sent',
              actor_id: matchup.proposer_id,
              new_value: { proposed_at: matchup.proposed_at.toISOString() },
            },
          }).catch(() => { /* non-critical */ });

          fastify.log.info({ matchupId: matchup.id }, 'Sent scheduled matchup 1h reminder');
        }
      } catch (err) {
        fastify.log.error({ err }, 'Matchup reminder cron failed');
      }
    }, { timezone: 'UTC' });

    // -----------------------------------------------------------------------
    // Scheduled matchup activation — every minute
    // Creates the Open Play match for ACCEPTED challenges whose proposed_at
    // has arrived. Match creation is deferred until play time so faction picks
    // cannot start before the scheduled date.
    // -----------------------------------------------------------------------
    const scheduledMatchupActivationTask = cron.schedule('* * * * *', async () => {
      const now = new Date();
      try {
        const dueMatchups = await fastify.prisma.scheduledMatchup.findMany({
          where: { status: 'ACCEPTED', match_id: null, proposed_at: { lte: now } },
          include: {
            proposer: { select: { id: true, username: true, discord_id: true } },
          },
        });

        for (const matchup of dueMatchups) {
          if (!matchup.accepted_by_id) continue;
          try {
            const { matchId, mapName } = await createOpenPlayMatch(
              fastify.prisma,
              matchup.proposer_id,
              matchup.accepted_by_id,
              'CHALLENGE',
            );

            await fastify.prisma.scheduledMatchup.update({
              where: { id: matchup.id },
              data: { match_id: matchId },
            });

            const acceptor = await fastify.prisma.user.findUnique({
              where: { id: matchup.accepted_by_id },
              select: { username: true, discord_id: true },
            });

            if (acceptor?.discord_id) {
              setImmediate(() => void notifyChallengeMatchFound(
                matchId,
                matchup.format,
                { discordId: matchup.proposer.discord_id, username: matchup.proposer.username },
                { discordId: acceptor.discord_id!, username: acceptor.username },
                mapName,
              ));
            }

            fastify.log.info({ matchupId: matchup.id, matchId }, 'Scheduled matchup activated');
          } catch (err) {
            fastify.log.error({ err, matchupId: matchup.id }, 'Failed to activate scheduled matchup');
          }
        }
      } catch (err) {
        fastify.log.error({ err }, 'Scheduled matchup activation cron failed');
      }
    }, { timezone: 'UTC' });

    fastify.decorate('cronTasks', [snapshotTask, checkinTask, gameConfirmTask, blindPickTask, matchupExpiryTask, queueCleanupTask, reQueueReminderTask, staleOpenPlayTask, autoSwissTask, matchupReminderTask, scheduledMatchupActivationTask]);

    fastify.addHook('onClose', async () => {
      snapshotTask.stop();
      checkinTask.stop();
      gameConfirmTask.stop();
      blindPickTask.stop();
      matchupExpiryTask.stop();
      queueCleanupTask.stop();
      reQueueReminderTask.stop();
      staleOpenPlayTask.stop();
      autoSwissTask.stop();
      matchupReminderTask.stop();
      scheduledMatchupActivationTask.stop();
      clearInterval(matrixInterval);
    });
  },
  { name: 'cron', dependencies: ['db'] },
);
