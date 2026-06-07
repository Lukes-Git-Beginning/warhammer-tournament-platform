import fp from 'fastify-plugin';
import cron from 'node-cron';
import { takeFactionsSnapshot } from '../lib/faction-snapshot.js';
import { notifyCheckInReminder } from '../lib/discord-notify.js';
import { autoConfirmExpiredGameResults } from '../lib/match-games.js';
import { autoResolveStaleBlindPicks } from '../lib/blind-pick-auto-resolve.js';

declare module 'fastify' {
  interface FastifyInstance {
    cronTasks?: cron.ScheduledTask[];
  }
}

// In-memory set to ensure check-in reminders are only sent once per tournament per day.
// Resets on server restart (acceptable — worst case a duplicate DM).
const remindedTournamentIds = new Set<string>();

export default fp(
  async (fastify) => {
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
            if (!remindedTournamentIds.has(tournament.id)) {
              remindedTournamentIds.add(tournament.id);
              fastify.log.info(
                { tournamentId: tournament.id, slug: tournament.slug },
                'Sending check-in reminder',
              );

              await notifyCheckInReminder(tournament).catch((err) => {
                fastify.log.warn({ err, tournamentId: tournament.id }, 'Check-in reminder failed');
              });

              // Audit log entry for idempotency record
              await fastify.prisma.auditLog
                .create({
                  data: {
                    entity_type: 'Tournament',
                    entity_id: tournament.slug,
                    action: 'checkin_reminder_sent',
                    actor_id: null,
                    new_value: { sent_at: now.toISOString() },
                  },
                })
                .catch(() => {
                  /* non-fatal */
                });
            }
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

    fastify.decorate('cronTasks', [snapshotTask, checkinTask, gameConfirmTask, blindPickTask]);

    fastify.addHook('onClose', async () => {
      snapshotTask.stop();
      checkinTask.stop();
      gameConfirmTask.stop();
      blindPickTask.stop();
    });
  },
  { name: 'cron', dependencies: ['db'] },
);
