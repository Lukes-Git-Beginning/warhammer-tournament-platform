/**
 * Integration test for the 2v2 competitor backbone (team-as-actor).
 *
 * Exercises the Phase A path end-to-end: create a permanent team + partner consent,
 * register the team into a 2v2 tournament, start it (team ids seed the bracket),
 * read the bracket (team names resolve), and report the result as the captain.
 * Also checks the auth seam (only the captain reports) and the registration guards,
 * plus the scoring FK-safety (teams are not written to the user leaderboard).
 *
 * Requires real PostgreSQL. No Redis, no Socket.IO, no Discord (DMs no-op w/o a token).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { createTestUser, cleanupTournament, cleanupUsers, type TestUser } from './helpers/db-fixtures.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function cookieFor(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  const token = app.jwt.sign({ sub: userId, username: 'test', role });
  const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
  return { [cookieName]: token };
}

const createdTournamentIds: string[] = [];
const createdTeamIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTournamentIds) await cleanupTournament(id);
  if (createdTeamIds.length) await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
  if (createdUserIds.length) await cleanupUsers(createdUserIds);
  createdTournamentIds.length = 0;
  createdTeamIds.length = 0;
  createdUserIds.length = 0;
});

interface ActiveTeam {
  teamId: string;
  captain: TestUser;
  partner: TestUser;
  name: string;
}

/** Create a captain + partner, form a team and have the partner accept → ACTIVE. */
async function makeActiveTeam(name: string): Promise<ActiveTeam> {
  const captain = await createTestUser({ username: `${name}-cap` });
  const partner = await createTestUser({ username: `${name}-mate` });
  createdUserIds.push(captain.id, partner.id);

  const created = await app.inject({
    method: 'POST',
    url: '/api/teams',
    cookies: cookieFor(captain.id),
    payload: { name, partner_user_id: partner.id },
  });
  expect(created.statusCode).toBe(201);
  const teamId = created.json().id as string;
  createdTeamIds.push(teamId);

  const accepted = await app.inject({
    method: 'POST',
    url: `/api/teams/${teamId}/accept`,
    cookies: cookieFor(partner.id),
  });
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json().status).toBe('ACTIVE');

  return { teamId, captain, partner, name };
}

/** A host user with the ADMIN DB role, so requireRole (which reads the DB role) lets it start. */
async function createAdminHost(username: string): Promise<TestUser> {
  const host = await createTestUser({ username });
  createdUserIds.push(host.id);
  await prisma.user.update({ where: { id: host.id }, data: { role: 'ADMIN' } });
  return host;
}

async function setup2v2Tournament(hostId: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `test-2v2-${id.slice(0, 8)}`;
  createdTournamentIds.push(id);
  await prisma.tournament.create({
    data: {
      id,
      slug,
      name: '2v2 Test',
      host_id: hostId,
      format: 'SINGLE_ELIMINATION',
      mode: 'BPT',
      competitor_format: 'TWO_V_TWO',
      status: 'OPEN_REGISTRATION',
      start_date: new Date('2027-06-01'),
      timezone: 'Europe/Berlin',
    },
  });
  return { id, slug };
}

function registerTeam(slug: string, captainId: string, teamId: string | undefined) {
  return app.inject({
    method: 'POST',
    url: `/api/tournaments/${slug}/register`,
    cookies: cookieFor(captainId),
    payload: teamId ? { team_id: teamId } : {},
  });
}

