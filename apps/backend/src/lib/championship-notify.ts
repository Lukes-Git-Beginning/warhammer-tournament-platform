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

/**
 * The availability round just opened: DM every invitee with their rank, differentiated by whether
 * they'd currently make the cut. Everyone is asked to confirm availability (check in) or decline by
 * the deadline; no response counts as unavailable at seed. Ordered by rank.
 */
export async function notifyAvailabilityInvites(
  prisma: PrismaClient,
  tournamentId: string,
  invites: Array<{ userId: string; rank: number }>,
  fieldSize: number,
  deadline: Date,
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { name: true, slug: true },
    });
    if (!t) return;
    const url = `${baseUrl()}/tournaments/${t.slug}`;
    const deadlineTs = Math.floor(deadline.getTime() / 1000);
    const users = await prisma.user.findMany({
      where: { id: { in: invites.map((i) => i.userId) } },
      select: { id: true, discord_id: true },
    });
    const discById = new Map(users.map((u) => [u.id, u.discord_id]));
    const dms = invites.map((inv) => {
      const disc = discById.get(inv.userId);
      if (!disc) return Promise.resolve();
      const inCut = inv.rank <= fieldSize;
      const msg = inCut
        ? `**[RizzOtto's Arena] You're in the running — ${t.name}** 🏆\n` +
          `The cycle's closed and you'd currently make the cut for **${t.name}** — it's a Top ${fieldSize} and you're ranked **#${inv.rank}**. ` +
          `Confirm you can play by checking in before <t:${deadlineTs}:F> (<t:${deadlineTs}:R>), or decline to free your spot: <${url}>`
        : `**[RizzOtto's Arena] You're in the seed pool — ${t.name}**\n` +
          `The cycle's closed. It's a Top ${fieldSize} and you're ranked **#${inv.rank}**, so you're in the seed pool — if players above you can't make it, you're next in line. ` +
          `Let us know you're available by checking in before <t:${deadlineTs}:F> (<t:${deadlineTs}:R>): <${url}>`;
      return sendDm(disc, msg);
    });
    await Promise.allSettled(dms);
  } catch (err) {
    console.warn('[championship-notify] notifyAvailabilityInvites error (non-fatal):', err);
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

/** A host/staff member set an invitee's availability on their behalf: tell them, with a way to
 *  correct it (their own answer overrides). Not sent for an undo back to pending. */
export async function notifyRsvpSetByManager(
  prisma: PrismaClient,
  tournamentId: string,
  userId: string,
  rsvp: 'AVAILABLE' | 'DECLINED',
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const [t, user] = await Promise.all([
      prisma.tournament.findUnique({ where: { id: tournamentId }, select: { name: true, slug: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { discord_id: true } }),
    ]);
    if (!t || !user?.discord_id) return;
    const url = `${baseUrl()}/tournaments/${t.slug}`;
    const msg = rsvp === 'DECLINED'
      ? `**[RizzOtto's Arena] Marked as not playing — ${t.name}**\n` +
        `The host marked you as unavailable for **${t.name}**, so your spot goes to the next player in line. ` +
        `If that's wrong, confirm you can play before the field is locked: <${url}>`
      : `**[RizzOtto's Arena] Marked as available — ${t.name}**\n` +
        `The host confirmed you as available for **${t.name}**. ` +
        `If you can't play after all, decline before the field is locked so the next player can take your spot: <${url}>`;
    await sendDm(user.discord_id, msg);
  } catch (err) {
    console.warn('[championship-notify] notifyRsvpSetByManager error (non-fatal):', err);
  }
}
