import type { $Enums, PrismaClient, Prisma } from '@rizzotto/db';
import { standardBannedEverywhereFactionIds, standardBannedFactionIds } from './standard-ruleset.js';

/**
 * Weekly Open Play ban (VL picking, plans/discord-open-play.md §11): every player may set one faction on his
 * profile. In each of his Open Play matches it is banned for both sides. He can set a new one WEEKLY_BAN_LOCK_DAYS
 * after the last one was set at the earliest, so nobody re-targets it per opponent. Dropping it (no ban) works any
 * time and leaves that lock running (Alex 2026-11-08): it only ever lifts a ban, so it can't target anyone. A match
 * keeps the bans as they stood at its creation (Match.weekly_bans), so a series never changes them in between.
 *
 * A faction the Standard Ruleset bans in every Open Play game can't be the weekly ban: it would ban nothing. A ban set
 * on one before (or before the ruleset banned it everywhere) is "covered" and holds no lock (Alex 2026-11-08).
 */
export const WEEKLY_BAN_LOCK_DAYS = 7;
const LOCK_MS = WEEKLY_BAN_LOCK_DAYS * 24 * 60 * 60 * 1000;

export type WeeklyBan = { userId: string; factionId: string };

/** AuditLog actions for the weekly ban (entity User), read by the admin Players report: who uses it. */
export const WEEKLY_BAN_AUDIT = { set: 'WEEKLY_BAN_SET', drop: 'WEEKLY_BAN_DROP', reset: 'WEEKLY_BAN_RESET' } as const;

function banAudit(prisma: PrismaClient, userId: string, action: string, actorId: string, from: string | null, to: string | null) {
  return prisma.auditLog.create({
    data: { entity_type: 'User', entity_id: userId, action, actor_id: actorId, old_value: { factionId: from }, new_value: { factionId: to } },
  });
}

/** When a new ban can be set again; null when it can be set now. */
export function weeklyBanOpensAt(setAt: Date | null, now = new Date()): Date | null {
  if (!setAt) return null;
  const opens = new Date(setAt.getTime() + LOCK_MS);
  return opens > now ? opens : null;
}

/**
 * A player's weekly ban as the profile and the join DM show it. `covered`: the Standard Ruleset bans it in every Open
 * Play game already, so it holds no lock. `rulesetBanned`: those factions, which can't be chosen.
 */
export type WeeklyBanState = {
  factionId: string | null;
  setAt: Date | null;
  opensAt: Date | null;
  covered: boolean;
  rulesetBanned: string[];
};

export function weeklyBanState(
  user: { weekly_ban_faction_id: string | null; weekly_ban_set_at: Date | null },
  rulesetBanned: string[],
  now = new Date(),
): WeeklyBanState {
  const factionId = user.weekly_ban_faction_id;
  const covered = !!factionId && rulesetBanned.includes(factionId);
  const setAt = user.weekly_ban_set_at;
  return { factionId, setAt, opensAt: covered ? null : weeklyBanOpensAt(setAt, now), covered, rulesetBanned };
}

/** A live player's weekly ban state; null when there's no such player. */
export async function readWeeklyBan(prisma: PrismaClient, userId: string): Promise<WeeklyBanState | null> {
  const [user, rulesetBanned] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, deleted_at: null }, select: { weekly_ban_faction_id: true, weekly_ban_set_at: true } }),
    standardBannedEverywhereFactionIds(),
  ]);
  return user ? weeklyBanState(user, rulesetBanned) : null;
}

export type SetWeeklyBanResult =
  | { ok: true; state: WeeklyBanState }
  | { ok: false; reason: 'locked'; opensAt: Date }
  | { ok: false; reason: 'ruleset_banned' }
  | { ok: false; reason: 'unknown_faction' };

/**
 * Set a player's weekly ban, or drop it with null. Setting waits for the lock; dropping never does and keeps the
 * lock running from the last set (so a drop can't be followed by a new ban before the week is up). The same faction
 * again is a no-op that keeps the lock too. The single entry point for the site route and the join DM.
 */
export async function setWeeklyBan(prisma: PrismaClient, userId: string, factionId: string | null): Promise<SetWeeklyBanResult> {
  const [user, rulesetBanned] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { weekly_ban_faction_id: true, weekly_ban_set_at: true } }),
    standardBannedEverywhereFactionIds(),
  ]);
  const before = weeklyBanState(user, rulesetBanned);
  if (user.weekly_ban_faction_id === factionId) return { ok: true, state: before };
  if (factionId === null) {
    // A covered ban never banned anything, so dropping it doesn't bring its lock back.
    const setAt = before.covered ? null : user.weekly_ban_set_at;
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { weekly_ban_faction_id: null, weekly_ban_set_at: setAt } }),
      banAudit(prisma, userId, WEEKLY_BAN_AUDIT.drop, userId, user.weekly_ban_faction_id, null),
    ]);
    return { ok: true, state: weeklyBanState({ weekly_ban_faction_id: null, weekly_ban_set_at: setAt }, rulesetBanned) };
  }
  if (rulesetBanned.includes(factionId)) return { ok: false, reason: 'ruleset_banned' };
  if (before.opensAt) return { ok: false, reason: 'locked', opensAt: before.opensAt };
  if (!(await prisma.faction.findUnique({ where: { id: factionId }, select: { id: true } }))) {
    return { ok: false, reason: 'unknown_faction' };
  }
  const setAt = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { weekly_ban_faction_id: factionId, weekly_ban_set_at: setAt } }),
    banAudit(prisma, userId, WEEKLY_BAN_AUDIT.set, userId, user.weekly_ban_faction_id, factionId),
  ]);
  return { ok: true, state: weeklyBanState({ weekly_ban_faction_id: factionId, weekly_ban_set_at: setAt }, rulesetBanned) };
}

/** Admin: clear a player's ban together with its lock, so he can set a new one at once. False = no such user. */
export async function resetWeeklyBan(prisma: PrismaClient, userId: string, adminId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { weekly_ban_faction_id: true } });
  if (!user) return false;
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { weekly_ban_faction_id: null, weekly_ban_set_at: null } }),
    banAudit(prisma, userId, WEEKLY_BAN_AUDIT.reset, adminId, user.weekly_ban_faction_id, null),
  ]);
  return true;
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

/**
 * Open Play is bound by the Standard Ruleset (Alex, 2026-10-07): its banned factions cannot be
 * picked there. Tournaments are NOT — a host runs with or without the Standard Rules and bans
 * factions per tournament. Returns [] for a tournament match. On top come the players' weekly bans
 * as the match recorded them (`weekly_bans`), banned for both sides (2026-11-06).
 */
export async function openPlayBannedFactionIds(match: {
  tournament_id: string | null;
  competitor_format: $Enums.CompetitorFormat;
  battle_type: $Enums.BattleType | null | undefined;
  weekly_bans?: Prisma.JsonValue | null;
}): Promise<string[]> {
  if (match.tournament_id) return [];
  const standard = await standardBannedFactionIds(match.battle_type ?? 'DOMINATION', match.competitor_format);
  return [...new Set([...standard, ...matchWeeklyBans(match.weekly_bans).map((b) => b.factionId)])];
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
