// The weekly Discord prompt (Alex, 2026-10-28). Match notifications reach players only as DMs from our
// bot, and Discord lets a bot DM only players who share a server with it, so every player should be on the
// RizzOttoverse. Once a week (Monday 00:00 site time, plugins/cron.ts) the bot checks every fully registered
// player (Discord login + Steam linked); whoever is not on the server gets `discord_invite_due_at`, and his
// next visit shows a full-screen prompt to join (site notice `discord-invite`). He can click it away, which
// clears it until the next week's check. There is deliberately no permanent opt-out: the bot is part of the
// site. Players on a partner server that has our bot for Discord Open Play (e.g. the Under Empire) get no
// prompt: the bot reaches them there, and a weekly "join our server" would poach a partner's members
// (Alex, 2026-11-01).
import type { PrismaClient } from '@rizzotto/db';
import { fetchGuildMembership, recordGuildMembership } from './discord-membership.js';
import { resolveGuildId } from './discord-notify.js';
import { getOpenPlayGuilds } from './discord-open-play.js';

export interface DiscordInviteRun {
  checked: number;
  /** Not on the server: the prompt is due. */
  flagged: number;
  /** On the server: any pending prompt was dropped. */
  members: number;
  /** Not on the server but on a partner server with the bot: no prompt (a pending one was dropped). */
  partnerMembers: number;
  /** The bot could not tell (no token, Discord error): left as they were. */
  unknown: number;
}

/**
 * Check every fully registered player's membership and mark the ones who are not on the server.
 * `check` is the membership lookup, for the RizzOttoverse or the given server (Discord through the paced
 * request queue; tests pass their own).
 */
export async function flagDiscordInvites(
  prisma: PrismaClient,
  check: (discordId: string, guildId?: string) => Promise<boolean | null> = fetchGuildMembership,
  now: Date = new Date(),
): Promise<DiscordInviteRun> {
  const players = await prisma.user.findMany({
    where: { deleted_at: null, steam_link: { isNot: null } },
    select: { id: true, discord_id: true },
  });
  const run: DiscordInviteRun = { checked: players.length, flagged: 0, members: 0, partnerMembers: 0, unknown: 0 };
  const home = await resolveGuildId();
  const partners = (await getOpenPlayGuilds({ prisma })).map((g) => g.guildId).filter((id) => id !== home);
  const onPartnerServer = async (discordId: string) => {
    for (const guildId of partners) if ((await check(discordId, guildId)) === true) return true;
    return false;
  };
  for (const p of players) {
    const member = await check(p.discord_id);
    await recordGuildMembership(prisma, p.id, member); // a member's pending prompt is dropped here
    if (member === true) run.members++;
    else if (member === false && (await onPartnerServer(p.discord_id))) {
      await prisma.user.update({ where: { id: p.id }, data: { discord_invite_due_at: null } });
      run.partnerMembers++;
    } else if (member === false) {
      await prisma.user.update({ where: { id: p.id }, data: { discord_invite_due_at: now } });
      run.flagged++;
    } else run.unknown++;
  }
  return run;
}
