import 'dotenv/config';
import { buildApp } from './app.js';
import { publishNewChangelogOnBoot } from './lib/changelog-publish.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
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
