/**
 * Integration tests for pre-start roster visibility.
 *
 * A host/co-host/moderator/admin may review the committed factions and the chosen
 * Balanced-Liechtenstein division BEFORE the tournament starts; regular players and
 * anonymous visitors stay masked (anti-counter-pick) until it starts.
 *
 * Covers GET /api/tournaments/:slug/participants:
 *  1. Manager (host) pre-start → committed faction + requested_band visible
 *  2. Anonymous pre-start → faction masked (null), requested_band null
 *  3. Non-manager player pre-start → faction masked (null), requested_band null
 *  4. Once ONGOING → faction + band public even to an anonymous viewer
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

const HOST_ID   = '1c000000-0000-0000-0000-000000000001';
const PLAYER_ID = '1c000000-0000-0000-0000-000000000002';
const OTHER_ID  = '1c000000-0000-0000-0000-000000000003';

const TOURNAMENT_ID = '1c000000-0000-0000-0001-000000000001';
const FACTION_ID    = 'empire'; // seeded faction slug
const SLUG          = `pv-bali-${TOURNAMENT_ID.slice(-8)}`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    withSocket: false,
    withRedis: false,
    withCron: false,
    withGraphql: false,
    withDraft: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: TOURNAMENT_ID } });
  await prisma.tournament.deleteMany({ where: { id: TOURNAMENT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [HOST_ID, PLAYER_ID, OTHER_ID] } } });
}

beforeEach(async () => {
  await cleanup();

  await prisma.user.createMany({
    data: [
      { id: HOST_ID,   discord_id: 'pv_host',   username: 'PVHost',   email: null, role: 'HOST' },
      { id: PLAYER_ID, discord_id: 'pv_player', username: 'PVPlayer', email: null, role: 'USER' },
      { id: OTHER_ID,  discord_id: 'pv_other',  username: 'PVOther',  email: null, role: 'USER' },
    ],
    skipDuplicates: true,
  });

  // A Balanced-Liechtenstein, single-faction tournament still open for registration.
  await prisma.tournament.create({
    data: {
      id: TOURNAMENT_ID,
      slug: SLUG,
      name: 'PV BaLi Tournament',
      host_id: HOST_ID,
      format: 'BALANCED_LIECHTENSTEIN',
      mode: 'SFT',
      status: 'OPEN_REGISTRATION',
      start_date: new Date('2026-09-01'),
      timezone: 'Europe/Berlin',
    },
  });

  // Player has committed a faction (single + a pool, to exercise both mask paths) and
  // opted into division 3.
  await prisma.tournamentParticipant.create({
    data: {
      id: randomUUID(),
      tournament_id: TOURNAMENT_ID,
      user_id: PLAYER_ID,
      status: 'REGISTERED',
      faction_id: FACTION_ID,
      faction_ids: [FACTION_ID],
      requested_band: 3,
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

type Entry = {
  faction: { id: string } | null;
  faction_ids: string[];
  requested_band: number | null;
  skill_band: number | null;
};

async function fetchRoster(cookie?: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/tournaments/${SLUG}/participants`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: Entry[]; total: number }>();
}

describe('GET /api/tournaments/:slug/participants — pre-start visibility', () => {
  it('1. Manager (host) sees the committed faction and chosen division before start', async () => {
    const body = await fetchRoster(cookieFor(HOST_ID, 'HOST'));
    expect(body.total).toBe(1);
    expect(body.data[0]!.faction?.id).toBe(FACTION_ID);
    expect(body.data[0]!.faction_ids).toEqual([FACTION_ID]);
    expect(body.data[0]!.requested_band).toBe(3);
  });

  it('2. Anonymous viewer gets the faction (and pool) masked and no division before start', async () => {
    const body = await fetchRoster();
    expect(body.total).toBe(1);
    expect(body.data[0]!.faction).toBeNull();
    expect(body.data[0]!.faction_ids).toEqual([]);
    expect(body.data[0]!.requested_band).toBeNull();
  });

  it('3. A non-manager player also gets the faction masked before start', async () => {
    const body = await fetchRoster(cookieFor(OTHER_ID, 'USER'));
    expect(body.data[0]!.faction).toBeNull();
    expect(body.data[0]!.requested_band).toBeNull();
  });

  it('4. Once the tournament is ONGOING the faction and division are public', async () => {
    await prisma.tournament.update({
      where: { id: TOURNAMENT_ID },
      data: { status: 'ONGOING' },
    });
    const body = await fetchRoster(); // anonymous
    expect(body.data[0]!.faction?.id).toBe(FACTION_ID);
    expect(body.data[0]!.requested_band).toBe(3);
  });
});
