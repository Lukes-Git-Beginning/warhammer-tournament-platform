import { balancedRounds } from './auto-swiss-service.js';
import {
  formDivisionPools,
  divisionPlayoffFormat,
  targetPoolSizeFromFormat,
  DEFAULT_BAND,
  type RankedPlayer,
} from './balanced-liechtenstein.js';
import { recommendNumberOfRounds } from './swiss.js';

export type ProjectedPlayoffFormat = 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';

export interface ProjectedDivision {
  /** Number of seeds that will contest this division's bracket. */
  size: number;
  /** The bracket shape that pool size yields (TOP2 = final + 3rd place, etc.). */
  format: ProjectedPlayoffFormat;
  /** Skill band this division belongs to (BaLi only) — for correlating a placeholder with its
   *  eventual real bracket by band. Absent for single-bracket (non-BaLi) plans. */
  band?: number;
}

export interface BracketPlan {
  /** Total planned group / Swiss rounds for the current active field. */
  groupRounds: number;
  /** Projected playoff shape — one entry per division (a single bracket for non-BaLi formats). */
  divisions: ProjectedDivision[];
}

/**
 * Deterministic projection of the bracket structure for the CURRENT active field, using the
 * exact same sizing functions the real generation uses (`balancedRounds`, `formDivisionPools`,
 * `divisionPlayoffFormat`) — so a placeholder rendered from this can never diverge from what is
 * actually built. Recomputed on every bracket fetch, so it tracks drops / late-joins live.
 *
 * `activeBands` is one skill_band per active (non-dropped) contender; it drives Balanced
 * Liechtenstein's division shape, and its length is the active head count for every format.
 */
export function projectBracketPlan(opts: {
  format: string;
  playoffFormat: string | null;
  roundsCount: number | null;
  activeBands: number[];
}): BracketPlan {
  const active = opts.activeBands.length;

  if (opts.format === 'BALANCED_LIECHTENSTEIN') {
    // The stored rounds_count is the live, floored truth once running; fall back to the size rule.
    const groupRounds = opts.roundsCount ?? balancedRounds(active);
    // Divisions form by band (formDivisionPools) — the SHAPE needs only the bands, not final ranks.
    const ranked: RankedPlayer[] = opts.activeBands.map((band, i) => ({
      userId: String(i),
      band: band || DEFAULT_BAND,
      rank: i + 1,
      rawScore: 0,
    }));
    const pools = formDivisionPools(ranked, groupRounds, targetPoolSizeFromFormat(opts.playoffFormat));
    const divisions: ProjectedDivision[] = pools
      .filter((p) => p.players.length >= 2)
      .map((p) => ({ size: p.players.length, format: divisionPlayoffFormat(p.players.length), band: p.band }));
    return { groupRounds, divisions };
  }

  // Swiss / Auto Swiss / classic Liechtenstein: one shared bracket seeded from the final standings.
  const groupRounds = opts.roundsCount ?? recommendNumberOfRounds(active);
  const fmt: ProjectedPlayoffFormat =
    opts.playoffFormat === 'TOP8' || opts.playoffFormat === 'TOP4' || opts.playoffFormat === 'TOP2'
      ? opts.playoffFormat
      : 'NONE';
  // Apply the same head-count fallback generatePlayoffBracket uses at real generation time,
  // so the preview shows the EFFECTIVE format live (a TOP8 config with 10 active players
  // previews as TOP4, not a ghost TOP8). Thresholds mirror the generator: TOP8 needs ≥16,
  // TOP4 needs ≥8; below that each drops one tier.
  let effectiveFmt: ProjectedPlayoffFormat = fmt;
  if (fmt === 'TOP8') {
    if (active < 8) effectiveFmt = 'TOP2';
    else if (active < 16) effectiveFmt = 'TOP4';
  } else if (fmt === 'TOP4') {
    if (active < 8) effectiveFmt = 'TOP2';
  }
  const cutoff = effectiveFmt === 'TOP8' ? 8 : effectiveFmt === 'TOP4' ? 4 : effectiveFmt === 'TOP2' ? 2 : 0;
  const divisions: ProjectedDivision[] =
    cutoff > 0 && active >= 2 ? [{ size: Math.min(cutoff, active), format: effectiveFmt }] : [];
  return { groupRounds, divisions };
}
