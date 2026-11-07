import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@rizzotto/db';

/**
 * Hidden replays (Alex 2026-11-06): a player can keep his replays hidden for REPLAY_HIDE_DAYS after the game.
 * A game's replay is hidden while ONE of its players has the option on (User.hide_replays, read live, so turning
 * it on also hides the last 30 days and turning it off frees them unless the opponent has it on). Open Play and
 * tournaments alike. The game's players and staff (admins, moderators, the tournament's hosts) always see it.
 */
export const REPLAY_HIDE_DAYS = 30;
const HIDE_MS = REPLAY_HIDE_DAYS * 24 * 60 * 60 * 1000;

export type ReplayViewer = { id: string } | null;

/** AuditLog actions for the option (entity User), read by the admin Players report: who uses it. */
export const REPLAY_PRIVACY_AUDIT = { on: 'REPLAYS_HIDDEN_ON', off: 'REPLAYS_HIDDEN_OFF' } as const;

/** Turn a player's option on or off; a real change is logged. */
export async function setHideReplays(prisma: PrismaClient, userId: string, hidden: boolean): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { hide_replays: true } });
  if (user.hide_replays === hidden) return;
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { hide_replays: hidden } }),
    prisma.auditLog.create({
      data: {
        entity_type: 'User',
        entity_id: userId,
        action: hidden ? REPLAY_PRIVACY_AUDIT.on : REPLAY_PRIVACY_AUDIT.off,
        actor_id: userId,
        old_value: { hidden: !hidden },
        new_value: { hidden },
      },
    }),
  ]);
}

export interface ReplayGame {
  id: string;
  played_at: Date | null;
  reported_at?: Date | null;
  match: { player1_id: string | null; player2_id: string | null; tournament_id: string | null };
}

/**
 * For games with a replay: which ones this viewer may not see yet, and until when (game id → date). Games not
 * in the map are visible. A 2v2 slot is a team, so its members count as the game's players.
 */
export async function hiddenReplays(prisma: PrismaClient, games: ReplayGame[], viewer: ReplayViewer): Promise<Map<string, Date>> {
  const now = Date.now();
  const hiddenUntil = (g: ReplayGame) => new Date((g.played_at ?? g.reported_at ?? new Date(now)).getTime() + HIDE_MS);
  const recent = games.filter((g) => hiddenUntil(g).getTime() > now);
  const out = new Map<string, Date>();
  if (recent.length === 0) return out;

  const slots = [...new Set(recent.flatMap((g) => [g.match.player1_id, g.match.player2_id]).filter((x): x is string => !!x))];
  const members = await prisma.teamMember.findMany({ where: { team_id: { in: slots } }, select: { team_id: true, user_id: true } });
  const playersOf = (slot: string | null): string[] => {
    if (!slot) return [];
    const team = members.filter((m) => m.team_id === slot).map((m) => m.user_id);
    return team.length > 0 ? team : [slot];
  };
  const allPlayers = [...new Set(slots.flatMap((s) => playersOf(s)))];
  const hiders = new Set(
    (await prisma.user.findMany({ where: { id: { in: allPlayers }, hide_replays: true }, select: { id: true } })).map((u) => u.id),
  );
  if (hiders.size === 0) return out;

  // Staff see everything: admins and moderators anywhere, hosts and co-hosts in their tournaments.
  const viewerRow = viewer ? await prisma.user.findUnique({ where: { id: viewer.id }, select: { role: true } }) : null;
  if (viewerRow?.role === 'ADMIN' || viewerRow?.role === 'MODERATOR') return out;
  const tournamentIds = [...new Set(recent.map((g) => g.match.tournament_id).filter((x): x is string => !!x))];
  const hosted = new Set(
    viewer && tournamentIds.length
      ? (
          await prisma.tournament.findMany({
            where: { id: { in: tournamentIds }, OR: [{ host_id: viewer.id }, { co_hosts: { some: { user_id: viewer.id } } }] },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [],
  );

  for (const g of recent) {
    const players = [...playersOf(g.match.player1_id), ...playersOf(g.match.player2_id)];
    if (!players.some((p) => hiders.has(p))) continue;
    if (viewer && players.includes(viewer.id)) continue;
    if (g.match.tournament_id && hosted.has(g.match.tournament_id)) continue;
    out.set(g.id, hiddenUntil(g));
  }
  return out;
}

/** The signed-in viewer if the request carries a valid session, else null (public routes). */
export async function optionalViewer(request: FastifyRequest): Promise<ReplayViewer> {
  try {
    await request.jwtVerify();
    return request.user?.sub ? { id: request.user.sub } : null;
  } catch {
    return null;
  }
}

/**
 * onRequest gate for the replay files (/uploads/replays/<match>/<file>): a hidden replay answers 403 to anyone
 * who may not see it yet, so a link seen earlier stops working for the hidden time too.
 */
export function replayFileGate(prisma: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.url.split('?')[0] ?? '';
    let path = raw;
    try {
      path = decodeURIComponent(raw);
    } catch {
      // a malformed escape can't name a stored replay; look it up as sent
    }
    const game = await prisma.matchGame.findFirst({
      where: { replay_url: path },
      select: { id: true, played_at: true, reported_at: true, match: { select: { player1_id: true, player2_id: true, tournament_id: true } } },
    });
    if (!game) return;
    const until = (await hiddenReplays(prisma, [game], await optionalViewer(request))).get(game.id);
    if (!until) return;
    return reply.code(403).send({
      error: 'Forbidden',
      message: `This replay is hidden until ${until.toISOString()}`,
      statusCode: 403,
    });
  };
}
