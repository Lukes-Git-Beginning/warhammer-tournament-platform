/**
 * What the bot says around a cancelled Open Play match. The other side hears that he can still report
 * the battle. If the player who cancelled then turns out to have lost it, every admin gets a DM and
 * decides: a ban tells the player why and how to reach the admin team, no ban closes the case.
 */
import type { FastifyInstance } from 'fastify';
import { banUser } from './ban-user.js';
import { lateReportDeadline } from './cancel-open-play-match.js';
import { captainMap, isCompetitorMember, resolveCompetitors } from './competitors.js';
import { discordRequest, isBotConfigured, sendDm } from './discord-notify.js';
import { areOpenPlayTesters, postDm, refreshMatchCards, sendMatchCard, siteUrl, type DiscordMessage } from './discord-open-play.js';

const matchUrl = (matchId: string) => `${siteUrl()}/matches/${matchId}`;

// A hash, so each write stands alone: body, links, outcome, and `m:<channelId>` = the DM per admin.
const ALERT_KEY = (matchId: string) => `rizzotto:dop:cancelalert:${matchId}`;
const ALERT_TTL = 90 * 24 * 3600;

/** Tell the other side the moment a player cancels a match that got to the battle. Never throws. */
export async function notifyOpponentOfCancel(fastify: FastifyInstance, matchId: string): Promise<void> {
  try {
    if (!isBotConfigured()) return;
    const prisma = fastify.prisma;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true, player1_id: true, player2_id: true, competitor_format: true, cancelled_at: true, cancelled_by_id: true, cancelled_slot: true },
    });
    const deadline = match ? lateReportDeadline(match) : null;
    if (!match || !deadline || !match.cancelled_by_id) return;

    await refreshMatchCards(fastify, matchId);
    const battle = await prisma.matchGame.findFirst({
      where: { match_id: matchId, status: 'CANCELLED', blind_pick: { revealed_at: { not: null } } },
      select: { id: true },
    });
    if (!battle) return;

    const otherSlot = match.player1_id === match.cancelled_slot ? match.player2_id : match.player1_id;
    if (!otherSlot) return;
    const isTeam = match.competitor_format === 'TWO_V_TWO';
    const otherUserId = isTeam ? (await captainMap(prisma, [otherSlot])).get(otherSlot) : otherSlot;
    if (!otherUserId) return;
    const [other, canceller] = await Promise.all([
      prisma.user.findUnique({ where: { id: otherUserId }, select: { discord_id: true } }),
      prisma.user.findUnique({ where: { id: match.cancelled_by_id }, select: { username: true } }),
    ]);
    if (!other?.discord_id) return;

    // A new message notifies, an edit doesn't. The card can take the report right there.
    if (!isTeam && (await areOpenPlayTesters(fastify, [other.discord_id])) && (await sendMatchCard(fastify, matchId, otherUserId))) return;
    await sendDm(
      other.discord_id,
      `**[RizzOtto's Arena] Match cancelled**\n\n**${canceller?.username ?? 'Your opponent'}** cancelled your Open Play match. ` +
        `If you played the battle, report the result with the replay until <t:${Math.floor(deadline.getTime() / 1000)}:t>. It then counts as normal: ${matchUrl(matchId)}`,
    );
  } catch (err) {
    fastify.log.warn({ err, matchId }, '[open-play-cancel] notifying the opponent failed (non-fatal)');
  }
}

/** A player cancelled, and the result that came in afterwards says he lost: ask every admin. Never throws. */
export async function alertCancelAfterLoss(fastify: FastifyInstance, matchId: string, gameId: string): Promise<void> {
  try {
    if (!isBotConfigured()) return;
    const prisma = fastify.prisma;
    const [match, game] = await Promise.all([
      prisma.match.findUnique({
        where: { id: matchId },
        select: { player1_id: true, player2_id: true, competitor_format: true, cancelled_by_id: true },
      }),
      prisma.matchGame.findUnique({ where: { id: gameId }, select: { winner_id: true, reporter_id: true, replay_url: true } }),
    ]);
    if (!match?.cancelled_by_id || !game?.winner_id) return;

    const [canceller, competitors, admins] = await Promise.all([
      prisma.user.findUnique({ where: { id: match.cancelled_by_id }, select: { username: true } }),
      resolveCompetitors(prisma, [game.winner_id]),
      prisma.user.findMany({ where: { role: 'ADMIN', deleted_at: null }, select: { discord_id: true } }),
    ]);
    const name = canceller?.username ?? 'A player';
    const winner = competitors.get(game.winner_id)?.username ?? 'his opponent';
    const reportedByPlayer = !!game.reporter_id && (await isCompetitorMember(prisma, game.reporter_id, match, match.competitor_format === 'TWO_V_TWO'));
    const how = reportedByPlayer ? `**${winner}** then reported the win with the replay` : `An admin then added the win for **${winner}**`;

    const body =
      `**[RizzOtto's Arena] 🚩 Cancelled after losing?**\n\n` +
      `**${name}** cancelled his Open Play match against **${winner}**. ${how}, and the result counts now.\n\n` +
      `Please look into it, then decide. A ban stays until an admin lifts it under Admin → User Management, and the bot tells the player why and how to reach you.`;
    const links = [
      { type: 2, style: 5, label: 'Open match', url: matchUrl(matchId) },
      ...(game.replay_url ? [{ type: 2, style: 5, label: 'Download replay', url: `${siteUrl()}${game.replay_url}` }] : []),
    ];
    const decide = {
      type: 1,
      components: [
        { type: 2, style: 4, label: `Ban ${name}`.slice(0, 80), custom_id: `ca_ban:${matchId}` },
        { type: 2, style: 2, label: 'No ban', custom_id: `ca_no:${matchId}` },
        ...links,
      ],
    };

    // One case per match, however many games of a series come in.
    const key = ALERT_KEY(matchId);
    if (fastify.redis) {
      if (!(await fastify.redis.hsetnx(key, 'body', body))) return;
      await fastify.redis.hset(key, 'links', JSON.stringify(links));
      await fastify.redis.expire(key, ALERT_TTL);
    }

    for (const a of admins) {
      if (!a.discord_id) continue;
      const posted = await postDm(a.discord_id, { content: body, components: [decide] });
      if (posted && posted !== 'closed') await fastify.redis?.hset(key, `m:${posted.channelId}`, posted.messageId);
    }
  } catch (err) {
    fastify.log.warn({ err, matchId }, '[open-play-cancel] alerting the admins failed (non-fatal)');
  }
}

