/**
 * Championship finals: reserve handling after seeding. The reserve (AVAILABLE invitees outside the
 * field) must stay visible, can be promoted when a finalist drops before the start, seeds are
 * renumbered by frozen rank, and a re-seed must never undo a drop. The quiet far-future period
 * (2099) keeps the ambient ranking empty, so the invites/participants below are the whole truth.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';

const ADMIN_ID = 'cf2b0000-0000-0000-0000-000000000001';
const HOST_ID = 'cf2b0000-0000-0000-0000-000000000002';
const OTHER_HOST_ID = 'cf2b0000-0000-0000-0000-000000000003';
/** Players p1..p7 → ids cf2b0000-...-0000000001{n}. */
const pid = (n: number) => `cf2b0000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;
const PLAYER_IDS = [1, 2, 3, 4, 5, 6, 7].map(pid);
const ALL_IDS = [ADMIN_ID, HOST_ID, OTHER_HOST_ID, ...PLAYER_IDS];
const TEAM_IDS = [1, 2, 3, 4].map((n) => `cf2b0000-0000-0000-0000-0000000002${String(n).padStart(2, '0')}`);

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
  await prisma.tournament.deleteMany({ where: { host_id: { in: ALL_IDS } } });
  await prisma.auditLog.deleteMany({ where: { actor_id: { in: ALL_IDS } } });
  await prisma.competitiveCycleSnapshot.deleteMany({ where: { period: { in: ['2099-Q1', '2099-01'] } } });
  await prisma.team.deleteMany({ where: { id: { in: TEAM_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

beforeEach(async () => {
  await cleanupAll();
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, discord_id: 'res_admin', username: 'ResAdmin', email: null, role: 'ADMIN' },
      { id: HOST_ID, discord_id: 'res_host', username: 'ResHost', email: null, role: 'HOST' },
      { id: OTHER_HOST_ID, discord_id: 'res_other_host', username: 'ResOtherHost', email: null, role: 'HOST' },
      ...PLAYER_IDS.map((id, i) => ({ id, discord_id: `res_p${i + 1}`, username: `ResP${i + 1}`, email: null, role: 'USER' as const })),
    ],
  });
});

afterEach(async () => {
  await cleanupAll();
});

const token = (id: string, role: string) => app.jwt.sign({ sub: id, username: 'test', role });

/**
 * A seeded 1v1 ladder final hosted by HOST_ID: invites p1..p5 + p7 AVAILABLE (rank 1..5, 7),
 * p6 DECLINED (rank 6); field = p1..p4 (seeds 1..4) → reserve = p5, p7.
 */
async function seededFinal(): Promise<{ id: string; slug: string }> {
  const t = await prisma.tournament.create({
    data: {
      slug: `reserve-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Reserve Test Final',
      host_id: HOST_ID,
      format: 'SINGLE_ELIMINATION',
      status: 'REGISTRATION_CLOSED',
      start_date: new Date('2099-01-31T18:00:00.000Z'),
      timezone: 'Europe/Berlin',
      championship_kind: 'MONTHLY_LADDER',
      championship_period: '2099-01',
      availability_opened_at: new Date(),
      rsvp_deadline: new Date(Date.now() + 86_400_000),
    },
  });
  const ranks: Array<[number, number, 'AVAILABLE' | 'DECLINED']> = [[1, 1, 'AVAILABLE'], [2, 2, 'AVAILABLE'], [3, 3, 'AVAILABLE'], [4, 4, 'AVAILABLE'], [5, 5, 'AVAILABLE'], [6, 6, 'DECLINED'], [7, 7, 'AVAILABLE']];
  await prisma.championshipInvite.createMany({
    data: ranks.map(([n, rank, rsvp]) => ({ tournament_id: t.id, competitor_id: pid(n), user_id: pid(n), rank, rsvp })),
  });
  for (const n of [1, 2, 3, 4]) {
    await prisma.tournamentParticipant.create({ data: { tournament_id: t.id, user_id: pid(n), seed: n, status: 'CHECKED_IN' } });
  }
  return { id: t.id, slug: t.slug };
}

const promote = (slug: string, body: unknown, actor: [string, string] = [HOST_ID, 'HOST']) =>
  app.inject({
    method: 'POST',
    url: `/api/championships/${slug}/promote-reserve`,
    cookies: { auth_token: token(actor[0], actor[1]) },
    payload: body as object,
  });

