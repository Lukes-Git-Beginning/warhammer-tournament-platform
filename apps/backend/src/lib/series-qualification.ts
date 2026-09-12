import type { PrismaClient } from '@rizzotto/db';
import {
  ScoringConfigSchema,
  computeSeriesQualifiersC,
  type QualifierPlacement,
} from './series-scoring.js';

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

  const ids = earlier.map((e) => e.id);
  const placements = await prisma.tournamentResult.findMany({
    where: { tournament_id: { in: ids } },
    select: { tournament_id: true, user_id: true, placement: true },
  });
  const perQualifier: QualifierPlacement[][] = earlier.map((e) =>
    placements
      .filter((p) => p.tournament_id === e.id)
      .map((p) => ({ tournamentId: e.id, competitorId: p.user_id, position: p.placement })),
  );
  const entries = computeSeriesQualifiersC(perQualifier, parsed.data);
  return new Set(entries.map((e) => e.competitorId));
}
