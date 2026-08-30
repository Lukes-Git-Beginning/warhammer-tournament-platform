import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { isValidRef } from '../lib/referrals.js';

/**
 * Referral attribution — capture side. Records ?ref= clicks (append-only ReferralHit) and
 * the first-touch acquisition source on a user. Reporting lives in routes/admin.ts.
 */
const referralRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/ref/hit — public. Fired from the browser when a page loads with ?ref=X, so
  // bots without JS don't inflate it. Optional JWT attaches the (logged-in) user.
  const HitSchema = z.object({
    ref: z.string().min(1).max(64),
    slug: z.string().max(200).optional(),
    path: z.string().max(300).optional(),
  });
  fastify.post('/api/ref/hit', async (request, reply) => {
    const parsed = HitSchema.safeParse(request.body);
    if (!parsed.success || !isValidRef(parsed.data.ref)) {
      return reply.code(400).send({ error: 'BadRequest', message: 'Invalid ref', statusCode: 400 });
    }
    const { ref, slug, path } = parsed.data;

    let userId: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user?.sub ?? null;
    } catch {
      /* anonymous visitor — expected */
    }

    let tournamentId: string | null = null;
    if (slug) {
      const t = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });
      tournamentId = t?.id ?? null;
    }

    await fastify.prisma.referralHit.create({
      data: { ref, tournament_id: tournamentId, user_id: userId, path: path ?? null },
    });
    return reply.code(204).send();
  });

  // POST /api/users/me/referral-source — first-touch acquisition. Idempotent: only sets the
  // source if it is still null, so the FIRST ref a user ever arrived with wins.
  fastify.post(
    '/api/users/me/referral-source',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = z.object({ ref: z.string().min(1).max(64) }).safeParse(request.body);
      if (!parsed.success || !isValidRef(parsed.data.ref)) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Invalid ref', statusCode: 400 });
      }
      await fastify.prisma.user.updateMany({
        where: { id: request.user.sub, referral_source: null },
        data: { referral_source: parsed.data.ref },
      });
      return reply.code(204).send();
    },
  );
};

export default referralRoutes;