interface FieldBody {
  phase: string;
  freeSlots?: number;
  fieldSize: number;
  entries: Array<{ competitorId: string; rank: number; status?: string; inField: boolean; reserve?: boolean }>;
}
const field = async (slug: string) => (await app.inject({ method: 'GET', url: `/api/championships/${slug}/field` })).json<FieldBody>();

const seedsOf = async (tournamentId: string) =>
  Object.fromEntries(
    (await prisma.tournamentParticipant.findMany({ where: { tournament_id: tournamentId, status: 'CHECKED_IN' } })).map((p) => [p.user_id, p.seed]),
  );

describe('Championship reserve', () => {
  it('the seeded field view lists the reserve (by rank) and withdrawn finalists', async () => {
    const { id, slug } = await seededFinal();
    await prisma.tournamentParticipant.updateMany({ where: { tournament_id: id, user_id: pid(2) }, data: { status: 'WITHDREW' } });
    const view = await field(slug);
    expect(view.phase).toBe('SEEDED');
    expect(view.fieldSize).toBe(3);
    expect(view.freeSlots).toBe(1);
    const reserve = view.entries.filter((e) => e.reserve);
    expect(reserve.map((e) => e.competitorId)).toEqual([pid(5), pid(7)]); // p6 declined → not reserve
    expect(reserve.every((e) => !e.inField)).toBe(true);
    const dropped = view.entries.find((e) => e.competitorId === pid(2));
    expect(dropped).toMatchObject({ status: 'WITHDREW', inField: false });
  });

  it('replaces a finalist with the next reserve: renumbers seeds by rank, declines the dropped invite', async () => {
    const { id, slug } = await seededFinal();
    const res = await promote(slug, { dropCompetitorId: pid(2) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ promoted: { competitorId: string; seed: number } }>().promoted).toMatchObject({ competitorId: pid(5), seed: 4 });

    // p1, p3, p4, p5 by frozen rank → seeds 1..4 (the replacement does not inherit seed 2).
    expect(await seedsOf(id)).toEqual({ [pid(1)]: 1, [pid(3)]: 2, [pid(4)]: 3, [pid(5)]: 4 });
    const dropped = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournament_id: id, user_id: pid(2) } });
    expect(dropped.status).toBe('WITHDREW');
    const inv = await prisma.championshipInvite.findFirstOrThrow({ where: { tournament_id: id, competitor_id: pid(2) } });
    expect(inv).toMatchObject({ rsvp: 'DECLINED', rsvp_by_manager: true });
    const log = await prisma.auditLog.findFirst({ where: { action: 'reserve_promoted', actor_id: HOST_ID } });
    expect(log?.entity_type).toBe('TournamentParticipant');

    const view = await field(slug);
    expect(view.freeSlots).toBe(0);
    expect(view.entries.filter((e) => e.reserve).map((e) => e.competitorId)).toEqual([pid(7)]);
  });

  it('promotes a chosen reserve into a slot freed by a self-drop; refuses when the field is full', async () => {
    const { id, slug } = await seededFinal();
    // Full field, no drop → 409.
    expect((await promote(slug, { promoteCompetitorId: pid(7) })).statusCode).toBe(409);
    // A finalist drops on their own (participants.ts leaves seed + AVAILABLE invite untouched).
    await prisma.tournamentParticipant.updateMany({ where: { tournament_id: id, user_id: pid(1) }, data: { status: 'WITHDREW' } });
    const res = await promote(slug, { promoteCompetitorId: pid(7) });
    expect(res.statusCode).toBe(200);
    expect(await seedsOf(id)).toEqual({ [pid(2)]: 1, [pid(3)]: 2, [pid(4)]: 3, [pid(7)]: 4 });
    // The hole is filled now: another promote without a drop is refused again.
    expect((await promote(slug, { promoteCompetitorId: pid(5) })).statusCode).toBe(409);
  });

  it('is 409 without a reserve, rolling back the drop', async () => {
    const { id, slug } = await seededFinal();
    await prisma.championshipInvite.updateMany({ where: { tournament_id: id, competitor_id: { in: [pid(5), pid(7)] } }, data: { rsvp: 'DECLINED' } });
    const res = await promote(slug, { dropCompetitorId: pid(2) });
    expect(res.statusCode).toBe(409);
    const p = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournament_id: id, user_id: pid(2) } });
    expect(p.status).toBe('CHECKED_IN'); // nothing was changed
  });

  it('validates the body, the status and the permission', async () => {
    const { id, slug } = await seededFinal();
    expect((await promote(slug, {})).statusCode).toBe(400);
    expect((await promote(slug, { dropCompetitorId: pid(2) }, [OTHER_HOST_ID, 'HOST'])).statusCode).toBe(403);
    expect((await promote(slug, { dropCompetitorId: pid(7) })).statusCode).toBe(404); // not in the field
    expect((await promote('no-such-final', { dropCompetitorId: pid(2) })).statusCode).toBe(404);
    expect((await promote(slug, { dropCompetitorId: pid(2) }, [ADMIN_ID, 'ADMIN'])).statusCode).toBe(200); // staff may
    await prisma.tournament.update({ where: { id }, data: { status: 'ONGOING' } });
    expect((await promote(slug, { dropCompetitorId: pid(3) })).statusCode).toBe(409);
  });

  it('re-seeding is locked once seeded, so a drop is never undone', async () => {
    const { id, slug } = await seededFinal();
    await promote(slug, { dropCompetitorId: pid(2) });
    const res = await app.inject({
      method: 'POST',
      url: `/api/championships/${slug}/seed`,
      cookies: { auth_token: token(HOST_ID, 'HOST') },
    });
    expect(res.statusCode).toBe(409);
    const p = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournament_id: id, user_id: pid(2) } });
    expect(p.status).toBe('WITHDREW');
  });

  it('matches 2v2 competitors by team id (captain participant carries team_id)', async () => {
    const t = await prisma.tournament.create({
      data: {
        slug: `reserve-2v2-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Reserve 2v2 Final',
        host_id: HOST_ID,
        format: 'SINGLE_ELIMINATION',
        status: 'REGISTRATION_CLOSED',
        start_date: new Date('2099-03-31T18:00:00.000Z'),
        timezone: 'Europe/Berlin',
        championship_kind: 'QUARTERLY',
        championship_period: '2099-Q1',
        battle_type: 'DOMINATION',
        competitor_format: 'TWO_V_TWO',
        availability_opened_at: new Date(),
      },
    });
    // Team n: captain p(2n-1), mate p(2n); teams 1-3 in the field, team 4 reserve.
    for (const [i, teamId] of TEAM_IDS.entries()) {
      const captain = pid(2 * i + 1);
      await prisma.team.create({
        data: { id: teamId, name: `ResTeam${i + 1}`, roster_key: `res-${teamId}`, captain_id: captain, status: 'ACTIVE' },
      });
      await prisma.championshipInvite.create({
        data: { tournament_id: t.id, competitor_id: teamId, user_id: captain, rank: i + 1, rsvp: 'AVAILABLE' },
      });
      if (i < 3) {
        await prisma.tournamentParticipant.create({
          data: { tournament_id: t.id, user_id: captain, team_id: teamId, participant_type: 'TEAM', seed: i + 1, status: 'CHECKED_IN' },
        });
      }
    }
    const before = await field(t.slug);
    expect(before.entries.filter((e) => e.reserve).map((e) => e.competitorId)).toEqual([TEAM_IDS[3]]);
    expect(before.entries.filter((e) => e.inField).map((e) => e.competitorId)).toEqual(TEAM_IDS.slice(0, 3));

    const res = await promote(t.slug, { dropCompetitorId: TEAM_IDS[0] });
    expect(res.statusCode).toBe(200);
    const row = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournament_id: t.id, team_id: TEAM_IDS[3] } });
    expect(row).toMatchObject({ user_id: pid(7), participant_type: 'TEAM', status: 'CHECKED_IN', seed: 3 });
    const after = await field(t.slug);
    expect(after.entries.filter((e) => e.inField).map((e) => [e.competitorId, e.rank])).toEqual([
      [TEAM_IDS[1], 1],
      [TEAM_IDS[2], 2],
      [TEAM_IDS[3], 3],
    ]);
    expect(after.entries.some((e) => e.reserve)).toBe(false);
  });
});
