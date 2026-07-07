import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// A scheduled matchup stops being acceptable shortly after its proposed play
// time — you cannot claim a match whose start time has already passed. This
// grace lets a late accepter still grab a slot right around its start, and caps
// how long a challenge lingers in the list past its proposed time.
const ACCEPT_GRACE_MS = 60 * 60 * 1000; // 1h past proposed_at

const CreateMatchupSchema = z.object({
  format: z.enum(['BO1', 'BO3', 'BO5']),
  proposed_at: z.string().datetime(),
  notes: z.string().max(500).optional(),
  expires_in_hours: z.number().min(0.5).max(168).optional().default(72),
});

const scheduledMatchupsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/scheduled-matchups — public, list OPEN matchups
  fastify.get('/api/scheduled-matchups', async (request, reply) => {
    const query = request.query as {
      format?: string;
      before?: string;
      after?: string;
      page?: string;
    };

    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const pageSize = 20;

    // Hard floor: never surface a matchup whose proposed play time has already
    // passed (beyond the grace) — even if its stored expires_at still lies in
    // the future (e.g. legacy rows created with a long expires_in_hours window).
    const graceFloor = new Date(Date.now() - ACCEPT_GRACE_MS);
    const afterDate = query.after ? new Date(query.after) : null;
    const proposedGte = afterDate && afterDate > graceFloor ? afterDate : graceFloor;

    const where = {
      status: 'OPEN' as const,
      expires_at: { gt: new Date() },
      ...(query.format ? { format: query.format as 'BO1' | 'BO3' | 'BO5' } : {}),
      proposed_at: {
        gte: proposedGte,
        ...(query.before ? { lte: new Date(query.before) } : {}),
      },
    };

    const [matchups, total] = await Promise.all([
      fastify.prisma.scheduledMatchup.findMany({
        where,
        orderBy: { proposed_at: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          proposer: { select: { id: true, username: true, avatar_url: true } },
        },
      }),
      fastify.prisma.scheduledMatchup.count({ where }),
    ]);

    return reply.code(200).send({
      matchups: matchups.map((m) => ({
        id: m.id,
        format: m.format,
        proposed_at: m.proposed_at.toISOString(),
        notes: m.notes ?? null,
        proposer: { id: m.proposer.id, username: m.proposer.username, avatar_url: m.proposer.avatar_url },
        created_at: m.created_at.toISOString(),
        expires_at: m.expires_at.toISOString(),
      })),
      total,
      page,
      page_size: pageSize,
    });
  });

  // POST /api/scheduled-matchups — authenticated, create
  fastify.post(
    '/api/scheduled-matchups',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const parsed = CreateMatchupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const { format, proposed_at, notes, expires_in_hours } = parsed.data;
      const proposedTime = new Date(proposed_at);
      // Cap the offer window so a challenge never stays acceptable long past its
      // proposed play time. Immediate challenges (short expires_in_hours) keep
      // their own shorter window; scheduled ones are capped at proposed + grace.
      const requestedExpiry = proposedTime.getTime() + expires_in_hours * 60 * 60 * 1000;
      const expiresAt = new Date(Math.min(requestedExpiry, proposedTime.getTime() + ACCEPT_GRACE_MS));

      const matchup = await fastify.prisma.scheduledMatchup.create({
        data: {
          proposer_id: userId,
          format,
          proposed_at: proposedTime,
          notes: notes ?? null,
          expires_at: expiresAt,
        },
        include: { proposer: { select: { id: true, username: true } } },
      });

      return reply.code(201).send({
        id: matchup.id,
        format: matchup.format,
        proposed_at: matchup.proposed_at.toISOString(),
        notes: matchup.notes ?? null,
        expires_at: matchup.expires_at.toISOString(),
      });
    },
  );

  // POST /api/scheduled-matchups/:id/accept — authenticated
  fastify.post(
    '/api/scheduled-matchups/:id/accept',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const acceptorId = request.user.sub;

      const matchup = await fastify.prisma.scheduledMatchup.findUnique({
        where: { id },
        include: {
          proposer: { select: { id: true, username: true, discord_id: true } },
        },
      });

      const graceFloor = new Date(Date.now() - ACCEPT_GRACE_MS);
      if (
        !matchup ||
        matchup.status !== 'OPEN' ||
        matchup.expires_at < new Date() ||
        matchup.proposed_at < graceFloor
      ) {
        return reply.code(404).send({ error: 'NotFound', message: 'Matchup not found or no longer open', statusCode: 404 });
      }

      if (matchup.proposer_id === acceptorId) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot accept your own matchup', statusCode: 422 });
      }

      await fastify.prisma.scheduledMatchup.update({
        where: { id },
        data: { status: 'ACCEPTED', accepted_by_id: acceptorId },
      });

      // Match creation is deferred to the cron task that runs at proposed_at.
      // This prevents faction picks from starting before the scheduled play time.
      return reply.code(200).send({ accepted: true, proposed_at: matchup.proposed_at.toISOString() });
    },
  );

  // DELETE /api/scheduled-matchups/:id — proposer only
  fastify.delete(
    '/api/scheduled-matchups/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user.sub;

      const matchup = await fastify.prisma.scheduledMatchup.findUnique({
        where: { id },
        select: { proposer_id: true, status: true },
      });

      if (!matchup) {
        return reply.code(404).send({ error: 'NotFound', message: 'Matchup not found', statusCode: 404 });
      }

      if (matchup.proposer_id !== userId && request.user.role !== 'ADMIN' && request.user.role !== 'MODERATOR') {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your matchup', statusCode: 403 });
      }

      if (matchup.status !== 'OPEN') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: `Matchup is already ${matchup.status}`, statusCode: 422 });
      }

      await fastify.prisma.scheduledMatchup.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      return reply.code(204).send();
    },
  );
};

export default scheduledMatchupsRoutes;
