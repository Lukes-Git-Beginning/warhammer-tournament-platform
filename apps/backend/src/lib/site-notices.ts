// Site notices: shown to a user until they dismiss them.
import type { PrismaClient } from '@rizzotto/db';
import { currentGuildMembership } from './discord-membership.js';

/**
 * Every notice id the site knows. Dismissing an unknown id is rejected, so the list in the DB stays clean.
 * - arena-mod-release: RizzOtto's Arena Mod is out (install it, join the Discord). Only for players who are
 *   not on the RizzOttoverse server; the server hears about the release there. Dismissed for good
 *   (User.dismissed_notices).
 * - discord-invite: the weekly Discord prompt (lib/discord-invite.ts), while `discord_invite_due_at` is set
 *   and the player is still not on the server. Dismissing clears it until the next weekly check.
 */
export const SITE_NOTICES = ['arena-mod-release', 'discord-invite'] as const;
export type SiteNotice = (typeof SITE_NOTICES)[number];

/** The notices to show this user right now. */
export async function activeNoticesFor(prisma: PrismaClient, userId: string): Promise<SiteNotice[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      discord_id: true,
      discord_member: true,
      discord_member_checked_at: true,
      dismissed_notices: true,
      discord_invite_due_at: true,
    },
  });
  if (!user) return [];
  const wantsRelease = !user.dismissed_notices.includes('arena-mod-release');
  const wantsInvite = user.discord_invite_due_at !== null;
  if (!wantsRelease && !wantsInvite) return [];

  // Checked (or the stored answer reused) once for both. A member found here also drops a pending invite
  // (recordGuildMembership), so someone who joined since Monday isn't asked again.
  const member = await currentGuildMembership(prisma, user);
  const notices: SiteNotice[] = [];
  // Unknown membership (bot can't tell) shows the release notice: it is harmless and can be dismissed.
  if (wantsRelease && member !== true) notices.push('arena-mod-release');
  if (wantsInvite && member !== true) notices.push('discord-invite');
  return notices;
}

/** Remember that the user dismissed a notice (idempotent). */
export async function dismissNotice(prisma: PrismaClient, userId: string, notice: SiteNotice): Promise<void> {
  if (notice === 'discord-invite') {
    await prisma.user.update({ where: { id: userId }, data: { discord_invite_due_at: null } });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dismissed_notices: true } });
  if (!user || user.dismissed_notices.includes(notice)) return;
  await prisma.user.update({ where: { id: userId }, data: { dismissed_notices: { push: notice } } });
}
