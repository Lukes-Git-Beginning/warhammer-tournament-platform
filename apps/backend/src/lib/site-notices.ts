// One-time site notices: shown to a user until they dismiss them (User.dismissed_notices).
import type { PrismaClient } from '@rizzotto/db';
import { currentGuildMembership } from './discord-membership.js';

/**
 * Every notice id the site knows. Dismissing an unknown id is rejected, so the list in the DB stays clean.
 * - arena-mod-release: RizzOtto's Arena Mod is out (install it, join the Discord). Only for players who are
 *   not on the RizzOttoverse server; the server hears about the release there.
 */
export const SITE_NOTICES = ['arena-mod-release'] as const;
export type SiteNotice = (typeof SITE_NOTICES)[number];

/** The notices to show this user right now. */
export async function activeNoticesFor(prisma: PrismaClient, userId: string): Promise<SiteNotice[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, discord_id: true, discord_member: true, discord_member_checked_at: true, dismissed_notices: true },
  });
  if (!user) return [];
  const notices: SiteNotice[] = [];
  if (!user.dismissed_notices.includes('arena-mod-release')) {
    // Unknown membership (bot can't tell) shows the notice: it is harmless and can be dismissed.
    if ((await currentGuildMembership(prisma, user)) !== true) notices.push('arena-mod-release');
  }
  return notices;
}

/** Remember that the user dismissed a notice (idempotent). */
export async function dismissNotice(prisma: PrismaClient, userId: string, notice: SiteNotice): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dismissed_notices: true } });
  if (!user || user.dismissed_notices.includes(notice)) return;
  await prisma.user.update({ where: { id: userId }, data: { dismissed_notices: { push: notice } } });
}
