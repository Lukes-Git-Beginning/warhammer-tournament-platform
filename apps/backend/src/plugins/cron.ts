import fp from 'fastify-plugin';
import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { takeFactionsSnapshot } from '../lib/faction-snapshot.js';
import { sendDm } from '../lib/discord-notify.js';
import { autoConfirmExpiredGameResults } from '../lib/match-games.js';
import { autoResolveStaleBlindPicks } from '../lib/blind-pick-auto-resolve.js';
import { autoResolveStaleMatrixActions } from '../lib/matrix-auto-resolve.js';
import { advanceAutoSwissRound } from '../lib/auto-swiss-service.js';
import { createOpenPlayMatch } from '../lib/create-open-play-match.js';
import { notifyChallengeMatchFound, notifyScheduledMatchReminder, notifyReQueuePrompt } from '../lib/discord-notify.js';
import { runMatchmakingTick } from '../lib/matchmaking-tick.js';
import { reconcileBalancedTournaments } from '../lib/balanced-liechtenstein-service.js';
import { getSupporterRoleConfig, refreshSupporterFromDiscord } from '../lib/supporter-service.js';
import { syncKofiGoal } from '../lib/kofi-goal-sync.js';

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
    // Check-in reminders — every 5 minutes
    //
    // For every tournament whose start_date is within the next hour, DM each
    // still-REGISTERED (not-yet-checked-in) participant a check-in reminder, once
    // (Redis-deduped). Fires in BOTH OPEN_REGISTRATION and REGISTRATION_CLOSED:
    // hosts keep registration open until start to take last-minute entries, so a
    // "closed only" reminder would in practice never fire for the manual formats.
    //
    // #49: tournaments are NEVER auto-started — no auto REGISTRATION_CLOSED → ONGOING.
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
              // Remind whether registration is still open or already closed — hosts
              // almost always leave it open until start (last-minute entries welcome).
              status: { in: ['OPEN_REGISTRATION', 'REGISTRATION_CLOSED'] },
              start_date: {
                gt: now,
                lte: oneHourFromNow,
              },
              deleted_at: null,
            },
            select: { id: true, name: true, slug: true, start_date: true },
          });

          for (const tournament of upcomingTournaments) {
            await sendPerUserCheckInReminders(fastify, tournament);
          }

          // #49: tournaments are NEVER auto-started. The host closes registration and
          // starts the tournament manually — no automation triggers those transitions
          // (there's often still something to fix pre-start). Round/playoff advancement
          // AFTER a manual start still runs (see autoSwissTask / auto_advance).
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
    // Auto Swiss — post-start round progression.
    // Runs every minute. #49: NO auto close-registration / auto-start — the host does
    // those manually; this only advances rounds once a manually-started tournament's
    // current round is complete. (Check-in reminders live in checkinTask, all formats.)
    // -----------------------------------------------------------------------
    const autoSwissTask = cron.schedule('* * * * *', async () => {
      try {
        // #49: no auto close-registration / auto-start / auto-reopen — the host does
        // those manually. Check-in reminders are handled for every format (open OR
        // closed registration) by checkinTask above; this task only advances rounds.

        // Advance rounds for ongoing tournaments — AUTO_SWISS, plus any
        // format that opted into auto-advancement (#37).
        const ongoingTournaments = await fastify.prisma.tournament.findMany({
          where: {
            OR: [{ format: 'AUTO_SWISS' }, { auto_advance: true }],
            status: 'ONGOING',
            deleted_at: null,
          },
          select: { id: true },
        });
        for (const t of ongoingTournaments) {
          await advanceAutoSwissRound(fastify.prisma, t.id, fastify.redis).catch((err) =>
            fastify.log.error({ err, tournamentId: t.id }, 'Auto Swiss advance failed'),
          );
        }
      } catch (err) {
        fastify.log.error({ err }, 'autoSwissTask failed');
      }
    });

    // -----------------------------------------------------------------------
    // Balanced Liechtenstein reconciler — every minute.
    // Safety net for the pairing/playoff triggers: runs an (idempotent, lock-guarded)
    // pairing tick on every ONGOING Balanced Liechtenstein tournament, so a missed trigger
    // (manual field edit, a burst of withdrawals, a forfeit path that didn't fire) cannot
    // leave a finished field un-paired or its per-division playoffs un-generated. Mid-round
    // it is a cheap no-op.
    // -----------------------------------------------------------------------
    const baliReconcileTask = cron.schedule(
      '* * * * *',
      async () => {
        try {
          const count = await reconcileBalancedTournaments(fastify);
          if (count > 0) {
            fastify.log.debug({ count }, 'BaLi reconciler ticked ongoing tournaments');
          }
        } catch (err) {
          fastify.log.error({ err }, 'BaLi reconciler cron failed');
        }
      },
      { timezone: 'UTC' },
    );

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
    // Open Play matchmaking tick — every 10 seconds via setInterval.
    // Fallback for the hour roll-over (fresh availability slots become active)
    // and for FIFO-matching two waiting players once the 60s hold expires with
    // no new event. Event triggers (join, match end, live availability) handle
    // the common case immediately; this is the safety net.
    // -----------------------------------------------------------------------
    const matchmakingInterval = setInterval(async () => {
      try {
        await runMatchmakingTick(fastify);
      } catch (err) {
        fastify.log.error({ err }, 'Matchmaking tick failed');
      }
    }, 10_000);

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

    // -----------------------------------------------------------------------
    // Daily supporter tier refresh — 03:30 UTC
    // Re-reads each Discord-linked user's guild roles and re-derives their supporter
    // tiers, so a role granted/removed in Discord (e.g. Ko-Fi's monthly Lord role) is
    // reflected even without a fresh login. Fail-safe: skips entirely when no role IDs
    // are configured, and refreshSupporterFromDiscord is a no-op when Discord is
    // unreachable, so it can never wipe existing state.
    // -----------------------------------------------------------------------
    const supporterRefreshTask = cron.schedule(
      '30 3 * * *',
      async () => {
        try {
          const cfg = await getSupporterRoleConfig(fastify.prisma);
          if (!cfg.supporterRoleId && !cfg.lordRoleId && !cfg.championRoleId) return; // nothing to sync
          // Every active (non-deleted) user has a Discord id — deleted_at already excludes
          // the anonymized/tombstoned accounts, so no discord_id filter is needed.
          const users = await fastify.prisma.user.findMany({
            where: { deleted_at: null },
            select: { id: true, discord_id: true },
          });
          let synced = 0;
          for (const u of users) {
            if (!u.discord_id) continue;
            try {
              await refreshSupporterFromDiscord(fastify.prisma, u.id, u.discord_id, cfg);
              synced++;
            } catch (err) {
              fastify.log.error({ err, userId: u.id }, 'Supporter refresh failed for user');
            }
            // Throttle to stay well under Discord's per-route rate limit.
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          fastify.log.info({ synced, total: users.length }, 'Daily supporter refresh completed');
        } catch (err) {
          fastify.log.error({ err }, 'Supporter refresh cron failed');
        }
      },
      { timezone: 'UTC' },
    );

    // -----------------------------------------------------------------------
    // Ko-Fi funding goal sync — every 30 min.
    // Scrapes the public Ko-Fi page's goal (percentage + target, server-rendered
    // with stable ids) and mirrors it into the funding_goal AdminConfig so the
    // on-site progress bar tracks Ko-Fi automatically. Fail-safe: any fetch/parse
    // error leaves the current value untouched. See lib/kofi-goal-sync.ts.
    // -----------------------------------------------------------------------
    const kofiGoalSyncTask = cron.schedule(
      '*/30 * * * *',
      async () => {
        try {
          await syncKofiGoal(fastify.prisma, fastify.log);
        } catch (err) {
          fastify.log.error({ err }, 'Ko-Fi goal sync cron failed');
        }
      },
      { timezone: 'UTC' },
    );
    // Run once on boot so the bar is accurate right after a deploy (fire-and-forget).
    void syncKofiGoal(fastify.prisma, fastify.log).catch(() => {});

    fastify.decorate('cronTasks', [snapshotTask, checkinTask, gameConfirmTask, blindPickTask, matchupExpiryTask, queueCleanupTask, reQueueReminderTask, staleOpenPlayTask, autoSwissTask, baliReconcileTask, matchupReminderTask, scheduledMatchupActivationTask, supporterRefreshTask, kofiGoalSyncTask]);

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
      baliReconcileTask.stop();
      matchupReminderTask.stop();
      scheduledMatchupActivationTask.stop();
      supporterRefreshTask.stop();
      kofiGoalSyncTask.stop();
      clearInterval(matrixInterval);
      clearInterval(matchmakingInterval);
    });
  },
  { name: 'cron', dependencies: ['db'] },
);
