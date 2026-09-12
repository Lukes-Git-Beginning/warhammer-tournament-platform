import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendDm } from '../lib/discord-notify.js';
import { getRatingModel } from '../lib/rating-model-service.js';
import { skillToBand, logistic } from '../lib/rating-model.js';
import { blendSkill } from '../lib/skill-classification.js';

// The team's own 2v2 GS is worth this many balanced games against the members' average-GS
// prior, so a fresh duo starts at its members' strength and converges to its real team rating.
// A dial candidate (AdminConfig) once teams have played enough to calibrate it.
const TEAM_GS_PRIOR_EQUIV_GAMES = 10;

// ---------------------------------------------------------------------------
// Teams — permanent 2v2 competitors (design doc §5, plans/2v2-competitor-
// implementation.md). A team is a fixed pairing identified by its roster (find-or-
// create by roster_key). The captain creates it and invites a partner, who confirms
// via a Discord DM (consent). Only an ACTIVE team may register for a 2v2 tournament.
// ---------------------------------------------------------------------------

const CreateTeamSchema = z.object({
  name: z.string().trim().min(2).max(40),
  partner_user_id: z.string().uuid(),
});

/** Canonical, order-independent identity for a duo — the permanent team key. */
function rosterKey(userIds: string[]): string {
  return [...userIds].sort().join(':');
}

interface TeamMemberRow {
  user_id: string;
  role: string | null;
  accepted_at: Date | null;
  user: { username: string; avatar_url: string | null };
}

function memberDto(m: TeamMemberRow, captainId: string) {
  return {
    user_id: m.user_id,
    username: m.user.username,
    avatar_url: m.user.avatar_url ?? null,
    is_captain: m.user_id === captainId,
    accepted: m.accepted_at !== null,
  };
}

const teamRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/teams — captain creates a team and invites a partner (Discord-DM consent).
  fastify.post('/api/teams', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = CreateTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const captainId = request.user.sub;
    const { name, partner_user_id } = parsed.data;

    if (partner_user_id === captainId) {
      return reply.code(400).send({ error: 'BadRequest', message: 'You cannot team up with yourself', statusCode: 400 });
    }
    const partner = await fastify.prisma.user.findFirst({
      where: { id: partner_user_id, deleted_at: null },
      select: { id: true, discord_id: true, username: true },
    });
    if (!partner) {
      return reply.code(404).send({ error: 'NotFound', message: 'Partner not found', statusCode: 404 });
    }

    const key = rosterKey([captainId, partner_user_id]);
    // Find-or-create by roster identity: the same duo is always the same permanent team.
    // A live team (FORMING/ACTIVE) blocks re-creation; an ARCHIVED one is reactivated.
    const existing = await fastify.prisma.team.findUnique({
      where: { roster_key: key },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'ARCHIVED') {
      return reply.code(409).send({ error: 'Conflict', message: 'A team with this exact pairing already exists', statusCode: 409 });
    }

    // Team names are unique among live (non-archived) teams, case-insensitive — a dissolved
    // team frees its name. (DB-enforced by a partial unique index; checked here for a clear error.)
    const nameClash = await fastify.prisma.team.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        status: { not: 'ARCHIVED' },
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (nameClash) {
      return reply.code(409).send({ error: 'Conflict', message: 'A team with this name already exists — pick another', statusCode: 409 });
    }

    const captainUser = await fastify.prisma.user.findUnique({ where: { id: captainId }, select: { username: true } });
    const memberCreate = [
      { user_id: captainId, role: 'captain', accepted_at: new Date() },
      { user_id: partner_user_id, role: 'core' },
    ];

    let teamId: string;
    try {
      if (existing) {
        const t = await fastify.prisma.team.update({
          where: { id: existing.id },
          data: {
            name,
            captain_id: captainId,
            status: 'FORMING',
            archived_at: null,
            members: { deleteMany: {}, create: memberCreate },
          },
          select: { id: true },
        });
        teamId = t.id;
      } else {
        const t = await fastify.prisma.team.create({
          data: {
            name,
            roster_key: key,
            size: 2,
            captain_id: captainId,
            status: 'FORMING',
            members: { create: memberCreate },
          },
          select: { id: true },
        });
        teamId = t.id;
      }
    } catch (err: unknown) {
      if (err !== null && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        const target = (err as { meta?: { target?: unknown } }).meta?.target;
        const isName =
          typeof target === 'string'
            ? target.includes('name')
            : Array.isArray(target) && target.some((t) => String(t).includes('name'));
        return reply.code(409).send({
          error: 'Conflict',
          message: isName ? 'A team with this name already exists — pick another' : 'A team with this exact pairing already exists',
          statusCode: 409,
        });
      }
      throw err;
    }

    // Ask the partner to confirm (consent) via Discord DM.
    if (partner.discord_id) {
      void sendDm(
        partner.discord_id,
        `**${captainUser?.username ?? 'A captain'}** invited you to team up as **${name}** for 2v2. Open Rizzotto and go to your Teams to accept or decline.`,
      );
    }

    request.log.info({ teamId, captainId, partnerId: partner_user_id }, 'Team created (2v2 invite sent)');
    return reply.code(201).send({ id: teamId, status: 'FORMING' });
  });

  // GET /api/teams/me — the teams the caller belongs to (as captain or member).
  fastify.get('/api/teams/me', { preHandler: fastify.authenticate }, async (request) => {
    const uid = request.user.sub;
    const teams = await fastify.prisma.team.findMany({
      where: { members: { some: { user_id: uid } }, status: { not: 'ARCHIVED' } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        captain_id: true,
        created_at: true,
        members: {
          select: { user_id: true, role: true, accepted_at: true, user: { select: { username: true, avatar_url: true } } },
        },
      },
    });
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        is_captain: t.captain_id === uid,
        created_at: t.created_at.toISOString(),
        members: t.members.map((m) => memberDto(m, t.captain_id)),
      })),
    };
  });

  // GET /api/teams — all non-archived teams (public), for the Teams directory. The caller's own
  // teams come from /api/teams/me; the UI divides "your teams" from the rest.
  fastify.get('/api/teams', async () => {
    const teams = await fastify.prisma.team.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        name: true,
        status: true,
        captain_id: true,
        created_at: true,
        members: {
          select: { user_id: true, role: true, accepted_at: true, user: { select: { username: true, avatar_url: true } } },
        },
      },
    });
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        created_at: t.created_at.toISOString(),
        members: t.members.map((m) => memberDto(m, t.captain_id)),
      })),
    };
  });

  // GET /api/teams/:id — public team profile: roster, status, match record, tournament history.
  fastify.get('/api/teams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const team = await fastify.prisma.team.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        captain_id: true,
        created_at: true,
        members: {
          select: { user_id: true, role: true, accepted_at: true, user: { select: { username: true, avatar_url: true } } },
        },
      },
    });
    if (!team) return reply.code(404).send({ error: 'NotFound', message: 'Team not found', statusCode: 404 });

    // Team GS (General Skill). A team is an opaque competitor in the timeless rating fit, so it
    // earns a fitted GS just like a player. Cold-start (Alex 2026-09-12): blend the members'
    // average individual GS (prior) with the team's own fitted 2v2 GS (data) — a fresh duo shows
    // its members' strength immediately and converges to its real team rating as it plays.
    const model = await getRatingModel(fastify.prisma, fastify.redis, {
      versionId: null,
      config: { hierarchical: true },
    });
    const teamEntry = model.generalSkills.find((e) => e.playerId === id);
    const memberSkills = team.members
      .map((m) => model.generalSkills.find((e) => e.playerId === m.user_id)?.generalSkill)
      .filter((s): s is number => s != null);
    const priorMu = memberSkills.length
      ? memberSkills.reduce((a, b) => a + b, 0) / memberSkills.length
      : null;

    let gs: {
      generalSkill: number;
      stdError: number;
      band: number;
      winChance: number;
      gamesCount: number;
      provisional: boolean;
      fromMembers: boolean;
    } | null = null;
    if (priorMu != null || teamEntry) {
      const base =
        priorMu != null
          ? blendSkill(
              priorMu,
              { generalSkill: teamEntry?.generalSkill ?? null, stdError: teamEntry?.stdError ?? null },
              TEAM_GS_PRIOR_EQUIV_GAMES,
            )
          : { skill: teamEntry!.generalSkill, se: teamEntry!.stdError };
      const teamGames = teamEntry?.gamesCount ?? 0;
      gs = {
        generalSkill: base.skill,
        stdError: base.se,
        band: skillToBand(base.skill),
        winChance: logistic(base.skill),
        gamesCount: teamGames,
        // Still leaning on the members' prior until the team has enough of its own games.
        provisional: priorMu != null && teamGames < TEAM_GS_PRIOR_EQUIV_GAMES,
        fromMembers: teamGames === 0,
      };
    }

    // Team-as-actor: the team id sits in the opaque Match competitor slots.
    const [matchesPlayed, matchesWon, parts] = await Promise.all([
      fastify.prisma.match.count({
        where: { deleted_at: null, status: 'COMPLETED', OR: [{ player1_id: id }, { player2_id: id }] },
      }),
      fastify.prisma.match.count({ where: { deleted_at: null, status: 'COMPLETED', winner_id: id } }),
      fastify.prisma.tournamentParticipant.findMany({
        where: { team_id: id, deleted_at: null },
        orderBy: { registered_at: 'desc' },
        select: {
          status: true,
          tournament: { select: { slug: true, name: true, status: true, start_date: true } },
        },
      }),
    ]);

    return {
      id: team.id,
      name: team.name,
      status: team.status,
      captain_id: team.captain_id,
      created_at: team.created_at.toISOString(),
      members: team.members.map((m) => memberDto(m, team.captain_id)),
      gs,
      record: { matchesPlayed, matchesWon },
      tournaments: parts.map((p) => ({
        slug: p.tournament.slug,
        name: p.tournament.name,
        status: p.tournament.status,
        participantStatus: p.status,
        start_date: p.tournament.start_date.toISOString(),
      })),
    };
  });

  // POST /api/teams/:id/accept — the invited partner confirms; team turns ACTIVE once all accepted.
  fastify.post('/api/teams/:id/accept', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = request.user.sub;
    const member = await fastify.prisma.teamMember.findFirst({
      where: { team_id: id, user_id: uid },
      select: { id: true, accepted_at: true, team: { select: { status: true, captain_id: true, name: true } } },
    });
    if (!member) return reply.code(404).send({ error: 'NotFound', message: 'You are not on this team', statusCode: 404 });
    if (member.accepted_at) return reply.code(409).send({ error: 'Conflict', message: 'You have already accepted', statusCode: 409 });

    await fastify.prisma.teamMember.update({ where: { id: member.id }, data: { accepted_at: new Date() } });
    const stillPending = await fastify.prisma.teamMember.count({ where: { team_id: id, accepted_at: null } });
    const nowActive = stillPending === 0;
    if (nowActive) {
      await fastify.prisma.team.update({ where: { id }, data: { status: 'ACTIVE' } });
    }

    // Let the captain know.
    const [captain, me] = await Promise.all([
      fastify.prisma.user.findUnique({ where: { id: member.team.captain_id }, select: { discord_id: true } }),
      fastify.prisma.user.findUnique({ where: { id: uid }, select: { username: true } }),
    ]);
    if (captain?.discord_id) {
      void sendDm(captain.discord_id, `**${me?.username ?? 'Your teammate'}** accepted your invite — **${member.team.name}** is ready to compete.`);
    }

    return reply.code(200).send({ ok: true, status: nowActive ? 'ACTIVE' : 'FORMING' });
  });

  // POST /api/teams/:id/decline — the invited partner declines; a never-active team is removed.
  fastify.post('/api/teams/:id/decline', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = request.user.sub;
    const team = await fastify.prisma.team.findUnique({
      where: { id },
      select: { id: true, status: true, captain_id: true, name: true, members: { select: { user_id: true, accepted_at: true } } },
    });
    if (!team) return reply.code(404).send({ error: 'NotFound', message: 'Team not found', statusCode: 404 });
    const myMembership = team.members.find((m) => m.user_id === uid);
    if (!myMembership) return reply.code(404).send({ error: 'NotFound', message: 'You are not on this team', statusCode: 404 });
    if (uid === team.captain_id) {
      return reply.code(400).send({ error: 'BadRequest', message: 'The captain cannot decline their own team', statusCode: 400 });
    }
    if (team.status === 'ACTIVE') {
      return reply.code(409).send({ error: 'Conflict', message: 'This team is already active — it cannot be declined', statusCode: 409 });
    }

    // A FORMING team never played → remove it (frees the roster key for a fresh invite).
    await fastify.prisma.team.delete({ where: { id } });

    const captain = await fastify.prisma.user.findUnique({ where: { id: team.captain_id }, select: { discord_id: true } });
    const me = await fastify.prisma.user.findUnique({ where: { id: uid }, select: { username: true } });
    if (captain?.discord_id) {
      void sendDm(captain.discord_id, `**${me?.username ?? 'Your invitee'}** declined the invite to **${team.name}**.`);
    }

    return reply.code(200).send({ ok: true });
  });
};

export default teamRoutes;
