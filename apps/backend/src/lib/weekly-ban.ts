import type { PrismaClient, Prisma } from '@rizzotto/db';

/**
 * Weekly Open Play ban (VL picking, plans/discord-open-play.md §11): every player may set one faction on his
 * profile. In each of his Open Play matches it is banned for both sides. He can change it (clearing included)
 * WEEKLY_BAN_LOCK_DAYS after the last change at the earliest, so nobody re-targets it per opponent. A match keeps
 * the bans as they stood at its creation (Match.weekly_bans), so a series never changes them in between.
 */
export const WEEKLY_BAN_LOCK_DAYS = 7;
const LOCK_MS = WEEKLY_BAN_LOCK_DAYS * 24 * 60 * 60 * 1000;

export type WeeklyBan = { userId: string; factionId: string };

/** When the ban can be changed again; null when it can be changed now. */
export function weeklyBanOpensAt(setAt: Date | null, now = new Date()): Date | null {
  if (!setAt) return null;
  const opens = new Date(setAt.getTime() + LOCK_MS);
  return opens > now ? opens : null;
}

export type SetWeeklyBanResult =
  | { ok: true; factionId: string | null; setAt: Date | null }
  | { ok: false; reason: 'locked'; opensAt: Date }
  | { ok: false; reason: 'unknown_faction' };

/**
 * Set (or clear, with null) a player's weekly ban. The same faction again is a no-op that keeps the lock running
 * from the original change. The single entry point for the site route and the join DM.
 */
export async function setWeeklyBan(prisma: PrismaClient, userId: string, factionId: string | null): Promise<SetWeeklyBanResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { weekly_ban_faction_id: true, weekly_ban_set_at: true },
  });
  if (user.weekly_ban_faction_id === factionId) {
    return { ok: true, factionId, setAt: user.weekly_ban_set_at };
  }
  const opensAt = weeklyBanOpensAt(user.weekly_ban_set_at);
  if (opensAt) return { ok: false, reason: 'locked', opensAt };
  if (factionId && !(await prisma.faction.findUnique({ where: { id: factionId }, select: { id: true } }))) {
    return { ok: false, reason: 'unknown_faction' };
  }
  const setAt = new Date();
  await prisma.user.update({ where: { id: userId }, data: { weekly_ban_faction_id: factionId, weekly_ban_set_at: setAt } });
  return { ok: true, factionId, setAt };
}

/** The weekly bans of these players right now, for the snapshot a new Open Play match takes. */
export async function snapshotWeeklyBans(prisma: PrismaClient, userIds: string[]): Promise<WeeklyBan[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, weekly_ban_faction_id: { not: null } },
    select: { id: true, weekly_ban_faction_id: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.weekly_ban_faction_id as string]));
  // In the order given, so player 1's ban reads first.
  return userIds.flatMap((id) => (byId.has(id) ? [{ userId: id, factionId: byId.get(id)! }] : []));
}

/** A match's weekly-ban snapshot, read defensively from its Json column. */
export function matchWeeklyBans(value: Prisma.JsonValue | null | undefined): WeeklyBan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const o = v as { userId?: unknown; factionId?: unknown } | null;
    return o && typeof o.userId === 'string' && typeof o.factionId === 'string' ? [{ userId: o.userId, factionId: o.factionId }] : [];
  });
}

/** A match's weekly bans with their players' names, for the pick screens ("Empire, RizzOtto's weekly ban"). */
export async function weeklyBansWithNames(
  prisma: PrismaClient,
  value: Prisma.JsonValue | null | undefined,
): Promise<(WeeklyBan & { username: string })[]> {
  const bans = matchWeeklyBans(value);
  if (bans.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: bans.map((b) => b.userId) } }, select: { id: true, username: true } });
  return bans.map((b) => ({ ...b, username: users.find((u) => u.id === b.userId)?.username ?? 'a player' }));
}
