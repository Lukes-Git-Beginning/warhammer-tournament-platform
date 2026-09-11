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
import { resolveCompetitorRecipients } from '../src/lib/discord-notify.js';
import { finalizeGameResult } from '../src/lib/match-games.js';

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

async function setup2v2Tournament(
  hostId: string,
  mode: 'BPT_2V2' | 'SFT_2V2' = 'BPT_2V2',
): Promise<{ id: string; slug: string }> {
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
      mode,
      competitor_format: 'TWO_V_TWO',
      status: 'OPEN_REGISTRATION',
      start_date: new Date('2027-06-01'),
      timezone: 'Europe/Berlin',
    },
  });
  return { id, slug };
}

function registerTeam(slug: string, captainId: string, teamId: string | undefined, factionIds?: string[]) {
  const payload: Record<string, unknown> = {};
  if (teamId) payload.team_id = teamId;
  if (factionIds) payload.faction_ids = factionIds;
  return app.inject({
    method: 'POST',
    url: `/api/tournaments/${slug}/register`,
    cookies: cookieFor(captainId),
    payload,
  });
}

async function fourFactionIds(): Promise<[string, string, string, string] | null> {
  const f = await prisma.faction.findMany({ take: 4, select: { id: true }, orderBy: { id: 'asc' } });
  return f.length >= 4 ? [f[0]!.id, f[1]!.id, f[2]!.id, f[3]!.id] : null;
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

  it('SFT_2V2 pre-picks and stamps both members’ factions positionally', async () => {
    const factions = await fourFactionIds();
    if (!factions) return; // <4 seeded factions → skip
    const [f0, f1, f2, f3] = factions;
    const host = await createAdminHost('2v2sfthost');
    const a = await makeActiveTeam('India');
    const b = await makeActiveTeam('Juliet');
    const { id, slug } = await setup2v2Tournament(host.id, 'SFT_2V2');

    // Missing factions → 400; exactly 2 required.
    expect((await registerTeam(slug, a.captain.id, a.teamId, [f0])).statusCode).toBe(400);
    expect((await registerTeam(slug, a.captain.id, a.teamId, [f0, f1])).statusCode).toBe(201);
    expect((await registerTeam(slug, b.captain.id, b.teamId, [f2, f3])).statusCode).toBe(201);

    await prisma.tournament.update({ where: { id }, data: { status: 'REGISTRATION_CLOSED' } });
    await app.inject({ method: 'POST', url: `/api/tournaments/${id}/start`, cookies: cookieFor(host.id, 'ADMIN') });

    const bracket = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/bracket` });
    const match = bracket.json().matches[0];
    const side1 = match.player1Id === a.teamId ? [f0, f1] : [f2, f3];
    const side2 = match.player1Id === a.teamId ? [f2, f3] : [f0, f1];

    // Bracket shows both factions per side from registration (pre-report), positional to slots.
    expect(match.player1FactionId).toBe(side1[0]);
    expect(match.player1FactionId2).toBe(side1[1]);
    expect(match.player2FactionId).toBe(side2[0]);
    expect(match.player2FactionId2).toBe(side2[1]);

    // Report → the game stores all four factions positionally.
    const report = await app.inject({
      method: 'POST',
      url: `/api/matches/${match.matchId}/result`,
      cookies: cookieFor(a.captain.id),
      payload: { winnerId: a.teamId },
    });
    expect(report.statusCode).toBe(200);

    const game = await prisma.matchGame.findFirst({
      where: { match_id: match.matchId },
      select: { player1_faction_id: true, player1_faction_id_2: true, player2_faction_id: true, player2_faction_id_2: true },
    });
    expect([game?.player1_faction_id, game?.player1_faction_id_2]).toEqual(side1);
    expect([game?.player2_faction_id, game?.player2_faction_id_2]).toEqual(side2);
  });

  it('BPT_2V2 lets the captain blind-lock both factions and stamps them on report', async () => {
    const factions = await fourFactionIds();
    if (!factions) return; // <4 seeded factions → skip
    const [f0, f1, f2, f3] = factions;
    const host = await createAdminHost('2v2bpthost');
    const a = await makeActiveTeam('Kilo');
    const b = await makeActiveTeam('Lima');
    const { id, slug } = await setup2v2Tournament(host.id, 'BPT_2V2');

    expect((await registerTeam(slug, a.captain.id, a.teamId)).statusCode).toBe(201);
    expect((await registerTeam(slug, b.captain.id, b.teamId)).statusCode).toBe(201);
    await prisma.tournament.update({ where: { id }, data: { status: 'REGISTRATION_CLOSED' } });
    await app.inject({ method: 'POST', url: `/api/tournaments/${id}/start`, cookies: cookieFor(host.id, 'ADMIN') });

    const bracket = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/bracket` });
    const match = bracket.json().matches[0];
    const matchId = match.matchId as string;
    const aIsP1 = match.player1Id === a.teamId;

    // Bring the match to the blind-pick-ready state (game with a decided map).
    const mapRow = await prisma.map.findFirst({ select: { id: true } });
    const game = await prisma.matchGame.create({ data: { match_id: matchId, game_number: 1, status: 'PENDING' } });
    await prisma.matchMapDecision.create({
      data: {
        game_id: game.id,
        mode: 'RANDOM_NO_REPEAT',
        coin_flip_seed: 'test',
        top_player_id: a.teamId,
        bottom_player_id: b.teamId,
        bans_top: [],
        bans_bottom: [],
        picked_map_id: mapRow?.id ?? 'test-map',
        decided_at: new Date(),
      },
    });

    const lock = (captainId: string, factionId: string, factionId2?: string) =>
      app.inject({
        method: 'POST',
        url: `/api/matches/${matchId}/decision/blind-pick/lock`,
        cookies: cookieFor(captainId),
        payload: factionId2 ? { faction_id: factionId, faction_id_2: factionId2 } : { faction_id: factionId },
      });

    // A non-captain (the teammate) may not lock for the team.
    expect((await lock(a.partner.id, f0, f1)).statusCode).toBe(403);
    // 2v2 requires BOTH factions.
    expect((await lock(a.captain.id, f0)).statusCode).toBe(400);

    // Both captains lock their pair → reveal.
    expect((await lock(a.captain.id, f0, f1)).statusCode).toBe(200);
    expect((await lock(b.captain.id, f2, f3)).statusCode).toBe(200);

    const bp = await prisma.matchBlindPick.findUnique({ where: { game_id: game.id } });
    expect(bp?.revealed_at).not.toBeNull();
    const side1 = aIsP1 ? [f0, f1] : [f2, f3];
    const side2 = aIsP1 ? [f2, f3] : [f0, f1];
    expect([bp?.player1_faction_id, bp?.player1_faction_id_2]).toEqual(side1);
    expect([bp?.player2_faction_id, bp?.player2_faction_id_2]).toEqual(side2);

    // Report (captain) → completeMatch stamps all four factions from the revealed blind pick.
    const report = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/result`,
      cookies: cookieFor(a.captain.id),
      payload: { winnerId: a.teamId },
    });
    expect(report.statusCode).toBe(200);

    const stamped = await prisma.matchGame.findFirst({
      where: { match_id: matchId },
      select: { player1_faction_id: true, player1_faction_id_2: true, player2_faction_id: true, player2_faction_id_2: true },
    });
    expect([stamped?.player1_faction_id, stamped?.player1_faction_id_2]).toEqual(side1);
    expect([stamped?.player2_faction_id, stamped?.player2_faction_id_2]).toEqual(side2);
  });

  it('resolves a 2v2 team competitor to BOTH members (captain first) so match DMs reach all four', async () => {
    const team = await makeActiveTeam('Mike');
    const solo = await createTestUser({ username: 'solo-competitor' });
    createdUserIds.push(solo.id);

    const map = await resolveCompetitorRecipients([team.teamId, solo.id]);

    // A 1v1 (user) slot → the single user.
    const soloRecips = map.get(solo.id) ?? [];
    expect(soloRecips).toHaveLength(1);
    expect(soloRecips[0]!.user_id).toBe(solo.id);
    expect(soloRecips[0]!.discord_id).toBe(solo.discord_id);

    // A 2v2 (team) slot → BOTH members, captain first, each with a usable discord_id.
    const teamRecips = map.get(team.teamId) ?? [];
    expect(teamRecips).toHaveLength(2);
    expect(teamRecips[0]!.is_captain).toBe(true);
    expect(teamRecips[0]!.user_id).toBe(team.captain.id);
    expect(teamRecips.map((r) => r.user_id).sort()).toEqual(
      [team.captain.id, team.partner.id].sort(),
    );
    expect(teamRecips.every((r) => !!r.discord_id)).toBe(true);
  });

  it('per-game GameTile flow: only the captain may report, and finalize stamps all four factions', async () => {
    const factions = await fourFactionIds();
    if (!factions) return; // <4 seeded factions → skip
    const [f0, f1, f2, f3] = factions;
    const host = await createAdminHost('2v2gametilehost');
    const a = await makeActiveTeam('November');
    const b = await makeActiveTeam('Oscar');
    const { id, slug } = await setup2v2Tournament(host.id, 'BPT_2V2');
    await registerTeam(slug, a.captain.id, a.teamId);
    await registerTeam(slug, b.captain.id, b.teamId);
    await prisma.tournament.update({ where: { id }, data: { status: 'REGISTRATION_CLOSED' } });
    await app.inject({ method: 'POST', url: `/api/tournaments/${id}/start`, cookies: cookieFor(host.id, 'ADMIN') });

    const bracket = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/bracket` });
    const match = bracket.json().matches[0];
    const matchId = match.matchId as string;
    const aIsP1 = match.player1Id === a.teamId;

    // Auth: a teammate (non-captain) may NOT report a game — team-as-actor is the captain.
    // (403 is returned before any multipart parsing, so a plain payload is enough.)
    const byMate = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/games/1/result`,
      cookies: cookieFor(a.partner.id),
      payload: { winner_id: a.teamId },
    });
    expect(byMate.statusCode).toBe(403);

    // Set up game 1 with a decided map + a revealed blind pick holding both members per side,
    // then run the per-game finalizer directly and assert it stamps all four factions.
    const mapRow = await prisma.map.findFirst({ select: { id: true } });
    const game = await prisma.matchGame.create({ data: { match_id: matchId, game_number: 1, status: 'PENDING' } });
    await prisma.matchMapDecision.create({
      data: {
        game_id: game.id, mode: 'RANDOM_NO_REPEAT', coin_flip_seed: 'test',
        top_player_id: a.teamId, bottom_player_id: b.teamId, bans_top: [], bans_bottom: [],
        picked_map_id: mapRow?.id ?? 'test-map', decided_at: new Date(),
      },
    });
    const side1 = aIsP1 ? [f0, f1] : [f2, f3];
    const side2 = aIsP1 ? [f2, f3] : [f0, f1];
    await prisma.matchBlindPick.create({
      data: {
        game_id: game.id,
        player1_faction_id: side1[0], player1_faction_id_2: side1[1],
        player2_faction_id: side2[0], player2_faction_id_2: side2[1],
        player1_locked_at: new Date(), player2_locked_at: new Date(), revealed_at: new Date(),
      },
    });
    await prisma.matchGame.update({ where: { id: game.id }, data: { reported_winner_id: a.teamId } });

    await finalizeGameResult(app, game.id);

    const g = await prisma.matchGame.findUnique({
      where: { id: game.id },
      select: { status: true, winner_id: true, player1_faction_id: true, player1_faction_id_2: true, player2_faction_id: true, player2_faction_id_2: true },
    });
    expect(g?.status).toBe('COMPLETED');
    expect(g?.winner_id).toBe(a.teamId);
    expect([g?.player1_faction_id, g?.player1_faction_id_2]).toEqual(side1);
    expect([g?.player2_faction_id, g?.player2_faction_id_2]).toEqual(side2);
  });

  it('exposes a public team directory and team profile', async () => {
    const a = await makeActiveTeam('Romeo');

    const all = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(all.statusCode).toBe(200);
    const teams = all.json().teams as Array<{ id: string; name: string; members: unknown[] }>;
    const listed = teams.find((t) => t.id === a.teamId);
    expect(listed?.name).toBe('Romeo');
    expect(listed?.members).toHaveLength(2);

    const prof = await app.inject({ method: 'GET', url: `/api/teams/${a.teamId}` });
    expect(prof.statusCode).toBe(200);
    const body = prof.json();
    expect(body.name).toBe('Romeo');
    expect(body.members[0].is_captain).toBe(true);
    expect(body.record).toEqual({ matchesPlayed: 0, matchesWon: 0 });
    expect(body.gs).toBeNull(); // no rated games yet
    expect(Array.isArray(body.tournaments)).toBe(true);

    const missing = await app.inject({ method: 'GET', url: `/api/teams/${randomUUID()}` });
    expect(missing.statusCode).toBe(404);
  });

  it('lists 2v2 participants as teams with both members (captain first)', async () => {
    const host = await createAdminHost('2v2partshost');
    const a = await makeActiveTeam('Quebec');
    const { slug } = await setup2v2Tournament(host.id);
    await registerTeam(slug, a.captain.id, a.teamId);

    const res = await app.inject({ method: 'GET', url: `/api/tournaments/${slug}/participants` });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{
      team: { name: string; members: { id: string; is_captain: boolean }[] } | null;
    }>;
    const teamRow = rows.find((r) => r.team);
    expect(teamRow?.team?.name).toBe('Quebec');
    expect(teamRow?.team?.members).toHaveLength(2);
    expect(teamRow?.team?.members[0]!.is_captain).toBe(true);
    expect(teamRow?.team?.members[0]!.id).toBe(a.captain.id);
    expect(teamRow?.team?.members.map((m) => m.id).sort()).toEqual([a.captain.id, a.partner.id].sort());
  });

  it('lets either team member self-withdraw the whole team before start', async () => {
    const host = await createAdminHost('2v2withdrawhost');
    const a = await makeActiveTeam('Papa');
    const { id, slug } = await setup2v2Tournament(host.id);
    expect((await registerTeam(slug, a.captain.id, a.teamId)).statusCode).toBe(201);

    // The teammate (no row of their own) still sees the team as registered via /participants/me.
    const mePartner = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${slug}/participants/me`,
      cookies: cookieFor(a.partner.id),
    });
    expect(mePartner.json().status).toBe('REGISTERED');

    // The TEAMMATE (not the captain, who holds the participant row) withdraws → the whole
    // team's row goes WITHDREW (a 2v2 needs both, so either member may pull it out).
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${slug}/withdraw`,
      cookies: cookieFor(a.partner.id),
    });
    expect(res.statusCode).toBe(200);

    const part = await prisma.tournamentParticipant.findFirst({
      where: { tournament_id: id, team_id: a.teamId },
      select: { status: true },
    });
    expect(part?.status).toBe('WITHDREW');
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
