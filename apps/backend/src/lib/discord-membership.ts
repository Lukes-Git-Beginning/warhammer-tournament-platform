// Membership in the RizzOttoverse Discord server, as the bot sees it. Stored per user (discord_member +
// discord_member_checked_at) from the login check and from on-demand checks, so notices meant for players
// who are not on the server don't call Discord on every page load.
import type { PrismaClient } from '@rizzotto/db';
import { resolveGuildId } from './discord-notify.js';

/** A stored answer younger than this is reused; an older one (or none) is checked again. */
export const MEMBERSHIP_RECHECK_MS = 24 * 60 * 60 * 1000;

/** Is this Discord user on the server? true / false, or null when the bot can't tell (no token, no guild, error). */
export async function fetchGuildMembership(discordId: string): Promise<boolean | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const guildId = await resolveGuildId();
  if (!guildId) return null;
  try {
    const res = await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

/** Remember a membership answer. A null (unknown) answer leaves the stored state as it is. */
export async function recordGuildMembership(prisma: PrismaClient, userId: string, member: boolean | null): Promise<void> {
  if (member == null) return;
  await prisma.user.update({
    where: { id: userId },
    data: { discord_member: member, discord_member_checked_at: new Date() },
  });
}

/** The stored answer while it is fresh, else a live check (stored when the bot could tell). */
export async function currentGuildMembership(
  prisma: PrismaClient,
  user: { id: string; discord_id: string; discord_member: boolean | null; discord_member_checked_at: Date | null },
  now: Date = new Date(),
): Promise<boolean | null> {
  const fresh =
    user.discord_member != null &&
    user.discord_member_checked_at != null &&
    now.getTime() - user.discord_member_checked_at.getTime() < MEMBERSHIP_RECHECK_MS;
  if (fresh) return user.discord_member;
  const member = await fetchGuildMembership(user.discord_id);
  await recordGuildMembership(prisma, user.id, member);
  return member ?? user.discord_member;
}
