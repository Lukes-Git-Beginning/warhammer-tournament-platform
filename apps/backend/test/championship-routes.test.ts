/**
 * Championship finals wiring: the admin-only championship tag on create, the preview endpoints
 * that feed the leaderboard tile, and the seed/raffle error paths. The size-formula math is
 * covered separately in competitive-finals-size.test.ts; here the quarter has no games, so the
 * field is empty (size 0) — which exercises the "not enough activity" + tile-preview paths.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = 'cf1a0000-0000-0000-0000-000000000001';
const USER_ID = 'cf1a0000-0000-0000-0000-000000000002';
const HOST_ID = 'cf1a0000-0000-0000-0000-000000000003';
const INVITEE_ID = 'cf1a0000-0000-0000-0000-000000000004';
const ALL_IDS = [ADMIN_ID, USER_ID, HOST_ID, INVITEE_ID];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false, withGraphql: false, withDraft: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function cleanupAll() {
  // ChampionshipInvite rows cascade when the tournament is deleted (onDelete: Cascade).
  await prisma.tournament.deleteMany({ where: { host_id: { in: ALL_IDS } } });
  await prisma.auditLog.deleteMany({ where: { actor_id: { in: ALL_IDS } } });
  await prisma.competitiveCycleSnapshot.deleteMany({ where: { period: { in: ['2099-Q1', '2099-01'] } } });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

beforeEach(async () => {
  await cleanupAll();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'champ_admin', username: 'ChampAdmin', email: null, role: 'ADMIN' },
      { id: USER_ID, discord_id: 'champ_user', username: 'ChampUser', email: null, role: 'USER' },
      { id: HOST_ID, discord_id: 'champ_host', username: 'ChampHost', email: null, role: 'HOST' },
      { id: INVITEE_ID, discord_id: 'champ_invitee', username: 'ChampInvitee', email: null, role: 'USER' },
    ],
  });
});

afterEach(async () => {
  await cleanupAll();
});

function token(id: string, role: string) {
  return app.jwt.sign({ sub: id, username: 'test', role });
}

const base = {
  name: 'Q3 Domination Championship',
  start_date: '2026-10-05T18:00:00.000Z',
  timezone: 'Europe/Berlin',
  format: 'SINGLE_ELIMINATION',
  battle_type: 'DOMINATION',
  competitor_format: 'ONE_V_ONE',
};

function createChampionship(userId: string, role: string) {
  return app.inject({
    method: 'POST',
    url: '/api/tournaments',
    cookies: { auth_token: token(userId, role) },
    payload: { ...base, championship_kind: 'QUARTERLY', championship_period: '2099-Q1' },
  });
}

function createLadderFinal(userId: string, role: string) {
  return app.inject({
    method: 'POST',
    url: '/api/tournaments',
    cookies: { auth_token: token(userId, role) },
    payload: { ...base, name: 'Monthly Ladder Invitational', championship_kind: 'MONTHLY_LADDER', championship_period: '2099-01' },
  });
}

describe('Championship finals routes', () => {
  it('rejects a non-admin setting the championship tag', async () => {
    const res = await createChampionship(USER_ID, 'USER');
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin create a tagged final and persists the tag', async () => {
    const res = await createChampionship(ADMIN_ID, 'ADMIN');
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: { championship_kind: true, championship_period: true },
    });
    expect(t.championship_kind).toBe('QUARTERLY');
    expect(t.championship_period).toBe('2099-Q1');
  });

  it('rejects the tag without a period', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
      payload: { ...base, championship_kind: 'QUARTERLY' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('quarterly preview lists all three battle types and links the created final', async () => {
    await createChampionship(ADMIN_ID, 'ADMIN');
    const res = await app.inject({ method: 'GET', url: '/api/championships/quarterly?period=2099-Q1&competitorFormat=ONE_V_ONE' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ battleTypes: Array<{ battleType: string; size: number; belowFloor: boolean; tournament: { slug: string } | null }> }>();
    expect(body.battleTypes.map((b) => b.battleType).sort()).toEqual(['CONQUEST', 'DOMINATION', 'SIEGE']);
    const dom = body.battleTypes.find((b) => b.battleType === 'DOMINATION')!;
    expect(dom.size).toBe(0); // no games in the quarter
    expect(dom.belowFloor).toBe(true);
    expect(dom.tournament).not.toBeNull();
  });

  it('seed returns 422 when the field is empty (not enough activity)', async () => {
    const create = await createChampionship(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/seed`,
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
    });
    expect(res.statusCode).toBe(422);
  });

  it('open-availability requires an admin/moderator', async () => {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/open-availability`,
      cookies: { auth_token: token(USER_ID, 'USER') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('open-availability returns 422 for an empty cycle (nobody to invite)', async () => {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/open-availability`,
      cookies: { auth_token: token(ADMIN_ID, 'ADMIN') },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rsvp is 409 before the availability round is opened', async () => {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/rsvp`,
      cookies: { auth_token: token(USER_ID, 'USER') },
      payload: { available: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it('field view is PREVIEW with an empty list for a quiet ladder cycle', async () => {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { slug } = create.json<{ slug: string }>();
    const res = await app.inject({ method: 'GET', url: `/api/championships/${slug}/field` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ phase: string; entries: unknown[] }>();
    expect(body.phase).toBe('PREVIEW');
    expect(body.entries).toEqual([]);
  });

  it('ladder preview returns an empty field for a quiet month', async () => {
    // A month with no Open-Play games — use a far-future period so it stays empty regardless
    // of ambient demo/dev data in the shared DB (the ladder reads global games, not fixtures).
    const res = await app.inject({ method: 'GET', url: '/api/championships/ladder?period=2099-01' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ players: number; size: number; tournament: unknown }>();
    expect(body.players).toBe(0);
    expect(body.size).toBe(0);
    expect(body.tournament).toBeNull();
  });
});

describe('Championship invites — host declines on an invitee\'s behalf', () => {
  /** A ladder final hosted by HOST_ID with the availability round open and INVITEE_ID invited (PENDING). */
  async function openRoundWithInvitee(): Promise<{ slug: string; tournamentId: string }> {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { id, slug } = create.json<{ id: string; slug: string }>();
    await prisma.tournament.update({
      where: { id },
      data: { host_id: HOST_ID, availability_opened_at: new Date(), rsvp_deadline: new Date(Date.now() + 86_400_000) },
    });
    await prisma.championshipInvite.create({
      data: { tournament_id: id, competitor_id: INVITEE_ID, user_id: INVITEE_ID, rank: 1 },
    });
    return { slug, tournamentId: id };
  }

  function managerRsvp(slug: string, actor: [string, string], rsvp: string) {
    return app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/invites/${INVITEE_ID}/rsvp`,
      cookies: { auth_token: token(actor[0], actor[1]) },
      payload: { rsvp },
    });
  }

  const invite = (tournamentId: string) =>
    prisma.championshipInvite.findUniqueOrThrow({
      where: { tournament_id_user_id: { tournament_id: tournamentId, user_id: INVITEE_ID } },
    });

  it('the host can decline an invitee: flagged as manager-set, audit-logged, shown on the field', async () => {
    const { slug, tournamentId } = await openRoundWithInvitee();
    const res = await managerRsvp(slug, [HOST_ID, 'HOST'], 'DECLINED');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ rsvp: string }>().rsvp).toBe('DECLINED');

    const row = await invite(tournamentId);
    expect(row.rsvp).toBe('DECLINED');
    expect(row.rsvp_by_manager).toBe(true);

    const log = await prisma.auditLog.findFirst({ where: { entity_type: 'ChampionshipInvite', entity_id: row.id } });
    expect(log?.actor_id).toBe(HOST_ID);
    expect(log?.action).toBe('rsvp_declined_by_manager');

    const field = await app.inject({ method: 'GET', url: `/api/championships/${slug}/field` });
    const entry = field.json<{ entries: { userId: string; rsvp: string; rsvpByManager: boolean }[] }>()
      .entries.find((e) => e.userId === INVITEE_ID);
    expect(entry).toMatchObject({ rsvp: 'DECLINED', rsvpByManager: true });
  });

  it('undo resets a manager decline back to PENDING', async () => {
    const { slug, tournamentId } = await openRoundWithInvitee();
    await managerRsvp(slug, [HOST_ID, 'HOST'], 'DECLINED');
    const res = await managerRsvp(slug, [HOST_ID, 'HOST'], 'PENDING');
    expect(res.statusCode).toBe(200);
    const row = await invite(tournamentId);
    expect(row.rsvp).toBe('PENDING');
    expect(row.rsvp_by_manager).toBe(false);
    expect(row.rsvp_at).toBeNull();
  });

  it('the invitee\'s own answer overrides a manager decline and clears the flag', async () => {
    const { slug, tournamentId } = await openRoundWithInvitee();
    await managerRsvp(slug, [HOST_ID, 'HOST'], 'DECLINED');
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/rsvp`,
      cookies: { auth_token: token(INVITEE_ID, 'USER') },
      payload: { available: true },
    });
    expect(res.statusCode).toBe(200);
    const row = await invite(tournamentId);
    expect(row.rsvp).toBe('AVAILABLE');
    expect(row.rsvp_by_manager).toBe(false);
  });

  it('staff (admin) may decline too; an unrelated user may not', async () => {
    const { slug } = await openRoundWithInvitee();
    expect((await managerRsvp(slug, [USER_ID, 'USER'], 'DECLINED')).statusCode).toBe(403);
    expect((await managerRsvp(slug, [ADMIN_ID, 'ADMIN'], 'DECLINED')).statusCode).toBe(200);
  });

  it('the host can also mark an invitee AVAILABLE on their behalf (flagged as host-set)', async () => {
    const { slug, tournamentId } = await openRoundWithInvitee();
    const res = await managerRsvp(slug, [HOST_ID, 'HOST'], 'AVAILABLE');
    expect(res.statusCode).toBe(200);
    const row = await invite(tournamentId);
    expect(row.rsvp).toBe('AVAILABLE');
    expect(row.rsvp_by_manager).toBe(true);
    expect((await managerRsvp(slug, [HOST_ID, 'HOST'], 'MAYBE')).statusCode).toBe(400);
  });

  it('a host put on the final may run it (open round / seed get past the permission check)', async () => {
    const create = await createLadderFinal(ADMIN_ID, 'ADMIN');
    const { id, slug } = create.json<{ id: string; slug: string }>();
    await prisma.tournament.update({ where: { id }, data: { host_id: HOST_ID } });
    // Quiet far-future cycle → nobody to invite / seed: 422, i.e. authorised but nothing to do.
    const open = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/open-availability`,
      cookies: { auth_token: token(HOST_ID, 'HOST') },
    });
    expect(open.statusCode).toBe(422);
    const seed = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/seed`,
      cookies: { auth_token: token(HOST_ID, 'HOST') },
    });
    expect(seed.statusCode).toBe(422);
    // …while a host of some OTHER tournament is still refused.
    const outsider = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/seed`,
      cookies: { auth_token: token(USER_ID, 'HOST') },
    });
    expect(outsider.statusCode).toBe(403);
  });

  it('is 409 before the round opens and once the final is seeded; 404 for a non-invitee', async () => {
    // One final per period (unique tag), so check "not open yet" on it before opening the round.
    const { slug, tournamentId } = await openRoundWithInvitee();
    await prisma.tournament.update({ where: { id: tournamentId }, data: { availability_opened_at: null } });
    expect((await managerRsvp(slug, [ADMIN_ID, 'ADMIN'], 'DECLINED')).statusCode).toBe(409);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { availability_opened_at: new Date() } });

    const stranger = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/invites/${USER_ID}/rsvp`,
      cookies: { auth_token: token(HOST_ID, 'HOST') },
      payload: { rsvp: 'DECLINED' },
    });
    expect(stranger.statusCode).toBe(404);

    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournamentId, user_id: INVITEE_ID, status: 'CHECKED_IN' },
    });
    expect((await managerRsvp(slug, [HOST_ID, 'HOST'], 'DECLINED')).statusCode).toBe(409);
  });
});
