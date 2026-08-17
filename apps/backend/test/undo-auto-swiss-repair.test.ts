/**
 * Recovery endpoint for the (removed) auto-swiss "repair" that mistook a completed elimination
 * tournament for a stuck auto-swiss one — flipping its format to AUTO_SWISS, relabelling the
 * bracket matches as SWISS, and generating bogus playoff matches.
 *
 * POST /api/admin/tournaments/:slug/undo-auto-swiss-repair reverses that:
 *  1. Admin + confirm:true → 200, playoffs soft-deleted, phases reverted, fields restored.
 *  2. A non-AUTO_SWISS tournament → 409 (nothing to undo).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

const ADMIN_ID = '1e000000-0000-0000-0000-000000000001';
const HOST_ID = '1e000000-0000-0000-0000-000000000002';
const TOURNAMENT_ID = '1e000000-0000-0000-0001-000000000001';
const SLUG = `undo-repair-${TOURNAMENT_ID.slice(-8)}`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.match.deleteMany({ where: { tournament_id: TOURNAMENT_ID } });
  await prisma.auditLog.deleteMany({ where: { entity_id: TOURNAMENT_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, HOST_ID] } } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'undo_admin', username: 'UndoAdmin', email: null, role: 'ADMIN' },
      { id: HOST_ID, discord_id: 'undo_host', username: 'UndoHost', email: null, role: 'HOST' },
    ],
    skipDuplicates: true,
  });
  // A single-elim tournament that was wrongly "repaired" into AUTO_SWISS.
  await prisma.tournament.create({
    data: {
      id: TOURNAMENT_ID,
      slug: SLUG,
      name: 'Undo Repair Tournament',
      host_id: HOST_ID,
      format: 'AUTO_SWISS',
      mode: 'FACTION_WAR',
      status: 'ONGOING',
      rounds_count: 5,
      playoff_format: 'TOP8',
      auto_advance: true,
      start_date: new Date('2026-09-01'),
      timezone: 'Europe/Berlin',
    },
  });
  await prisma.match.createMany({
    data: [
      // Original single-elim bracket matches, relabelled SWISS by the repair.
      { id: randomUUID(), tournament_id: TOURNAMENT_ID, round: 1, match_number: 1, phase: 'SWISS', status: 'COMPLETED' },
      { id: randomUUID(), tournament_id: TOURNAMENT_ID, round: 5, match_number: 1, phase: 'SWISS', status: 'COMPLETED' },
      // Bogus generated playoffs.
      { id: randomUUID(), tournament_id: TOURNAMENT_ID, round: 6, match_number: 1, phase: 'PLAYOFF_QF', status: 'PENDING' },
      { id: randomUUID(), tournament_id: TOURNAMENT_ID, round: 8, match_number: 1, phase: 'PLAYOFF_FINAL', status: 'PENDING' },
    ],
  });
});

afterEach(async () => {
  await cleanup();
});

function cookieFor(id: string, role: string) {
  const token = app.jwt.sign({ sub: id, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return `${cookieName}=${token}`;
}

describe('POST /api/admin/tournaments/:slug/undo-auto-swiss-repair', () => {
  it('1. reverses the repair — deletes playoffs, restores format, reverts phases', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/tournaments/${SLUG}/undo-auto-swiss-repair`,
      headers: { cookie: cookieFor(ADMIN_ID, 'ADMIN') },
      payload: { previous_format: 'SINGLE_ELIMINATION', confirm: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ deletedPlayoffMatches: number; revertedPhases: number }>();
    expect(body.deletedPlayoffMatches).toBe(2);
    expect(body.revertedPhases).toBe(2);

    const t = await prisma.tournament.findUnique({
      where: { id: TOURNAMENT_ID },
      select: { format: true, playoff_format: true, auto_advance: true },
    });
    expect(t?.format).toBe('SINGLE_ELIMINATION');
    expect(t?.playoff_format).toBe('NONE');
    expect(t?.auto_advance).toBe(false);

    const live = await prisma.match.findMany({
      where: { tournament_id: TOURNAMENT_ID, deleted_at: null },
      select: { phase: true },
    });
    expect(live).toHaveLength(2); // the 2 playoffs are soft-deleted
    expect(live.every((m) => m.phase === null)).toBe(true); // SWISS → null
  });

  it('2. a non-AUTO_SWISS tournament → 409 (nothing to undo)', async () => {
    await prisma.tournament.update({ where: { id: TOURNAMENT_ID }, data: { format: 'SINGLE_ELIMINATION' } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/tournaments/${SLUG}/undo-auto-swiss-repair`,
      headers: { cookie: cookieFor(ADMIN_ID, 'ADMIN') },
      payload: { previous_format: 'SINGLE_ELIMINATION', confirm: true },
    });
    expect(res.statusCode).toBe(409);
  });
});
