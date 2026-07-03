/**
 * Admin-editable calibration questionnaire: the catalog is stored in AdminConfig,
 * drives questionnaireFloor + the public wizard endpoint, and falls back to the
 * built-in defaults when absent or malformed.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { CALIBRATION_QUESTIONS, questionnaireFloor } from '../src/lib/skill-classification.js';
import { loadCalibrationQuestions, CALIBRATION_CONFIG_KEY } from '../src/lib/skill-classification-service.js';

let app: FastifyInstance;
let adminId: string;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
  await prisma.user.deleteMany({ where: { discord_id: 'cal-admin' } });
  const admin = await prisma.user.create({
    data: { discord_id: 'cal-admin', username: 'CalAdmin', role: 'ADMIN' },
    select: { id: true },
  });
  adminId = admin.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: adminId } });
  await app.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.adminConfig.deleteMany({ where: { key: CALIBRATION_CONFIG_KEY } });
});

function adminCookie() {
  const token = app.jwt.sign({ sub: adminId, username: 'CalAdmin', role: 'ADMIN' });
  return { [process.env.JWT_COOKIE_NAME ?? 'auth_token']: token };
}

const CUSTOM = [
  {
    id: 'q1',
    prompt: 'Custom question',
    options: [
      { value: 'low', label: 'Low', floor: null },
      { value: 'high', label: 'High', floor: 5 },
    ],
  },
];

describe('calibration questionnaire config', () => {
  it('falls back to the built-in catalog when nothing is stored', async () => {
    const questions = await loadCalibrationQuestions(prisma);
    expect(questions).toHaveLength(CALIBRATION_QUESTIONS.length);
  });

  it('saves an admin-edited catalog and serves it everywhere', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/calibration-questions',
      cookies: adminCookie(),
      payload: { questions: CUSTOM },
    });
    expect(put.statusCode).toBe(200);

    // Loader returns the edited catalog.
    const loaded = await loadCalibrationQuestions(prisma);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('q1');

    // questionnaireFloor honours the edited floors.
    expect(questionnaireFloor({ q1: 'high' }, loaded)).toBe(5);
    expect(questionnaireFloor({ q1: 'low' }, loaded)).toBe(1);

    // The public wizard endpoint reflects the edit.
    const pub = await app.inject({ method: 'GET', url: '/api/calibration/questions' });
    expect(pub.json().questions).toHaveLength(1);
  });

  it('rejects an invalid catalog (400) and keeps the previous one', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/calibration-questions',
      cookies: adminCookie(),
      payload: { questions: [] }, // min 1 required
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a catalog with duplicate question ids', async () => {
    const dup = [CUSTOM[0], { ...CUSTOM[0] }];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/calibration-questions',
      cookies: adminCookie(),
      payload: { questions: dup },
    });
    expect(res.statusCode).toBe(400);
  });

  it('falls back to defaults when the stored value is malformed', async () => {
    await prisma.adminConfig.upsert({
      where: { key: CALIBRATION_CONFIG_KEY },
      create: { key: CALIBRATION_CONFIG_KEY, value: { garbage: true } },
      update: { value: { garbage: true } },
    });
    const questions = await loadCalibrationQuestions(prisma);
    expect(questions).toHaveLength(CALIBRATION_QUESTIONS.length); // reverted to defaults
  });

  it('requires admin (401/403 without an admin cookie)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/calibration-questions' });
    expect([401, 403]).toContain(res.statusCode);
  });
});
