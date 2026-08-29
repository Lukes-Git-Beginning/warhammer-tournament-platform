import type { FastifyPluginAsync } from 'fastify';
import {
  AnnouncementDraftPushSchema,
  parseAnnouncementDrafts,
  pushTokenMatches,
  ANNOUNCEMENT_DRAFTS_CONFIG_KEY,
  ANNOUNCEMENT_PUSH_TOKEN_HASH_KEY,
} from '../lib/announcements.js';

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
};

export default announcementPushRoutes;
