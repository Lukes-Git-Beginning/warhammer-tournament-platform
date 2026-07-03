// ---------------------------------------------------------------------------
// Skill classification routes (N2)
//
//   GET  /api/calibration/questions            — the calibration questionnaire
//   GET  /api/players/:id/classification        — a player's skill classification
//   POST /api/me/calibration                    — save my questionnaire answers
//
// Classification is derived live from the stored answers + the hierarchical
// rating model. The band is public (shown on profiles); answers are self-write.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getPlayerClassification,
  saveCalibrationAnswers,
  loadCalibrationQuestions,
} from '../lib/skill-classification-service.js';

async function resolveSeasonId(
  fastify: FastifyInstance,
  seasonId: string | undefined,
): Promise<{ id: string } | { error: { code: number; message: string } }> {
  if (seasonId) {
    const season = await fastify.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) return { error: { code: 404, message: 'Season not found' } };
    return { id: season.id };
  }
  const active = await fastify.prisma.season.findFirst({ where: { is_active: true } });
  if (!active) return { error: { code: 404, message: 'No active season' } };
  return { id: active.id };
}

const err = (code: number, message: string): { error: string; message: string; statusCode: number } => ({
  error: code === 404 ? 'NotFound' : 'BadRequest',
  message,
  statusCode: code,
});

const skillRoutes: FastifyPluginAsync = async (fastify) => {
  // The questionnaire catalog for the calibration wizard (public; admin-editable).
  fastify.get('/api/calibration/questions', async () => ({
    questions: await loadCalibrationQuestions(fastify.prisma),
  }));

  // A player's classification (public — the band is shown on profiles).
  fastify.get('/api/players/:id/classification', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = z.object({ seasonId: z.string().uuid().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send(err(400, query.error.message));

    const resolved = await resolveSeasonId(fastify, query.data.seasonId);
    if ('error' in resolved) return reply.code(resolved.error.code).send(err(resolved.error.code, resolved.error.message));

    const classification = await getPlayerClassification(
      fastify.prisma,
      fastify.redis,
      resolved.id,
      id,
    );
    return classification;
  });

  // Save my own calibration answers (incremental merge), return updated classification.
  fastify.post(
    '/api/me/calibration',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const body = z
        .object({ answers: z.record(z.string(), z.string()) })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send(err(400, body.error.message));

      const playerId = request.user.sub;
      const answers = await saveCalibrationAnswers(fastify.prisma, playerId, body.data.answers);

      const resolved = await resolveSeasonId(fastify, undefined);
      if ('error' in resolved) return { answers };
      const classification = await getPlayerClassification(
        fastify.prisma,
        fastify.redis,
        resolved.id,
        playerId,
      );
      return { answers, classification };
    },
  );
};

export default skillRoutes;
