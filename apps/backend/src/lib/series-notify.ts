/**
 * Discord DM notifications for Tournament Series events. Kept separate from discord-notify.ts
 * so the widely-imported base module stays free of the series-qualification import chain.
 * All functions are fire-and-forget safe (never throw) and no-op without a bot token.
 * DMs go through the base sendDm() → per-recipient rate caps + NO_BOT_MESSAGES opt-out apply.
 */

import type { PrismaClient } from '@rizzotto/db';
import { sendDm, isBotConfigured } from './discord-notify.js';
import { getAlreadyQualifiedForQualifier } from './series-qualification.js';

const baseUrl = (): string => process.env.FRONTEND_URL ?? 'https://rizzotto.gg';

/**
 * The final was just seeded: congratulate each qualified player (with their seed) and
 * confirm to the series owner + co-hosts. `orderedQualifiedUserIds` is in seed order
 * (index 0 = seed #1), matching what seed-final wrote to TournamentParticipant.seed.
 */
export async function notifySeriesFinalSeeded(
  prisma: PrismaClient,
  seriesId: string,
  orderedQualifiedUserIds: string[],
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const series = await prisma.tournamentSeries.findUnique({
      where: { id: seriesId },
      select: {
        name: true,
        owner_id: true,
        co_hosts: { select: { user_id: true } },
        final_tournament: { select: { slug: true, start_date: true } },
      },
    });
    if (!series || !series.final_tournament) return;

    const finalUrl = `${baseUrl()}/tournaments/${series.final_tournament.slug}`;
    const startTs = Math.floor(series.final_tournament.start_date.getTime() / 1000);

    // Qualified players — each gets their seed number.
    const players = await prisma.user.findMany({
      where: { id: { in: orderedQualifiedUserIds } },
      select: { id: true, discord_id: true },
    });
    const discById = new Map(players.map((u) => [u.id, u.discord_id]));
    const playerDms = orderedQualifiedUserIds.map((uid, i) => {
      const disc = discById.get(uid);
      if (!disc) return Promise.resolve();
      const msg =
        `**[RizzOtto's Arena] You're in the Grand Final — ${series.name}** 🏆\n` +
        `You've qualified for the Grand Final of **${series.name}** — seeded **#${i + 1}**. ` +
        `It starts <t:${startTs}:F> (<t:${startTs}:R>). Sharpen your blades: <${finalUrl}>`;
      return sendDm(disc, msg);
    });

    // Managers (owner + co-hosts) — a confirmation.
    const managerIds = [...new Set([series.owner_id, ...series.co_hosts.map((h) => h.user_id)])];
    const managers = await prisma.user.findMany({
      where: { id: { in: managerIds } },
      select: { discord_id: true },
    });
    const confirm =
      `**[RizzOtto's Arena] Final seeded — ${series.name}**\n` +
      `The Grand Final has been seeded with **${orderedQualifiedUserIds.length}** qualified player(s). ` +
      `Review and start it when ready: <${finalUrl}>`;
    const managerDms = managers.map((m) => sendDm(m.discord_id, confirm));

    await Promise.allSettled([...playerDms, ...managerDms]);
  } catch (err) {
    console.warn('[series-notify] notifySeriesFinalSeeded error (non-fatal):', err);
  }
}

/**
 * A new qualifier was attached to a series that already has prior qualifiers: invite the
 * players from those prior qualifiers who have NOT yet secured a final slot (Model C) — for
 * Model A / NONE nobody is locked in yet, so everyone who played is invited. Excludes anyone
 * already registered in the new qualifier. Skips entirely if there are no prior qualifiers.
 */
export async function notifySeriesNewQualifier(
  prisma: PrismaClient,
  seriesId: string,
  newQualifierId: string,
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const [series, newQ] = await Promise.all([
      prisma.tournamentSeries.findUnique({ where: { id: seriesId }, select: { name: true } }),
      prisma.tournament.findUnique({
        where: { id: newQualifierId },
        select: { name: true, slug: true, start_date: true },
      }),
    ]);
    if (!series || !newQ) return;

    // Prior qualifiers of this series (everything attached except the new one).
    const priorQualifiers = await prisma.tournament.findMany({
      where: { series_id: seriesId, id: { not: newQualifierId }, is_series_final: false, deleted_at: null },
      select: { id: true },
    });
    if (priorQualifiers.length === 0) return;

    // Distinct players who took part in the prior qualifiers.
    const priorParts = await prisma.tournamentParticipant.findMany({
      where: { tournament_id: { in: priorQualifiers.map((q) => q.id) }, deleted_at: null },
      select: { user_id: true },
    });
    const candidateIds = [...new Set(priorParts.map((p) => p.user_id))];
    if (candidateIds.length === 0) return;

    // Exclude already-qualified (Model C only) + anyone already in the new qualifier.
    const [alreadyQualified, alreadyInNew] = await Promise.all([
      getAlreadyQualifiedForQualifier(prisma, newQualifierId),
      prisma.tournamentParticipant.findMany({
        where: { tournament_id: newQualifierId, deleted_at: null },
        select: { user_id: true },
      }),
    ]);
    const excluded = new Set<string>([...alreadyQualified, ...alreadyInNew.map((p) => p.user_id)]);
    const inviteeIds = candidateIds.filter((id) => !excluded.has(id));
    if (inviteeIds.length === 0) return;

    const users = await prisma.user.findMany({
      where: { id: { in: inviteeIds } },
      select: { discord_id: true },
    });
    const qUrl = `${baseUrl()}/tournaments/${newQ.slug}`;
    const startTs = Math.floor(newQ.start_date.getTime() / 1000);
    const msg =
      `**[RizzOtto's Arena] New qualifier — ${series.name}**\n` +
      `A new qualifier, **${newQ.name}**, was just added to the **${series.name}** series — ` +
      `another shot at a Grand Final spot. It starts <t:${startTs}:F>. Sign up: <${qUrl}>`;
    await Promise.allSettled(users.map((u) => sendDm(u.discord_id, msg)));
  } catch (err) {
    console.warn('[series-notify] notifySeriesNewQualifier error (non-fatal):', err);
  }
}