/** The DM a banned player gets. Goes around the DM opt-out and the caps: he has to hear about this. */
async function sendBanNotice(fastify: FastifyInstance, match: { id: string; winner: string }, playerId: string, discordId: string): Promise<boolean> {
  const admins = await fastify.prisma.user.findMany({
    where: { role: 'ADMIN', deleted_at: null, id: { not: playerId } },
    select: { username: true, discord_id: true },
  });
  const reachable = admins.filter((a): a is { username: string; discord_id: string } => !!a.discord_id);
  // The name stands next to the mention, which shows as @unknown-user where Discord can't resolve it.
  const team = reachable.map((a) => `<@${a.discord_id}> (${a.username})`).join(', ');
  const notice: DiscordMessage = {
    content:
      `**[RizzOtto's Arena] You have been banned**\n\n` +
      `You cancelled your Open Play match against **${match.winner}** after losing the battle. Cancelling a lost game so that it doesn't count is unacceptably unsportsmanlike, so you are banned from RizzOtto's Arena until further notice.\n\n` +
      `If we got this wrong, or there is something we should know, please contact the admin team and explain the situation: ${team}\n\n` +
      `The match: ${matchUrl(match.id)}`,
    components: [],
    allowed_mentions: { parse: [], users: reachable.map((a) => a.discord_id) },
  };
  const posted = await postDm(discordId, notice);
  return !!posted && posted !== 'closed';
}

/** An admin's decision on the alert. Closes it on every admin's DM and returns what happened. */
export async function decideCancelAlert(
  fastify: FastifyInstance,
  matchId: string,
  admin: { id: string; username: string },
  decision: 'ban' | 'none',
): Promise<string> {
  const prisma = fastify.prisma;
  const key = ALERT_KEY(matchId);
  const stored = (await fastify.redis?.hgetall(key)) ?? {};
  if (stored.outcome) return stored.outcome;

  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { cancelled_by_id: true, winner_id: true, games: { where: { status: 'COMPLETED' }, select: { winner_id: true }, orderBy: { game_number: 'desc' }, take: 1 } } });
  const player = match?.cancelled_by_id
    ? await prisma.user.findUnique({ where: { id: match.cancelled_by_id }, select: { id: true, username: true, discord_id: true } })
    : null;
  if (!match || !player) return 'That player can no longer be found.';

  let outcome = `**${admin.username}** decided against a ban.`;
  if (decision === 'ban') {
    const banned = await banUser(fastify, player.id, admin.id, { reason: 'cancelled_after_losing', matchId });
    if (!banned) {
      outcome = `**${player.username}** is already banned.`;
    } else {
      const winnerSlot = match.winner_id ?? match.games[0]?.winner_id ?? null;
      const winner = winnerSlot ? (await resolveCompetitors(prisma, [winnerSlot])).get(winnerSlot)?.username : null;
      const told = player.discord_id ? await sendBanNotice(fastify, { id: matchId, winner: winner ?? 'your opponent' }, player.id, player.discord_id) : false;
      outcome = `🔨 **${admin.username}** banned **${player.username}**. ${told ? 'The bot told him why and how to reach you.' : "The bot's DM didn't reach him (closed DMs or no shared server), so tell him yourself."}`;
    }
  }

  if (stored.body) {
    await fastify.redis?.hset(key, 'outcome', outcome);
    const closed = { content: `${stored.body}\n\n${outcome}`, components: [{ type: 1, components: JSON.parse(stored.links ?? '[]') as object[] }] };
    const dms = Object.entries(stored).filter(([field]) => field.startsWith('m:'));
    await Promise.allSettled(dms.map(([field, messageId]) => discordRequest('PATCH', `/channels/${field.slice(2)}/messages/${messageId}`, closed)));
  }
  return outcome;
}
