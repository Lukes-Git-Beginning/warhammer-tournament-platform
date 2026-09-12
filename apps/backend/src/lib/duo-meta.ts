// ---------------------------------------------------------------------------
// 2v2 faction-duo meta (Alex 2026-09-12). A 2v2 game has two SIDES, each a faction
// pair (captain + teammate). The 24-faction matchup heatmap is infeasible for 2v2
// (576 possible duos), so the 2v2 meta tab shows "Top Winrate Duos" + "Most-picked
// Duos" instead — computed live from the version's 2v2 games, optionally per battle type.
// ---------------------------------------------------------------------------

import type { PrismaClient, $Enums } from '@rizzotto/db';
import { eligibleStatGameWhere } from './stat-eligibility.js';

export interface DuoStat {
  /** Order-independent faction pair (sorted). */
  factionIds: [string, string];
  games: number;
  wins: number;
  winRate: number; // 0..1
}

/**
 * Per-duo pick + win counts across a version's 2v2 games (optionally a single battle type).
 * Each side of a game is one duo observation; the winning side's duo scores a win. Duos with an
 * unknown faction on either member are skipped.
 */
export async function computeDuoMeta(
  prisma: PrismaClient,
  versionId: string,
  battleType?: $Enums.BattleType,
): Promise<DuoStat[]> {
  const base = eligibleStatGameWhere(versionId);
  const games = await prisma.matchGame.findMany({
    where: {
      ...base,
      ...(battleType ? { battle_type: battleType } : {}),
      // Only 2v2 games — Open Play (no tournament) is always 1v1, so it's excluded here.
      match: { ...(base.match as object), tournament: { competitor_format: 'TWO_V_TWO' } },
    },
    select: {
      winner_id: true,
      player1_faction_id: true,
      player1_faction_id_2: true,
      player2_faction_id: true,
      player2_faction_id_2: true,
      match: { select: { player1_id: true, player2_id: true } },
    },
  });

  const agg = new Map<string, { ids: [string, string]; games: number; wins: number }>();
  const record = (a: string | null, b: string | null, won: boolean) => {
    if (!a || !b) return; // need both members' factions to form a duo
    const pair = [a, b].sort() as [string, string];
    const key = pair.join('|');
    const e = agg.get(key) ?? { ids: pair, games: 0, wins: 0 };
    e.games += 1;
    if (won) e.wins += 1;
    agg.set(key, e);
  };
  for (const g of games) {
    record(g.player1_faction_id, g.player1_faction_id_2, g.winner_id === g.match.player1_id);
    record(g.player2_faction_id, g.player2_faction_id_2, g.winner_id === g.match.player2_id);
  }

  return [...agg.values()].map((e) => ({
    factionIds: e.ids,
    games: e.games,
    wins: e.wins,
    winRate: e.games > 0 ? e.wins / e.games : 0,
  }));
}
