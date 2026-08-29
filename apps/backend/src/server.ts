import 'dotenv/config';
import { buildApp } from './app.js';
import { publishNewChangelogOnBoot } from './lib/changelog-publish.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

/** app.close() waits on open handles (cron intervals, Socket.IO, live connections). When one of
 *  them refuses to settle, systemd sat through its full 90s TimeoutStopSec before SIGKILL — a
 *  90-second 502 window on every single deploy. Give the graceful path a bounded try, then leave. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const app = await buildApp();

  // Node's default for an unhandled rejection is to kill the process, and the codebase has plenty
  // of deliberate fire-and-forget work (notifications, background ticks). Without these handlers
  // such a death is silent: no stack, nothing in the journal, nothing to debug afterwards. Log it
  // as fatal and exit deliberately — systemd restarts us within seconds (see deploy/systemd/).
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'unhandled promise rejection — exiting');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaught exception — exiting');
    process.exit(1);
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    const guard = setTimeout(() => {
      app.log.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'graceful shutdown timed out — exiting anyway');
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    guard.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: PORT, host: HOST });
    // Fire-and-forget: RizzBOTto auto-publishes any CHANGELOG versions added since the last
    // deploy to the Discord changelog channel. Never blocks or fails startup.
    void publishNewChangelogOnBoot(app.prisma, app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
