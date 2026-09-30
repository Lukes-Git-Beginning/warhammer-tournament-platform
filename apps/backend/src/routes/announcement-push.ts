import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  AnnouncementDraftPushSchema,
  parseAnnouncementDrafts,
  pushTokenMatches,
  ANNOUNCEMENT_DRAFTS_CONFIG_KEY,
  ANNOUNCEMENT_PUSH_TOKEN_HASH_KEY,
} from '../lib/announcements.js';
import { sendDm } from '../lib/discord-notify.js';

/**
 * Token-authed draft push. A Claude Code session writes the finished, polished
 * per-destination announcements here using the scoped push token (X-Push-Token).
 *
 * Deliberately OUTSIDE the admin-JWT scope: the token is the only credential and
 * it can do exactly one thing — store announcement drafts (no cost, no other
 * admin power). Drafts land in AdminConfig and surface in the Admin tab with a
 * Copy button per destination.
 */
const announcementPushRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/announcements/push', async (request, reply) => {
    const presented = (request.headers['x-push-token'] as string | undefined)?.trim();
    if (!presented) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Missing push token', statusCode: 401 });
    }

    const tokenRow = await fastify.prisma.adminConfig.findUnique({
      where: { key: ANNOUNCEMENT_PUSH_TOKEN_HASH_KEY },
      select: { value: true },
    });
    const storedHash = typeof tokenRow?.value === 'string' ? tokenRow.value : null;
    if (!pushTokenMatches(presented, storedHash)) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid push token', statusCode: 401 });
    }

    const parsed = AnnouncementDraftPushSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { slug, results } = parsed.data;

    // Only keep drafts for a real tournament (don't accumulate junk slugs).
    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true },
    });
    if (!tournament) {
      return reply.code(404).send({ error: 'NotFound', message: `Tournament "${slug}" not found`, statusCode: 404 });
    }

    const existingRow = await fastify.prisma.adminConfig.findUnique({
      where: { key: ANNOUNCEMENT_DRAFTS_CONFIG_KEY },
      select: { value: true },
    });
    const drafts = parseAnnouncementDrafts(existingRow?.value);
    drafts[slug] = { generatedAt: new Date().toISOString(), results };

    await fastify.prisma.adminConfig.upsert({
      where: { key: ANNOUNCEMENT_DRAFTS_CONFIG_KEY },
      create: { key: ANNOUNCEMENT_DRAFTS_CONFIG_KEY, value: drafts as never, updated_by: 'announcement-push' },
      update: { value: drafts as never, updated_by: 'announcement-push' },
    });

    return { ok: true, slug, count: results.length };
  });

  // POST /api/ops/resend-failed-dms — re-send bot DMs that failed with a Discord rate-limit (429),
  // now that discordRequest() paces + retries. Token-authed (same X-Push-Token as the draft push) so
  // it can be triggered without server/SSH access. Deliberately narrow: recipients + content come
  // ONLY from the BotMessage log (the caller cannot inject either); it re-sends the FAILED http_429
  // DM rows matching `marker` since `sinceIso`, skips anyone who already got a SENT copy (no dupes),
  // and defaults to a DRY RUN (send=false → just report who it would message).
  fastify.post('/api/ops/resend-failed-dms', async (request, reply) => {
    const presented = (request.headers['x-push-token'] as string | undefined)?.trim();
    const tokenRow = await fastify.prisma.adminConfig.findUnique({
      where: { key: ANNOUNCEMENT_PUSH_TOKEN_HASH_KEY },
      select: { value: true },
    });
    const storedHash = typeof tokenRow?.value === 'string' ? tokenRow.value : null;
    if (!presented || !pushTokenMatches(presented, storedHash)) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid push token', statusCode: 401 });
    }

    const parsed = z
      .object({
        marker: z.string().min(4).max(200), // content substring identifying the batch (required)
        sinceIso: z.string().datetime().optional(), // default: 14 days ago
        send: z.boolean().optional().default(false),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { marker, sinceIso, send } = parsed.data;
    const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const failed = await fastify.prisma.botMessage.findMany({
      where: {
        target_type: 'DM',
        status: 'FAILED',
        detail: 'http_429',
        content: { contains: marker },
        created_at: { gte: since },
      },
      orderBy: { created_at: 'asc' },
      select: { target_id: true, content: true },
    });
    const sent = await fastify.prisma.botMessage.findMany({
      where: { target_type: 'DM', status: 'SENT', content: { contains: marker }, created_at: { gte: since } },
      select: { target_id: true },
    });
    const alreadySent = new Set(sent.map((s) => s.target_id));

    const toResend = new Map<string, string>(); // discordId -> exact content to re-send
    for (const row of failed) {
      if (alreadySent.has(row.target_id)) continue;
      if (!toResend.has(row.target_id)) toResend.set(row.target_id, row.content);
    }
    const recipients = [...toResend.keys()];

    if (recipients.length > 300) {
      return reply.code(422).send({ error: 'UnprocessableEntity', message: `Refusing to re-send to ${recipients.length} recipients (>300 safety cap). Narrow the marker/sinceIso.`, statusCode: 422 });
    }

    if (!send) {
      const firstId = recipients[0];
      return {
        dryRun: true,
        failedRows: failed.length,
        alreadySent: alreadySent.size,
        toResend: recipients.length,
        recipients,
        contentPreview: firstId ? (toResend.get(firstId) ?? '').slice(0, 200) : null,
      };
    }

    let attempted = 0;
    for (const [discordId, content] of toResend) {
      attempted++;
      try {
        await sendDm(discordId, content); // paced + 429-retried + logged via the queue
      } catch {
        /* sendDm records its own outcome; never let one failure abort the batch */
      }
    }
    return { dryRun: false, attempted, recipients };
  });
};

export default announcementPushRoutes;