describe('2v2 — permanent team lifecycle + team-as-actor', () => {
  it('runs a 2v2 tournament end-to-end and keeps teams off the user leaderboard', async () => {
    const host = await createAdminHost('2v2host');
    const a = await makeActiveTeam('Alpha');
    const b = await makeActiveTeam('Bravo');
    const { id, slug } = await setup2v2Tournament(host.id);

    // Only the captain registers the team.
    expect((await registerTeam(slug, a.captain.id, a.teamId)).statusCode).toBe(201);
    const regB = await registerTeam(slug, b.captain.id, b.teamId);
    expect(regB.statusCode).toBe(201);
    expect(regB.json().participant_type).toBe('TEAM');
    expect(regB.json().team_id).toBe(b.teamId);

    // Start → the two team ids seed the single match (team-as-actor).
    await prisma.tournament.update({ where: { id }, data: { status: 'REGISTRATION_CLOSED' } });
    const start = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${id}/start`,
      cookies: cookieFor(host.id, 'ADMIN'),
    });
    expect(start.statusCode).toBeLessThan(300);

    // Bracket: the slots are TEAM ids, and the competitors map carries the team names.
    const bracket = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/bracket` });
    expect(bracket.statusCode).toBe(200);
    const body = bracket.json();
    const match = body.matches[0];
    const slotIds = [match.player1Id, match.player2Id];
    expect(new Set(slotIds)).toEqual(new Set([a.teamId, b.teamId]));
    expect(body.competitors[a.teamId].type).toBe('TEAM');
    expect(body.competitors[a.teamId].name).toBe('Alpha');
    expect(body.competitors[a.teamId].members).toHaveLength(2);

    // The captain reports the result (winner = their team id).
    const report = await app.inject({
      method: 'POST',
      url: `/api/matches/${match.matchId}/result`,
      cookies: cookieFor(a.captain.id),
      payload: { winnerId: a.teamId },
    });
    expect(report.statusCode).toBe(200);

    const completed = await prisma.match.findUnique({ where: { id: match.matchId }, select: { status: true, winner_id: true } });
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.winner_id).toBe(a.teamId);

    // Scoring FK-safety: a team id must NEVER be written into the user-keyed leaderboard.
    const teamLeaderboard = await prisma.leaderboardEntry.count({ where: { user_id: { in: [a.teamId, b.teamId] } } });
    expect(teamLeaderboard).toBe(0);
  });

  it('lets only the captain report a 2v2 result', async () => {
    const host = await createAdminHost('2v2host2');
    const a = await makeActiveTeam('Gamma');
    const b = await makeActiveTeam('Delta');
    const stranger = await createTestUser({ username: 'stranger' });
    createdUserIds.push(stranger.id);
    const { id, slug } = await setup2v2Tournament(host.id);

    await registerTeam(slug, a.captain.id, a.teamId);
    await registerTeam(slug, b.captain.id, b.teamId);
    await prisma.tournament.update({ where: { id }, data: { status: 'REGISTRATION_CLOSED' } });
    await app.inject({ method: 'POST', url: `/api/tournaments/${id}/start`, cookies: cookieFor(host.id, 'ADMIN') });

    const bracket = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/bracket` });
    const matchId = bracket.json().matches[0].matchId as string;

    // The teammate (non-captain) may NOT report — team-as-actor is the captain only.
    const byMate = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/result`,
      cookies: cookieFor(a.partner.id),
      payload: { winnerId: a.teamId },
    });
    expect(byMate.statusCode).toBe(403);

    // A random user may not report either.
    const byStranger = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/result`,
      cookies: cookieFor(stranger.id),
      payload: { winnerId: a.teamId },
    });
    expect(byStranger.statusCode).toBe(403);

    // The captain can.
    const byCaptain = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/result`,
      cookies: cookieFor(b.captain.id),
      payload: { winnerId: b.teamId },
    });
    expect(byCaptain.statusCode).toBe(200);
  });

  it('guards 2v2 registration (team required, captain-only, must be ACTIVE)', async () => {
    const host = await createTestUser({ username: '2v2host3' });
    createdUserIds.push(host.id);
    const a = await makeActiveTeam('Echo');
    const { slug } = await setup2v2Tournament(host.id);

    // No team_id → 400.
    expect((await registerTeam(slug, a.captain.id, undefined)).statusCode).toBe(400);

    // The teammate (not the captain) cannot register the team → 403.
    expect((await registerTeam(slug, a.partner.id, a.teamId)).statusCode).toBe(403);

    // A FORMING (not yet accepted) team cannot register → 422.
    const cap = await createTestUser({ username: 'Foxtrot-cap' });
    const mate = await createTestUser({ username: 'Foxtrot-mate' });
    createdUserIds.push(cap.id, mate.id);
    const forming = await app.inject({
      method: 'POST',
      url: '/api/teams',
      cookies: cookieFor(cap.id),
      payload: { name: 'Foxtrot', partner_user_id: mate.id },
    });
    const formingTeamId = forming.json().id as string;
    createdTeamIds.push(formingTeamId);
    expect((await registerTeam(slug, cap.id, formingTeamId)).statusCode).toBe(422);
  });
});
