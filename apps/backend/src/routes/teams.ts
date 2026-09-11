import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendDm } from '../lib/discord-notify.js';

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
        return reply.code(409).send({ error: 'Conflict', message: 'A team with this exact pairing already exists', statusCode: 409 });
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
