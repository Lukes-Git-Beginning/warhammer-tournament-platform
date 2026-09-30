/**
 * One-off: re-send the qualifier invites that failed with HTTP 429 during the
 * `wednesday-wars-by-rtk-4` incident (2026-09-30), now that discordRequest() paces + retries.
 *
 * Reads the failed set straight from the BotMessage log (DM / FAILED / http_429 for this invite,
 * on the incident day) and re-sends each via sendDm — which now goes through the rate-limited
 * queue, so the re-send itself is paced and won't 429. Anyone who already received a SENT copy of
 * the same invite is skipped, so nobody is DM'd twice. Idempotent-ish: a second dry run shows the
 * same set; after a successful --send those recipients have a SENT row and drop out of the failed
 * re-send set on any later run.
 *
 * Run ON THE SERVER (needs the prod DATABASE_URL + DISCORD_BOT_TOKEN from the backend env):
 *   Dry run (default — prints who it would message, sends nothing):
 *     pnpm -F @rizzotto/backend exec tsx scripts/resend-failed-wednesday-wars-invites.ts
 *   Actually send:
 *     pnpm -F @rizzotto/backend exec tsx scripts/resend-failed-wednesday-wars-invites.ts --send
 */
import { prisma } from '@rizzotto/db';
import { sendDm } from '../src/lib/discord-notify.js';

const SEND = process.argv.includes('--send');
// Discriminators for the incident batch: the invite marker (series name in the header), the 429
// failure detail (only this large field hit the limit), and the incident day.
const CONTENT_MARKER = 'Wednesday Wars';
const FROM = new Date('2026-09-30T00:00:00.000Z');
const TO = new Date('2026-10-01T00:00:00.000Z');

async function main(): Promise<void> {
  const failed = await prisma.botMessage.findMany({
    where: {
      target_type: 'DM',
      status: 'FAILED',
      detail: 'http_429',
      content: { contains: CONTENT_MARKER },
      created_at: { gte: FROM, lt: TO },
    },
    orderBy: { created_at: 'asc' },
    select: { target_id: true, content: true, created_at: true },
  });

  // Anyone who already got a SENT copy of the same invite → never re-send (no duplicates).
  const sent = await prisma.botMessage.findMany({
    where: {
      target_type: 'DM',
      status: 'SENT',
      content: { contains: CONTENT_MARKER },
      created_at: { gte: FROM, lt: TO },
    },
    select: { target_id: true },
  });
  const alreadySent = new Set(sent.map((s) => s.target_id));

  // Dedupe failed recipients; drop any that already received it.
  const byRecipient = new Map<string, string>(); // discordId -> the exact content to re-send
  for (const row of failed) {
    if (alreadySent.has(row.target_id)) continue;
    if (!byRecipient.has(row.target_id)) byRecipient.set(row.target_id, row.content);
  }
  const recipients = [...byRecipient.entries()];

  console.log(
    `Failed http_429 rows: ${failed.length} | already-SENT recipients: ${alreadySent.size} | to re-send: ${recipients.length}`,
  );
  if (recipients.length) {
    console.log('Recipients (discord id):', recipients.map(([id]) => id).join(', '));
    console.log('Content preview:', recipients[0][1].slice(0, 200).replace(/\n/g, ' '));
  }

  if (!SEND) {
    console.log('\nDRY RUN — nothing sent. Re-run with --send to deliver.');
    return;
  }
  if (!recipients.length) {
    console.log('\nNothing to re-send.');
    return;
  }

  let attempted = 0;
  for (const [discordId, content] of recipients) {
    attempted++;
    try {
      await sendDm(discordId, content); // paced + 429-retried + logged via the queue
    } catch (err) {
      console.warn(`  sendDm threw for ${discordId}:`, (err as Error).message);
    }
  }
  console.log(
    `\nDone. Attempted ${attempted}. Confirm the final SENT/SKIPPED status in the Bot Message log (Admin).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
