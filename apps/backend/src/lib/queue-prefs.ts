import type { PrismaClient } from '@rizzotto/db';
import {
  ALL_BATTLE_TYPES,
  ALL_QUEUE_MATCH_FORMATS,
  type QueueBattleType,
  type QueueCompetitorFormat,
  type QueueMatchFormat,
  type QueuePrefs,
} from './queue-matching.js';

/** A player's persistent Open Play queue settings (UserQueuePref row, defaults when absent). */
export interface StoredQueuePrefs {
  battleTypes: QueueBattleType[];
  matchFormats: QueueMatchFormat[];
  competitorFormat: QueueCompetitorFormat;
  /** 2v2: the preferred team (validated at join time), null = the captain's first valid team. */
  teamId: string | null;
}

export function defaultStoredQueuePrefs(): StoredQueuePrefs {
  return {
    battleTypes: [...ALL_BATTLE_TYPES],
    matchFormats: [...ALL_QUEUE_MATCH_FORMATS],
    competitorFormat: 'ONE_V_ONE',
    teamId: null,
  };
}

type PrefRow = {
  battle_types: string[];
  match_formats: string[];
  competitor_format: string;
  team_id: string | null;
};

function fromRow(row: PrefRow | null | undefined): StoredQueuePrefs {
  if (!row) return defaultStoredQueuePrefs();
  const battleTypes = row.battle_types.filter((b): b is QueueBattleType =>
    (ALL_BATTLE_TYPES as readonly string[]).includes(b),
  );
  const matchFormats = row.match_formats.filter((f): f is QueueMatchFormat =>
    (ALL_QUEUE_MATCH_FORMATS as readonly string[]).includes(f),
  );
  return {
    battleTypes: battleTypes.length > 0 ? battleTypes : [...ALL_BATTLE_TYPES],
    matchFormats: matchFormats.length > 0 ? matchFormats : [...ALL_QUEUE_MATCH_FORMATS],
    competitorFormat: row.competitor_format === 'TWO_V_TWO' ? 'TWO_V_TWO' : 'ONE_V_ONE',
    teamId: row.team_id,
  };
}

export async function getStoredQueuePrefs(prisma: PrismaClient, userId: string): Promise<StoredQueuePrefs> {
  return fromRow(await prisma.userQueuePref.findUnique({ where: { user_id: userId } }));
}

export async function getStoredQueuePrefsMany(
  prisma: PrismaClient,
  userIds: string[],
): Promise<Map<string, StoredQueuePrefs>> {
  const rows = await prisma.userQueuePref.findMany({ where: { user_id: { in: userIds } } });
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  return new Map(userIds.map((id) => [id, fromRow(byUser.get(id))]));
}

export async function saveQueuePrefs(
  prisma: PrismaClient,
  userId: string,
  prefs: StoredQueuePrefs,
): Promise<void> {
  const data = {
    battle_types: prefs.battleTypes,
    match_formats: prefs.matchFormats,
    competitor_format: prefs.competitorFormat,
    team_id: prefs.teamId,
  };
  await prisma.userQueuePref.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });
}

/**
 * The ACTIVE team the user captains that can queue for 2v2 (two accepted members). With
 * `preferredTeamId` only that team qualifies; without it, the first valid one.
 */
export async function findQueueableTeam(
  prisma: PrismaClient,
  userId: string,
  preferredTeamId?: string | null,
): Promise<string | null> {
  const teams = await prisma.team.findMany({
    where: { captain_id: userId, status: 'ACTIVE', ...(preferredTeamId ? { id: preferredTeamId } : {}) },
    select: { id: true, members: { select: { accepted_at: true } } },
    orderBy: { created_at: 'asc' },
  });
  return teams.find((t) => t.members.filter((m) => m.accepted_at !== null).length >= 2)?.id ?? null;
}

export interface ResolvedQueueActor {
  /** What goes into the queue: the user (1v1) or the captain's team (2v2). */
  queueId: string;
  format: QueueCompetitorFormat;
  /** True when the stored 2v2 preference could not be honoured and 1v1 was used for this join. */
  fellBackTo1v1: boolean;
}

/**
 * Resolve the queue actor from stored settings. A stored 2v2 preference whose team is no longer
 * valid (not ACTIVE, not captained by the user, fewer than two accepted members) falls back to
 * 1v1 for this join only — the stored preference itself is never rewritten here.
 */
export async function resolveStoredActor(
  prisma: PrismaClient,
  userId: string,
  stored: Pick<StoredQueuePrefs, 'competitorFormat' | 'teamId'>,
): Promise<ResolvedQueueActor> {
  if (stored.competitorFormat === 'TWO_V_TWO') {
    const teamId = await findQueueableTeam(prisma, userId, stored.teamId);
    if (teamId) return { queueId: teamId, format: 'TWO_V_TWO', fellBackTo1v1: false };
    return { queueId: userId, format: 'ONE_V_ONE', fellBackTo1v1: true };
  }
  return { queueId: userId, format: 'ONE_V_ONE', fellBackTo1v1: false };
}

/** The Redis-side prefs of a queue entry built from stored settings + the resolved team size. */
export function toQueuePrefs(stored: StoredQueuePrefs, format: QueueCompetitorFormat): QueuePrefs {
  return { format, battleTypes: stored.battleTypes, matchFormats: stored.matchFormats };
}
