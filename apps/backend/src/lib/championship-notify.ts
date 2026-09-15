/**
 * Discord DMs for the recurring competitive finals (design-competitive-finals-locked).
 * Fire-and-forget (never throw), no-op without a bot token. DMs go through the base sendDm()
 * → per-recipient rate caps + NO_BOT_MESSAGES opt-out apply. For 2v2 the seeded user is the
 * team captain, so the captain gets the actionable DM.
 */

import type { PrismaClient } from '@rizzotto/db';
import { sendDm, isBotConfigured } from './discord-notify.js';

const baseUrl = (): string => process.env.FRONTEND_URL ?? 'https://rizzotto.gg';

/** The final was just seeded: congratulate each seeded competitor with their seed number. */
export async function notifyChampionshipSeeded(
  prisma: PrismaClient,
  tournamentId: string,
  orderedUserIds: string[],
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { name: true, slug: true, start_date: true },
    });
    if (!t) return;
    const url = `${baseUrl()}/tournaments/${t.slug}`;
    const startTs = Math.floor(t.start_date.getTime() / 1000);
    const users = await prisma.user.findMany({
      where: { id: { in: orderedUserIds } },
      select: { id: true, discord_id: true },
    });
    const discById = new Map(users.map((u) => [u.id, u.discord_id]));
    const dms = orderedUserIds.map((uid, i) => {
      const disc = discById.get(uid);
      if (!disc) return Promise.resolve();
      const msg =
        `**[RizzOtto's Arena] You're in — ${t.name}** 🏆\n` +
        `You qualified for **${t.name}**, seeded **#${i + 1}**. ` +
        `It starts <t:${startTs}:F> (<t:${startTs}:R>): <${url}>`;
      return sendDm(disc, msg);
    });
    await Promise.allSettled(dms);
  } catch (err) {
    console.warn('[championship-notify] notifyChampionshipSeeded error (non-fatal):', err);
  }
}

/** The Monthly Ladder Invitational raffle was drawn: DM the winner (skill decides the tournament
 *  prize, luck decides the raffle prize — every invitee had an equal shot). */
export async function notifyRaffleWinner(
  prisma: PrismaClient,
  tournamentId: string,
  winnerUserId: string,
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const [t, user] = await Promise.all([
      prisma.tournament.findUnique({ where: { id: tournamentId }, select: { name: true, slug: true } }),
      prisma.user.findUnique({ where: { id: winnerUserId }, select: { discord_id: true } }),
    ]);
    if (!t || !user?.discord_id) return;
    const url = `${baseUrl()}/tournaments/${t.slug}`;
    const msg =
      `**[RizzOtto's Arena] You won the raffle — ${t.name}** 🎉\n` +
      `Your name was drawn among the invitees of **${t.name}**. ` +
      `The host will be in touch about your prize: <${url}>`;
    await sendDm(user.discord_id, msg);
  } catch (err) {
    console.warn('[championship-notify] notifyRaffleWinner error (non-fatal):', err);
  }
}
