import type { PrismaClient } from '@rizzotto/db';
import {
  ScoringConfigSchema,
  computeSeriesQualifiersC,
  type QualifierPlacement,
} from './series-scoring.js';
import { tournamentPodium, type ChampionMatch } from '../routes/leaderboard.js';

/**
 * Placements for one qualifier, format-aware. For BALANCED_LIECHTENSTEIN "who placed" is the
 * highest division's PLAYOFF podium — reusing the SAME logic the platform already uses to crown a
 * BaLi winner (`tournamentChampion`: highest-band final), generalised to the top 4 via
 * `tournamentPodium`. So a top-3 cut needs a third-place match; 5/6/7 are not derivable. Every
 * other format uses TournamentResult.placement. Returns competitors ordered best-first (1-based).
 */
export async function getQualifierPlacements(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ userId: string; position: number }[]> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { format: true } });

  if (t?.format === 'BALANCED_LIECHTENSTEIN') {
    const [parts, matches] = await Promise.all([
      prisma.tournamentParticipant.findMany({
        where: { tournament_id: tournamentId, deleted_at: null },
        select: { user_id: true, skill_band: true },
      }),
      prisma.match.findMany({
        where: {
          tournament_id: tournamentId,
          deleted_at: null,
          phase: { in: ['PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
        },
        select: {
          phase: true,
          status: true,
          round: true,
          winner_id: true,
          player1_id: true,
          player2_id: true,
          bracket_side: true,
        },
      }),
    ]);
    const bandByUser = new Map(parts.map((p) => [p.user_id, p.skill_band ?? 0]));
    const podium = tournamentPodium(matches as ChampionMatch[], bandByUser);
    if (podium.length > 0) return podium;
    // No division playoff generated yet → fall through to the group-standing placement.
  }

  const results = await prisma.tournamentResult.findMany({
    where: { tournament_id: tournamentId },
    select: { user_id: true, placement: true },
  });
  return results.map((r) => ({ userId: r.user_id, position: r.placement })).sort((a, b) => a.position - b.position);
}

/**
 * Model C series: the set of competitor ids that already secured a final slot in EARLIER
 * qualifiers of the same series. Used to skip them when a later qualifier generates its playoffs,
 * so their slot passes to the next non-qualified finisher. Empty for non-Model-C tournaments (so
 * callers are a no-op otherwise). See plans/tournament-series-design.md.
 */
export async function getAlreadyQualifiedForQualifier(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<Set<string>> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { series_id: true, series_position: true, series: { select: { scoring_config: true } } },
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
