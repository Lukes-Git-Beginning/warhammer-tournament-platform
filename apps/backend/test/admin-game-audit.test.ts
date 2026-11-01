import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@rizzotto/db';
import { buildApp } from '../src/app.js';

// The flagged view of the admin All Games table renders the same columns as the full list,
// so the audit has to return the battle type too.
let app: Awaited<ReturnType<typeof buildApp>>;
const ADMIN_ID = 'a91c0000-0000-0000-0000-000000000001';
const P1_ID = 'a91c0000-0000-0000-0000-000000000002';
const P2_ID = 'a91c0000-0000-0000-0000-000000000003';
const MATCH_ID = randomUUID();

const asAdmin = () => ({ auth_token: app.jwt.sign({ sub: ADMIN_ID, username: 'AuditAdmin', role: 'ADMIN' }) });

const cleanup = async () => {
  await prisma.matchGame.deleteMany({ where: { match_id: MATCH_ID } });
  await prisma.match.deleteMany({ where: { id: MATCH_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, P1_ID, P2_ID] } } });
};

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'audit_admin', username: 'AuditAdmin', role: 'ADMIN' },
      { id: P1_ID, discord_id: 'audit_p1', username: 'AuditP1' },
      { id: P2_ID, discord_id: 'audit_p2', username: 'AuditP2' },
    ],
  });
  await prisma.match.create({
    data: {
      id: MATCH_ID,
      type: 'OPEN_PLAY',
      source: 'QUEUE',
      round: 0,
      match_number: 0,
      status: 'COMPLETED',
      player1_id: P1_ID,
      player2_id: P2_ID,
    },
  });
  await prisma.matchGame.create({
    data: {
      match_id: MATCH_ID,
      game_number: 1,
      status: 'COMPLETED',
      battle_type: 'CONQUEST',
      winner_id: null,
      played_at: new Date(),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/admin/game-audit', () => {
  it('returns the battle type of a flagged game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/game-audit', cookies: asAdmin() });
    expect(res.statusCode).toBe(200);
    const game = (res.json() as { games: { matchId: string; battleType: string; issues: string[] }[] }).games.find(
      (g) => g.matchId === MATCH_ID,
    );
    expect(game).toMatchObject({ battleType: 'CONQUEST' });
    expect(game!.issues).toContain('draw');
  });
});
