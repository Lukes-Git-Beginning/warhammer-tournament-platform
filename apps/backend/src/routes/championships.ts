/**
 * Recurring competitive finals (design-competitive-finals-locked). No Series object: a final is a
 * normal tournament tagged with championship_kind + championship_period. These routes power the
 * leaderboard tile (live preview) and the admin seed/raffle actions.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { canManageTournament } from '../lib/tournament-utils.js';
import {
  computeQuarterlyFinal,
  computeMonthlyLadderFinal,
  seedFinal,
  seedFromConfirmed,
  openAvailabilityRound,
  setInviteRsvp,
  setInviteRsvpByManager,
  computeFieldView,
  pickRaffleWinner,
  type QuarterlyBattleType,
  type QuarterlyFinalPreview,
  type ChampKind,
} from '../lib/competitive-finals.js';
import {
  notifyChampionshipSeeded,
  notifyRaffleWinner,
  notifyAvailabilityInvites,
  notifyRsvpSetByManager,
} from '../lib/championship-notify.js';

const QUARTERLY_BATTLE_TYPES: QuarterlyBattleType[] = ['DOMINATION', 'CONQUEST', 'SIEGE'];

/** The tile never needs the full seed list — only the sizing + how far off the floor. */
function quarterlyTile(p: QuarterlyFinalPreview) {
  return {
    battleType: p.battleType,
    size: p.size,
    active: p.active,
    qualified: p.qualified,
    gate: p.gate,
    belowFloor: p.belowFloor,
    needMoreActive: p.needMoreActive,
    needMoreQualified: p.needMoreQualified,
  };
}

const championshipRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/championships/quarterly?period=2026-Q3&competitorFormat=ONE_V_ONE
  // One tile per battle type: field size (createable) or how far off the floor (day-current).
  fastify.get('/api/championships/quarterly', async (request, reply) => {
    const parsed = z
      .object({
        period: z.string().min(4),
        competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).default('ONE_V_ONE'),
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { period, competitorFormat } = parsed.data;
    return cached(
      fastify.redis,
      cacheKey('championships:quarterly', { period, competitorFormat }),
      async () => {
        const battleTypes: Array<ReturnType<typeof quarterlyTile> & { tournament: { slug: string; name: string; status: string } | null }> = [];
        for (const bt of QUARTERLY_BATTLE_TYPES) {
          const preview = await computeQuarterlyFinal(fastify.prisma, fastify.redis, {
            period,
            battleType: bt,
            competitorFormat,
          });
          if (!preview) continue;
          const tournament = await fastify.prisma.tournament.findFirst({
            where: {
              championship_kind: 'QUARTERLY',
              championship_period: period,
              battle_type: bt,
              competitor_format: competitorFormat,
              deleted_at: null,
            },
            select: { slug: true, name: true, status: true },
          });
          battleTypes.push({ ...quarterlyTile(preview), tournament: tournament ?? null });
        }
        return { kind: 'QUARTERLY', period, competitorFormat, battleTypes };
      },
      { ttlSeconds: 300 },
    );
  });

  // GET /api/championships/ladder?period=2026-10 — the single Monthly Ladder Invitational.
  fastify.get('/api/championships/ladder', async (request, reply) => {
    const parsed = z.object({ period: z.string().min(4) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { period } = parsed.data;
    return cached(
      fastify.redis,
      cacheKey('championships:ladder', { period }),
      async () => {
        const preview = await computeMonthlyLadderFinal(fastify.prisma, fastify.redis, { period });
        const tournament = await fastify.prisma.tournament.findFirst({
          where: { championship_kind: 'MONTHLY_LADDER', championship_period: period, deleted_at: null },
          select: { slug: true, name: true, status: true },
        });
        return {
          kind: 'MONTHLY_LADDER',
          period,
          players: preview?.players ?? 0,
          size: preview?.size ?? 0,
          tournament: tournament ?? null,
        };
      },
      { ttlSeconds: 300 },
    );
  });

  // Finals are created by staff (the championship tag is admin-only on create), so "manager" here is
  // staff plus any host/co-host staff put on that final — they run it with the same controls.
  const forbidUnlessManager = async (
    request: { user: { sub: string; role: string } },
    tournamentId: string,
  ): Promise<{ error: string; message: string; statusCode: number } | null> =>
    (await canManageTournament(fastify.prisma, tournamentId, request.user.sub, request.user.role))
      ? null
      : { error: 'Forbidden', message: 'Only staff or a host of this final can do this.', statusCode: 403 };

  // POST /api/championships/:slug/seed — staff/host of the final: freeze the qualification + seed the
  // tagged final, then DM each seeded competitor. Idempotent (re-seed before start is safe).
  fastify.post(
    '/api/championships/:slug/seed',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug },
        select: {
          id: true,
          championship_kind: true,
          championship_period: true,
          battle_type: true,
          competitor_format: true,
          status: true,
        },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      const forbidden = await forbidUnlessManager(request, t.id);
      if (forbidden) return reply.code(403).send(forbidden);
      if (t.championship_kind === 'NONE' || !t.championship_period) {
        return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not tagged as a championship final.', statusCode: 400 });
      }
      if (t.status === 'ONGOING' || t.status === 'COMPLETED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Seed the final before it starts.', statusCode: 409 });
      }
      try {
        const inviteCount = await fastify.prisma.championshipInvite.count({ where: { tournament_id: t.id } });
        if (inviteCount > 0) {
          // Availability-round path: seed from the confirmed (AVAILABLE) invitees, top-N by rank.
          const result = await seedFromConfirmed(fastify.prisma, fastify.redis, {
            tournamentId: t.id,
            kind: t.championship_kind as ChampKind,
            period: t.championship_period,
            battleType: t.battle_type as QuarterlyBattleType,
            competitorFormat: t.competitor_format,
          });
          void notifyChampionshipSeeded(fastify.prisma, t.id, result.seededUserIds);
          return { seeded: result.seededUserIds.length, size: result.size, available: result.available, plannedSize: result.plannedSize };
        }
        // Direct path (no availability round): freeze the top-N straight to the field.
        const result = await seedFinal(fastify.prisma, fastify.redis, {
          tournamentId: t.id,
          kind: t.championship_kind as ChampKind,
          period: t.championship_period,
          battleType: t.battle_type as QuarterlyBattleType,
          competitorFormat: t.competitor_format,
        });
        void notifyChampionshipSeeded(fastify.prisma, t.id, result.seededUserIds);
        return { seeded: result.seededUserIds.length, size: result.size };
      } catch (err) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: (err as Error).message, statusCode: 422 });
      }
    },
  );

  // POST /api/championships/:slug/open-availability — staff/host of the final: open the availability
  // round. Freezes the full ranking as invites, sets a 24h RSVP deadline, and DMs every invitee
  // (differentiated by cut).
  fastify.post(
    '/api/championships/:slug/open-availability',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const q = z
        .object({
          reopen: z.coerce.boolean().optional(),
          deadlineHours: z.coerce.number().int().min(1).max(336).optional(),
        })
        .safeParse(request.query);
      const reopen = q.success ? q.data.reopen : false;
      const deadlineHours = q.success ? q.data.deadlineHours : undefined;
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug },
        select: {
          id: true,
          championship_kind: true,
          championship_period: true,
          battle_type: true,
          competitor_format: true,
          status: true,
          availability_opened_at: true,
        },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      const forbidden = await forbidUnlessManager(request, t.id);
      if (forbidden) return reply.code(403).send(forbidden);
      if (t.championship_kind === 'NONE' || !t.championship_period) {
        return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not tagged as a championship final.', statusCode: 400 });
      }
      if (t.status === 'ONGOING' || t.status === 'COMPLETED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Open the availability round before the final starts.', statusCode: 409 });
      }
      const seededCount = await fastify.prisma.tournamentParticipant.count({ where: { tournament_id: t.id, deleted_at: null } });
      if (seededCount > 0) {
        return reply.code(409).send({ error: 'Conflict', message: 'This final is already seeded.', statusCode: 409 });
      }
      if (t.availability_opened_at && !reopen) {
        return reply.code(409).send({ error: 'Conflict', message: 'The availability round is already open. Pass reopen=true to re-freeze the ranking (this resets everyone\'s RSVP).', statusCode: 409 });
      }
      try {
        const result = await openAvailabilityRound(fastify.prisma, fastify.redis, {
          tournamentId: t.id,
          kind: t.championship_kind as ChampKind,
          period: t.championship_period,
          battleType: t.battle_type as QuarterlyBattleType,
          competitorFormat: t.competitor_format,
          deadlineHours,
        });
        void notifyAvailabilityInvites(fastify.prisma, t.id, result.invites, result.fieldSize, result.deadline);
        return { invited: result.invited, fieldSize: result.fieldSize, deadline: result.deadline.toISOString() };
      } catch (err) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: (err as Error).message, statusCode: 422 });
      }
    },
  );

  // POST /api/championships/:slug/rsvp — an invitee confirms (available) or declines the final.
  fastify.post(
    '/api/championships/:slug/rsvp',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = z.object({ available: z.boolean() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'BadRequest', message: 'available (boolean) is required', statusCode: 400 });
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug },
        select: { id: true, championship_kind: true, status: true, availability_opened_at: true },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (t.championship_kind === 'NONE') {
        return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not a championship final.', statusCode: 400 });
      }
      if (!t.availability_opened_at) {
        return reply.code(409).send({ error: 'Conflict', message: 'The availability round is not open yet.', statusCode: 409 });
      }
      if (t.status === 'ONGOING' || t.status === 'COMPLETED') {
        return reply.code(409).send({ error: 'Conflict', message: 'The final has already started.', statusCode: 409 });
      }
      const rsvp = await setInviteRsvp(fastify.prisma, { tournamentId: t.id, userId: request.user.sub, available: body.data.available });
      if (!rsvp) return reply.code(403).send({ error: 'Forbidden', message: 'You are not an invitee of this final.', statusCode: 403 });
      return { rsvp };
    },
  );

  // POST /api/championships/:slug/invites/:competitorId/rsvp — staff/host of the final: set an
  // invitee's availability on their behalf (they answered in Discord), or reset it to pending. The
  // invitee is DM'd with a way to correct it; their own answer afterwards overrides this.
  fastify.post(
    '/api/championships/:slug/invites/:competitorId/rsvp',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = z.object({ slug: z.string(), competitorId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'BadRequest', message: 'Invalid invite id', statusCode: 400 });
      const body = z.object({ rsvp: z.enum(['AVAILABLE', 'DECLINED', 'PENDING']) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'BadRequest', message: 'rsvp must be AVAILABLE, DECLINED or PENDING', statusCode: 400 });
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug: params.data.slug },
        select: { id: true, championship_kind: true, status: true, availability_opened_at: true },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      const forbidden = await forbidUnlessManager(request, t.id);
      if (forbidden) return reply.code(403).send(forbidden);
      if (t.championship_kind === 'NONE') {
        return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not a championship final.', statusCode: 400 });
      }
      if (!t.availability_opened_at) {
        return reply.code(409).send({ error: 'Conflict', message: 'The availability round is not open yet.', statusCode: 409 });
      }
      if (t.status === 'ONGOING' || t.status === 'COMPLETED') {
        return reply.code(409).send({ error: 'Conflict', message: 'The final has already started.', statusCode: 409 });
      }
      const seededCount = await fastify.prisma.tournamentParticipant.count({ where: { tournament_id: t.id, deleted_at: null } });
      if (seededCount > 0) {
        return reply.code(409).send({ error: 'Conflict', message: 'This final is already seeded.', statusCode: 409 });
      }
      const result = await setInviteRsvpByManager(fastify.prisma, {
        tournamentId: t.id,
        competitorId: params.data.competitorId,
        rsvp: body.data.rsvp,
        actorId: request.user.sub,
      });
      if (!result) return reply.code(404).send({ error: 'NotFound', message: 'No such invitee in this final.', statusCode: 404 });
      if (result.rsvp !== 'PENDING') void notifyRsvpSetByManager(fastify.prisma, t.id, result.userId, result.rsvp);
      return { rsvp: result.rsvp };
    },
  );

  // GET /api/championships/:slug/field — the phase-aware field view (preview / availability / seeded).
  // Public; if the caller is logged in, includes their own invitee/RSVP state.
  fastify.get('/api/championships/:slug/field', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    let viewerUserId: string | undefined;
    try {
      await request.jwtVerify();
      viewerUserId = request.user?.sub;
    } catch {
      /* anonymous */
    }
    const t = await fastify.prisma.tournament.findUnique({
      where: { slug },
      select: {
        id: true,
        championship_kind: true,
        championship_period: true,
        battle_type: true,
        competitor_format: true,
        availability_opened_at: true,
        rsvp_deadline: true,
      },
    });
    if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
    const view = await computeFieldView(fastify.prisma, fastify.redis, {
      tournament: {
        id: t.id,
        championship_kind: t.championship_kind as ChampKind | 'NONE',
        championship_period: t.championship_period,
        battle_type: t.battle_type,
        competitor_format: t.competitor_format,
        availability_opened_at: t.availability_opened_at,
        rsvp_deadline: t.rsvp_deadline,
      },
      viewerUserId,
    });
    if (!view) return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not a championship final.', statusCode: 400 });
    return view;
  });

  // POST /api/championships/:slug/raffle — admin: draw the ladder raffle among the invitees.
  fastify.post(
    '/api/championships/:slug/raffle',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug },
        select: { id: true, championship_kind: true },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      const forbidden = await forbidUnlessManager(request, t.id);
      if (forbidden) return reply.code(403).send(forbidden);
      if (t.championship_kind !== 'MONTHLY_LADDER') {
        return reply.code(400).send({ error: 'BadRequest', message: 'The raffle is only for the Monthly Ladder Invitational.', statusCode: 400 });
      }
      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: t.id, deleted_at: null },
        select: { user_id: true },
      });
      const winner = pickRaffleWinner(participants.map((p) => p.user_id));
      if (!winner) return reply.code(422).send({ error: 'UnprocessableEntity', message: 'No invitees to draw from — seed the final first.', statusCode: 422 });
      void notifyRaffleWinner(fastify.prisma, t.id, winner);
      return { winnerUserId: winner };
    },
  );
};

export default championshipRoutes;
