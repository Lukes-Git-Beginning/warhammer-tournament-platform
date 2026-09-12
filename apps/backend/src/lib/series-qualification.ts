import type { PrismaClient } from '@rizzotto/db';
import {
  ScoringConfigSchema,
  computeSeriesQualifiersC,
  type QualifierPlacement,
} from './series-scoring.js';
import { computeSingleElimPlacements } from './finalize-tournament.js';

/**
 * Placements for one qualifier, format-aware. For BALANCED_LIECHTENSTEIN the qualification
 * result is the **highest division's playoff** (Alex 2026-09-12) — NOT the group standing that
 * TournamentResult stores for BaLi. Every other format uses TournamentResult.placement.
 * Returns competitors ordered best-first with a 1-based `position`.
 */
export async function getQualifierPlacements(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ userId: string; position: number }[]> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { format: true } });
  if (t?.format === 'BALANCED_LIECHTENSTEIN') return getBaliHighestDivisionPlacements(prisma, tournamentId);
  const results = await prisma.tournamentResult.findMany({
    where: { tournament_id: tournamentId },
    select: { user_id: true, placement: true },
  });
  return results.map((r) => ({ userId: r.user_id, position: r.placement })).sort((a, b) => a.position - b.position);
}

/**
 * Ordered finishers of a BaLi tournament's HIGHEST generated division playoff (champion=1,
 * runner-up=2, then SF losers, …). Highest division = the `playoff_division_generated` event
 * with the greatest band (5=Top … 1=New). Uses the existing single-elim placement logic on
 * that division's bracket only. Returns [] if no division playoff generated or its final is
 * not yet decided. See plans/tournament-series-design.md.
 */
async function getBaliHighestDivisionPlacements(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ userId: string; position: number }[]> {
  const events = await prisma.tournamentEvent.findMany({
    where: { tournament_id: tournamentId, type: 'playoff_division_generated' },
    select: { payload: true },
  });
  const divs = events
    .map((e) => e.payload as unknown as { band?: number; seeds?: string[] })
    .filter((p): p is { band: number; seeds: string[] } => typeof p?.band === 'number' && Array.isArray(p?.seeds));
  if (divs.length === 0) return [];
  divs.sort((a, b) => b.band - a.band); // highest band = top division
  const top = divs[0];
  if (!top) return [];
  const seedSet = new Set(top.seeds);
  const seedIndex = new Map(top.seeds.map((id, i) => [id, i] as const));

  const matches = await prisma.match.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
      OR: [{ player1_id: { in: top.seeds } }, { player2_id: { in: top.seeds } }],
    },
    select: { round: true, phase: true, winner_id: true, player1_id: true, player2_id: true, status: true, bracket_side: true },
  });
  // Isolate this division's bracket: both seated players belong to its seed pool.
  const divMatches = matches.filter(
    (m) => (m.player1_id == null || seedSet.has(m.player1_id)) && (m.player2_id == null || seedSet.has(m.player2_id)),
  );
  const finalDecided = divMatches.some((m) => m.phase === 'PLAYOFF_FINAL' && m.status === 'COMPLETED' && !!m.winner_id);
  if (!finalDecided) return [];

  const placements = computeSingleElimPlacements(
    divMatches.map((m) => ({
      round: m.round,
      winner_id: m.winner_id,
      player1_id: m.player1_id,
      player2_id: m.player2_id,
      status: m.status,
      bracket_side: m.bracket_side ?? null,
      phase: m.phase ?? null,
    })),
  );
  return [...placements.entries()]
    .map(([userId, position]) => ({ userId, position }))
    // Tie-break equal placements (e.g. both SF losers = 3) by division seed order → deterministic.
    .sort((a, b) => a.position - b.position || (seedIndex.get(a.userId) ?? 1e9) - (seedIndex.get(b.userId) ?? 1e9));
}

/**
 * Model C series: the set of competitor ids that already secured a final slot in EARLIER
 * qualifiers of the same series. Used to skip them when a later qualifier generates its
 * playoffs, so their slot passes to the next non-qualified finisher. Returns an empty set
 * for tournaments that are not part of a Model-C series (so callers are a no-op otherwise).
 * See plans/tournament-series-design.md.
 */
export async function getAlreadyQualifiedForQualifier(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<Set<string>> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      series_id: true,
      series_position: true,
      series: { select: { scoring_config: true } },
    },
  });
  if (!t?.series_id || t.series_position == null || !t.series) return new Set();

  const parsed = ScoringConfigSchema.safeParse(t.series.scoring_config);
  if (!parsed.success || parsed.data.model !== 'C') return new Set();

  // Earlier qualifiers (lower series_position), completed, in series order.
  const earlier = await prisma.tournament.findMany({
    where: {
      series_id: t.series_id,
      series_position: { lt: t.series_position },
      status: 'COMPLETED',
      deleted_at: null,
    },
    select: { id: true },
    orderBy: { series_position: 'asc' },
  });
  if (earlier.length === 0) return new Set();

  const perQualifier: QualifierPlacement[][] = [];
  for (const e of earlier) {
    const placements = await getQualifierPlacements(prisma, e.id);
    perQualifier.push(placements.map((p) => ({ tournamentId: e.id, competitorId: p.userId, position: p.position })));
  }
  const entries = computeSeriesQualifiersC(perQualifier, parsed.data);
  return new Set(entries.map((e) => e.competitorId));
}
