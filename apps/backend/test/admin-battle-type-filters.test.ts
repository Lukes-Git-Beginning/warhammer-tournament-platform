import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';

// Admin band views judged per battle type (2026-10-08): skill distribution, underrated report,
// users list. A player who only answered Conquest questions has a Conquest floor but no Siege one.
let app: Awaited<ReturnType<typeof buildApp>>;
const ADMIN_ID = 'a91b0000-0000-0000-0000-000000000001';
const PLAYER_ID = 'a91b0000-0000-0000-0000-000000000002';

const asAdmin = () => ({ auth_token: app.jwt.sign({ sub: ADMIN_ID, username: 'BtfAdmin', role: 'ADMIN' }) });

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, PLAYER_ID] } } });
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'btf_admin', username: 'BtfAdmin', role: 'ADMIN' },
      {
        id: PLAYER_ID,
        discord_id: 'btf_player',
        username: 'BtfConquestPlayer',
        // Advanced in Conquest by claim; no Domination/Siege/general answers.
        calibration_answers: { conquest_self_rating: '4' },
      },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, PLAYER_ID] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('admin band views per battle type', () => {
  it('users list: the band is judged in the requested battle type', async () => {
    const band = async (bt: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/users?search=BtfConquestPlayer&battleType=${bt}`,
        cookies: asAdmin(),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { users: { id: string; band: number | null }[] }).users.find((u) => u.id === PLAYER_ID)?.band;
    };
    expect(await band('CONQUEST')).toBe(4); // the Conquest claim
    expect(await band('SIEGE')).toBeNull(); // calibrated, but never asked about Siege → unrated there
  });

  it('skill distribution accepts a battle type and echoes it; rejects junk', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/admin/stats/skill-distribution?battleType=CONQUEST', cookies: asAdmin() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ battleType: 'CONQUEST' });
    const bad = await app.inject({ method: 'GET', url: '/api/admin/stats/skill-distribution?battleType=LAND', cookies: asAdmin() });
    expect(bad.statusCode).toBe(400);
  });

  it('underrated report accepts a battle type and echoes it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/reports/underrated?battleType=SIEGE', cookies: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ battleType: 'SIEGE' });
  });
});
