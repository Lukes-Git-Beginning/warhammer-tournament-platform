import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const USER_ID = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await prisma.playerSkillSnapshot.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.user.create({
    data: { id: USER_ID, discord_id: `test-skillhist-${USER_ID}`, username: 'SkillHistTester' },
  });
  // Inserted out of order to prove the endpoint sorts ascending by date.
  await prisma.playerSkillSnapshot.createMany({
    data: [
      { user_id: USER_ID, snapshot_date: new Date(Date.UTC(2026, 5, 28)), general_skill: 0.5, std_error: 0.4, band: 3, games_count: 5, version_id: null },
      { user_id: USER_ID, snapshot_date: new Date(Date.UTC(2026, 5, 27)), general_skill: 0.1, std_error: 0.5, band: 3, games_count: 2, version_id: null },
    ],
  });
});

afterAll(async () => {
  await prisma.playerSkillSnapshot.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/users/:id/skill-history', () => {
  it('returns the user snapshots oldest-first', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${USER_ID}/skill-history` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      userId: string;
      points: { date: string; generalSkill: number; stdError: number; band: number; gamesCount: number }[];
    };
    expect(body.userId).toBe(USER_ID);
    expect(body.points).toHaveLength(2);
    expect(body.points.map((p) => p.date)).toEqual(['2026-06-27', '2026-06-28']);
    expect(body.points[0]).toMatchObject({ generalSkill: 0.1, band: 3, gamesCount: 2 });
    expect(body.points[1]).toMatchObject({ generalSkill: 0.5, gamesCount: 5 });
  });

  it('404 for an unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/22222222-2222-2222-2222-222222222222/skill-history',
    });
    expect(res.statusCode).toBe(404);
  });
});
