// ---------------------------------------------------------------------------
// Supporter recognition routes (Ko-Fi). See plans/kofi-and-supporters.md.
//
//   GET  /api/supporters                        — public list for the /support page
//   GET  /api/admin/supporters/search?q=        — admin: find users to manage
//   PUT  /api/admin/supporters/:userId          — admin: set the manual override (checkboxes)
//   GET  /api/admin/supporters/role-config      — admin: read the Discord role-ID mapping
//   PUT  /api/admin/supporters/role-config      — admin: set the Discord role-ID mapping
//
// Effective tier = Discord-synced OR admin override (cumulative). See lib/supporter-status.ts.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listSupporters,
  setSupporterOverride,
  effectiveTiersOf,
  getSupporterRoleConfig,
  SUPPORTER_ROLE_CONFIG_KEY,
} from '../lib/supporter-service.js';

const SUPPORTER_FLAG_SELECT = {
  supporter_discord: true,
  lord_discord: true,
  champion_discord: true,
  supporter_manual: true,
  lord_manual: true,
  champion_manual: true,
} as const;

const tiersBody = z.object({ supporter: z.boolean(), lord: z.boolean(), champion: z.boolean() });
const roleConfigBody = z.object({
  supporterRoleId: z.string().nullable().optional(),
  lordRoleId: z.string().nullable().optional(),
  championRoleId: z.string().nullable().optional(),
});

const supporterRoutes: FastifyPluginAsync = async (fastify) => {
  // Public: everyone with any effective supporter tier, for the /support page.
  fastify.get('/api/supporters', async () => ({ supporters: await listSupporters(fastify.prisma) }));

  const adminGuard = { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'MODERATOR')] };

  // Admin: search users by username to manage their supporter status.
  fastify.get('/api/admin/supporters/search', adminGuard, async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(1).max(100) }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: 'q is required', statusCode: 400 });
    }
    const rows = await fastify.prisma.user.findMany({
      where: { deleted_at: null, username: { contains: parsed.data.q, mode: 'insensitive' } },
      select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
      take: 25,
      orderBy: { username: 'asc' },
    });
    return {
      users: rows.map((u) => ({
        userId: u.id,
        username: u.username,
        avatarUrl: u.avatar_url,
        discord: { supporter: u.supporter_discord, lord: u.lord_discord, champion: u.champion_discord },
        manual: { supporter: u.supporter_manual, lord: u.lord_manual, champion: u.champion_manual },
        effective: effectiveTiersOf(u),
      })),
    };
  });

  // Admin: set the manual override (the checkboxes) for one user.
  fastify.put('/api/admin/supporters/:userId', adminGuard, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = tiersBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const user = await fastify.prisma.user.findFirst({ where: { id: userId, deleted_at: null }, select: { id: true } });
    if (!user) {
      return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
    }
    await setSupporterOverride(fastify.prisma, userId, parsed.data);
    const updated = await fastify.prisma.user.findUnique({ where: { id: userId }, select: SUPPORTER_FLAG_SELECT });
    return { userId, effective: updated ? effectiveTiersOf(updated) : null };
  });

  // Admin: read / set which Discord role IDs map to Supporter / Lord / Champion.
  fastify.get('/api/admin/supporters/role-config', adminGuard, async () =>
    getSupporterRoleConfig(fastify.prisma),
  );

  fastify.put('/api/admin/supporters/role-config', adminGuard, async (request, reply) => {
    const parsed = roleConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    await fastify.prisma.adminConfig.upsert({
      where: { key: SUPPORTER_ROLE_CONFIG_KEY },
      create: { key: SUPPORTER_ROLE_CONFIG_KEY, value: parsed.data as never, updated_by: request.user.sub },
      update: { value: parsed.data as never, updated_by: request.user.sub },
    });
    return getSupporterRoleConfig(fastify.prisma);
  });
};

export default supporterRoutes;
