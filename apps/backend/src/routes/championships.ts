/**
 * Recurring competitive finals (design-competitive-finals-locked). No Series object: a final is a
 * normal tournament tagged with championship_kind + championship_period. These routes power the
 * leaderboard tile (live preview) and the admin seed/raffle actions.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import {
  computeQuarterlyFinal,
  computeMonthlyLadderFinal,
  seedFinal,
  pickRaffleWinner,
  type QuarterlyBattleType,
  type QuarterlyFinalPreview,
} from '../lib/competitive-finals.js';
import { notifyChampionshipSeeded, notifyRaffleWinner } from '../lib/championship-notify.js';

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
        const preview = await computeMonthlyLadderFinal(fastify.prisma, { period });
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

  // POST /api/championships/:slug/seed — admin: freeze the qualification + seed the tagged final,
  // then DM each seeded competitor. Idempotent (re-seed before start is safe).
  fastify.post(
    '/api/championships/:slug/seed',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
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
      if (t.championship_kind === 'NONE' || !t.championship_period) {
        return reply.code(400).send({ error: 'BadRequest', message: 'This tournament is not tagged as a championship final.', statusCode: 400 });
      }
      if (t.status === 'ONGOING' || t.status === 'COMPLETED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Seed the final before it starts.', statusCode: 409 });
      }
      try {
        const result = await seedFinal(fastify.prisma, fastify.redis, {
          tournamentId: t.id,
          kind: t.championship_kind,
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

  // POST /api/championships/:slug/raffle — admin: draw the ladder raffle among the invitees.
  fastify.post(
    '/api/championships/:slug/raffle',
    { preHandler: [fastify.authenticate, fastify.requireRole('MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const t = await fastify.prisma.tournament.findUnique({
        where: { slug },
        select: { id: true, championship_kind: true },
      });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
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
