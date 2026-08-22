// Supporter recognition — DB + Discord + config glue around the pure lib/supporter-status.ts.
// Source of truth: Discord roles (synced on login + cron) OR an admin override. See
// plans/kofi-and-supporters.md.

import type { PrismaClient } from '@rizzotto/db';
import { resolveGuildId } from './discord-notify.js';
import {
  type SupporterRoleConfig,
  type SupporterTiers,
  tiersFromDiscordRoles,
  resolveSupporterTiers,
} from './supporter-status.js';

/** AdminConfig key holding the three Discord role IDs that map to supporter tiers. */
export const SUPPORTER_ROLE_CONFIG_KEY = 'supporter_role_ids';

/** The six supporter flags as stored on a User row. */
export interface SupporterFlagsRow {
  supporter_discord: boolean;
  lord_discord: boolean;
  champion_discord: boolean;
  supporter_manual: boolean;
  lord_manual: boolean;
  champion_manual: boolean;
}

/** Effective (union) tiers from a user row's six flags — cumulative via the pure resolver. */
export function effectiveTiersOf(u: SupporterFlagsRow): SupporterTiers {
  return resolveSupporterTiers(
    { supporter: u.supporter_discord, lord: u.lord_discord, champion: u.champion_discord },
    { supporter: u.supporter_manual, lord: u.lord_manual, champion: u.champion_manual },
  );
}

/** Read the tier→Discord-role-ID mapping: AdminConfig first, then env vars, else null. */
export async function getSupporterRoleConfig(prisma: PrismaClient): Promise<SupporterRoleConfig> {
  const row = await prisma.adminConfig.findUnique({ where: { key: SUPPORTER_ROLE_CONFIG_KEY } });
  const v = (row?.value ?? null) as Partial<SupporterRoleConfig> | null;
  return {
    supporterRoleId: v?.supporterRoleId ?? process.env.SUPPORTER_ROLE_ID ?? null,
    lordRoleId: v?.lordRoleId ?? process.env.LORD_ROLE_ID ?? null,
    championRoleId: v?.championRoleId ?? process.env.CHAMPION_ROLE_ID ?? null,
  };
}

/** Fetch a member's role IDs from the guild via the bot token. null if unreachable/not a member. */
export async function fetchGuildMemberRoles(discordId: string): Promise<string[] | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const guildId = await resolveGuildId();
  if (!guildId) return null;
  try {
    const res = await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null; // 404 → not a guild member
    const data = (await res.json()) as { roles?: string[] };
    return Array.isArray(data.roles) ? data.roles : [];
  } catch {
    return null;
  }
}

/** Write a user's Discord-derived tiers from their current guild role IDs. Returns what was written. */
export async function syncSupporterFromDiscordRoles(
  prisma: PrismaClient,
  userId: string,
  roleIds: readonly string[],
  config?: SupporterRoleConfig,
): Promise<SupporterTiers> {
  const cfg = config ?? (await getSupporterRoleConfig(prisma));
  const tiers = tiersFromDiscordRoles(roleIds, cfg);
  await prisma.user.update({
    where: { id: userId },
    data: {
      supporter_discord: tiers.supporter,
      lord_discord: tiers.lord,
      champion_discord: tiers.champion,
      supporter_synced_at: new Date(),
    },
  });
  return tiers;
}

/** Fetch-and-sync one user's Discord tiers by Discord id (login/cron helper). No-op if unreachable. */
export async function refreshSupporterFromDiscord(
  prisma: PrismaClient,
  userId: string,
  discordId: string,
  config?: SupporterRoleConfig,
): Promise<void> {
  const roleIds = await fetchGuildMemberRoles(discordId);
  if (roleIds == null) return; // can't reach Discord / not a member → leave existing state untouched
  await syncSupporterFromDiscordRoles(prisma, userId, roleIds, config);
}

/** Admin manual override — set the three *_manual flags to the given (raw) selections. */
export async function setSupporterOverride(
  prisma: PrismaClient,
  userId: string,
  tiers: SupporterTiers,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      supporter_manual: tiers.supporter,
      lord_manual: tiers.lord,
      champion_manual: tiers.champion,
    },
  });
}

/** One supporter for the public /support list. */
export interface SupporterEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  tiers: SupporterTiers;
}

/** Every user with any effective supporter tier, for the /support page. */
export async function listSupporters(prisma: PrismaClient): Promise<SupporterEntry[]> {
  const rows = await prisma.user.findMany({
    where: {
      deleted_at: null,
      OR: [
        { supporter_discord: true },
        { lord_discord: true },
        { champion_discord: true },
        { supporter_manual: true },
        { lord_manual: true },
        { champion_manual: true },
      ],
    },
    select: {
      id: true,
      username: true,
      avatar_url: true,
      supporter_discord: true,
      lord_discord: true,
      champion_discord: true,
      supporter_manual: true,
      lord_manual: true,
      champion_manual: true,
    },
  });
  return rows.map((u) => ({
    userId: u.id,
    username: u.username,
    avatarUrl: u.avatar_url,
    tiers: effectiveTiersOf(u),
  }));
}
