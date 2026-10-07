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
  loadAnswers,
} from '../lib/skill-classification-service.js';
import { SKILL_BATTLE_TYPES } from '../lib/skill-classification.js';

// Classification is timeless (an all-time fit) — the version is a legacy parameter only. An unknown
// explicit version is still a 404, but "no active version" no longer blocks a player's band.
async function resolveVersionId(
  fastify: FastifyInstance,
  versionId: string | undefined,
): Promise<{ id: string | null } | { error: { code: number; message: string } }> {
  if (versionId) {
    const version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
    if (!version) return { error: { code: 404, message: 'Version not found' } };
    return { id: version.id };
  }
  const active = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
  return { id: active?.id ?? null };
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
    const query = z
      .object({
        versionId: z.string().uuid().optional(),
        // The scope to classify in: a battle type, or OVERALL (game-weighted summary, default).
        battleType: z.enum(['OVERALL', ...SKILL_BATTLE_TYPES]).default('OVERALL'),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send(err(400, query.error.message));

    const resolved = await resolveVersionId(fastify, query.data.versionId);
    if ('error' in resolved) return reply.code(resolved.error.code).send(err(resolved.error.code, resolved.error.message));

    const classification = await getPlayerClassification(
      fastify.prisma,
      fastify.redis,
      resolved.id,
      id,
      query.data.battleType,
    );
    return classification;
  });

  // My own stored answers — the wizard seeds itself with them, so a returning player is only
  // asked what's still open (e.g. the Conquest/Siege questions added after they calibrated).
  fastify.get('/api/me/calibration', { preHandler: fastify.authenticate }, async (request) => ({
    answers: await loadAnswers(fastify.prisma, request.user.sub),
  }));

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

      const resolved = await resolveVersionId(fastify, undefined);
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
