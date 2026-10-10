import type { Prisma, PrismaClient } from '@rizzotto/db';
import { ALL_BATTLE_TYPES, type QueueBattleType, type QueueCompetitorFormat } from './queue-matching.js';

export const ALL_COMPETITOR_FORMATS = ['ONE_V_ONE', 'TWO_V_TWO'] as const;

/**
 * Which tournaments a player wants the tournament-availability DM for (UserTournamentNotifyPref row,
 * defaults when absent). The defaults mean "everything", i.e. the behaviour before the filter existed.
 */
export interface TournamentNotifyPrefs {
  battleTypes: QueueBattleType[];
  competitorFormats: QueueCompetitorFormat[];
}

export function defaultTournamentNotifyPrefs(): TournamentNotifyPrefs {
  return { battleTypes: [...ALL_BATTLE_TYPES], competitorFormats: [...ALL_COMPETITOR_FORMATS] };
}

type PrefRow = { battle_types: string[]; competitor_formats: string[] };

function fromRow(row: PrefRow | null | undefined): TournamentNotifyPrefs {
  if (!row) return defaultTournamentNotifyPrefs();
  const battleTypes = row.battle_types.filter((b): b is QueueBattleType =>
    (ALL_BATTLE_TYPES as readonly string[]).includes(b),
  );
  const competitorFormats = row.competitor_formats.filter((f): f is QueueCompetitorFormat =>
    (ALL_COMPETITOR_FORMATS as readonly string[]).includes(f),
  );
  return {
    battleTypes: battleTypes.length > 0 ? battleTypes : [...ALL_BATTLE_TYPES],
    competitorFormats: competitorFormats.length > 0 ? competitorFormats : [...ALL_COMPETITOR_FORMATS],
  };
}

export async function getTournamentNotifyPrefs(
  prisma: PrismaClient,
  userId: string,
): Promise<TournamentNotifyPrefs> {
  return fromRow(await prisma.userTournamentNotifyPref.findUnique({ where: { user_id: userId } }));
}

export async function saveTournamentNotifyPrefs(
  prisma: PrismaClient,
  userId: string,
  prefs: TournamentNotifyPrefs,
): Promise<void> {
  const data = { battle_types: prefs.battleTypes, competitor_formats: prefs.competitorFormats };
  await prisma.userTournamentNotifyPref.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });
}

/**
 * User filter for the tournament-availability DM: not paused, and either no stored prefs (= all) or
 * prefs that include this tournament's battle type and team size.
 */
export function tournamentNotifyUserWhere(
  battleType: QueueBattleType,
  competitorFormat: QueueCompetitorFormat,
): Prisma.UserWhereInput {
  return {
    availability_paused: false,
    OR: [
      { tournament_notify_pref: { is: null } },
      {
        tournament_notify_pref: {
          is: { battle_types: { has: battleType }, competitor_formats: { has: competitorFormat } },
        },
      },
    ],
  };
}
