// ---------------------------------------------------------------------------
// Unified GS board (Rankings + Quarterly Qualifier).
//
// One hierarchical rating fit produces, per competitor, an Overall GS plus a
// per-battle-type offset — so a single fit yields all four battle-type views
// (Overall / Domination / Conquest / Siege) without re-fitting. 1v1 competitors
// are User ids, 2v2 competitors are Team ids (both live in the SAME fit); we
// split them by looking up the team-id set. Teams get the members'-prior blend
// (resolveTeamGs) so a fresh duo still shows a sensible rating.
//
// Callers layer their own inclusion rule on top (Rankings: self-scaling cutoff;
// Quarterly: strict self-scaling gate) — this helper only produces the ranked list.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { getRatingModel } from './rating-model-service.js';
import { skillToBand } from './rating-model.js';
import { resolveTeamGs } from './team-rating.js';

export type BattleTypeFilter = 'OVERALL' | 'DOMINATION' | 'CONQUEST' | 'SIEGE';
export type CompetitorFormatFilter = 'ONE_V_ONE' | 'TWO_V_TWO';

export interface GsBoardEntry {
  /** User id (1v1) or Team id (2v2). */
  competitorId: string;
  /** GS for the selected battle type (Overall = base GS). */
  gs: number;
  stdError: number;
  band: number;
  /** The competitor's own decisive games (in the fit's window, if any). */
  gamesCount: number;
  factionsPlayed: number;
  /** 2v2 only — team estimate still leaning on the members' prior. */
  provisional: boolean;
  /** 2v2 only — the team's member user ids (for display). */
  memberIds: string[];
}

export interface GsBoardOpts {
  versionId: string | null;
  window?: { from: Date; to: Date };
  battleType: BattleTypeFilter;
  competitorFormat: CompetitorFormatFilter;
}

/**
 * Rank every competitor of the given format by their GS in the given battle type.
 * Sorted GS desc (tiebreak: more games / lower error). No inclusion gate applied here.
 */
export async function computeGsBoard(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: GsBoardOpts,
): Promise<GsBoardEntry[]> {
  const model = await getRatingModel(prisma, redis, {
    versionId: opts.versionId,
    window: opts.window,
    config: { hierarchical: true },
  });

  // The battle-type view = base GS + that battle type's offset. Overall = base GS.
  const skillFor = (competitorId: string, overall: number): number => {
    if (opts.battleType === 'OVERALL') return overall;
    const bt = model.getBattleTypeSkill(competitorId, opts.battleType);
    return bt ?? overall; // no per-type signal yet → fall back to overall
  };

  if (opts.competitorFormat === 'TWO_V_TWO') {
    const teams = await prisma.team.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, members: { select: { user_id: true } } },
    });
    const entries: GsBoardEntry[] = [];
    for (const t of teams) {
      const memberIds = t.members.map((m) => m.user_id);
      const tg = resolveTeamGs(model, t.id, memberIds);
      if (!tg) continue;
      // Apply the battle-type offset to the BLENDED team GS (the fitted team may have a
      // per-type signal even while its overall is still prior-blended).
      let gs = tg.generalSkill;
      if (opts.battleType !== 'OVERALL') {
        const btSkill = model.getBattleTypeSkill(t.id, opts.battleType);
        const overallSkill = model.getGeneralSkill(t.id)?.skill;
        if (btSkill != null && overallSkill != null) gs = tg.generalSkill + (btSkill - overallSkill);
      }
      entries.push({
        competitorId: t.id,
        gs,
        stdError: tg.stdError,
        band: skillToBand(gs),
        gamesCount: tg.gamesCount,
        factionsPlayed: 0,
        provisional: tg.provisional,
        memberIds,
      });
    }
    return entries.sort((a, b) => b.gs - a.gs || a.stdError - b.stdError);
  }

  // 1v1 — every non-team competitor in the fit.
  const teamIds = new Set(
    (await prisma.team.findMany({ select: { id: true } })).map((t) => t.id),
  );
  return model.generalSkills
    .filter((e) => !teamIds.has(e.playerId))
    .map((e) => {
      const gs = skillFor(e.playerId, e.generalSkill);
      return {
        competitorId: e.playerId,
        gs,
        stdError: e.stdError,
        band: skillToBand(gs),
        gamesCount: e.gamesCount,
        factionsPlayed: e.factionsPlayed,
        provisional: false,
        memberIds: [],
      };
    })
    .sort((a, b) => b.gs - a.gs || b.gamesCount - a.gamesCount);
}
