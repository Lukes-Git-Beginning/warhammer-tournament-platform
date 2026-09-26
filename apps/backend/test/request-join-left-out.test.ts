/**
 * Integration tests for the late-join request endpoint's handling of a REGISTERED player who
 * missed check-in and was left OUT of the running bracket.
 *
 * A player who signed up on time but never checked in stays REGISTERED yet holds no match once the
 * tournament starts (only checked-in players are seeded when anyone checked in). They may
 * re-request a spot via POST /api/tournaments/:slug/request-join (host-approved). A REGISTERED
 * player who is actually PLAYING (holds a match) must NOT be able to demote themselves out of the
 * running bracket.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const HOST_ID = '2d000000-0000-0000-0000-000000000001';
const LEFTOUT_ID = '2d000000-0000-0000-0000-000000000002';
const PLAYING_ID = '2d000000-0000-0000-0000-000000000003';
const OPP_ID = '2d000000-0000-0000-0000-000000000004';

const TOURNAMENT_ID = '2d000000-0000-0000-0001-000000000001';
const SLUG = `rj-leftout-${TOURNAMENT_ID.slice(-8)}`;

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
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: TOURNAMENT_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, LEFTOUT_ID, PLAYING_ID, OPP_ID] } } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: HOST_ID, discord_id: 'rj_host', username: 'RJHost', email: null, role: 'HOST' },
      { id: LEFTOUT_ID, discord_id: 'rj_leftout', username: 'RJLeftOut', email: null, role: 'USER' },
      { id: PLAYING_ID, discord_id: 'rj_playing', username: 'RJPlaying', email: null, role: 'USER' },
      { id: OPP_ID, discord_id: 'rj_opp', username: 'RJOpp', email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });
  // Running tournament that accepts late-join requests.
  await prisma.tournament.create({
    data: {
      id: TOURNAMENT_ID,
      slug: SLUG,
      name: 'RJ Left-Out Tournament',
      host_id: HOST_ID,
      format: 'AUTO_SWISS',
      mode: 'BPT',
      status: 'ONGOING',
      allow_late_join_requests: true,
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
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

function requestJoin(id: string) {
  return app.inject({
    method: 'POST',
    url: `/api/tournaments/${SLUG}/request-join`,
    headers: { cookie: cookieFor(id, 'USER') },
    payload: {},
  });
}

describe('POST /api/tournaments/:slug/request-join — left-out registered player', () => {
  it('lets a REGISTERED player with no bracket match re-request a spot (→ JOIN_REQUESTED)', async () => {
    await prisma.tournamentParticipant.create({
      data: { tournament_id: TOURNAMENT_ID, user_id: LEFTOUT_ID, status: 'REGISTERED' },
    });
    const res = await requestJoin(LEFTOUT_ID);
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>().status).toBe('JOIN_REQUESTED');
    const row = await prisma.tournamentParticipant.findFirst({
      where: { tournament_id: TOURNAMENT_ID, user_id: LEFTOUT_ID },
      select: { status: true },
    });
    expect(row?.status).toBe('JOIN_REQUESTED');
  });

  it('blocks a REGISTERED player who is actually playing (holds a match) with 409, unchanged', async () => {
    await prisma.tournamentParticipant.createMany({
      data: [
        { tournament_id: TOURNAMENT_ID, user_id: PLAYING_ID, status: 'REGISTERED' },
        { tournament_id: TOURNAMENT_ID, user_id: OPP_ID, status: 'REGISTERED' },
      ],
    });
    await prisma.match.create({
      data: {
        tournament_id: TOURNAMENT_ID,
        round: 1,
        match_number: 1,
        player1_id: PLAYING_ID,
        player2_id: OPP_ID,
        status: 'PENDING',
        phase: 'SWISS',
      },
    });
    const res = await requestJoin(PLAYING_ID);
    expect(res.statusCode).toBe(409);
    const row = await prisma.tournamentParticipant.findFirst({
      where: { tournament_id: TOURNAMENT_ID, user_id: PLAYING_ID },
      select: { status: true },
    });
    expect(row?.status).toBe('REGISTERED'); // not demoted out of the bracket
  });

  it('blocks an already CHECKED_IN player with 409', async () => {
    await prisma.tournamentParticipant.create({
      data: { tournament_id: TOURNAMENT_ID, user_id: LEFTOUT_ID, status: 'CHECKED_IN' },
    });
    const res = await requestJoin(LEFTOUT_ID);
    expect(res.statusCode).toBe(409);
  });
});
