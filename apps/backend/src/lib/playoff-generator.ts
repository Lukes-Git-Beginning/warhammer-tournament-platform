/**
 * playoff-generator.ts
 *
 * Generates single-elimination playoff brackets from post-Swiss standings.
 *
 * Supported formats:
 *   NONE  — no playoff; returns empty match list.
 *   TOP4  — SF: Seed1 vs Seed4, Seed2 vs Seed3 → Final.
 *   TOP8  — QF: 1v8, 4v5, 3v6, 2v7 → two SFs → Final.
 *           Auto-fallback to TOP4 when fewer than 16 checked-in players.
 *
 * game_count per match is derived from tournament.playoff_match_format
 * (BO1=1, BO3=3, BO5=5).  The Final uses tournament.finale_match_format.
 *
 * Note: Match IDs are NOT generated here — this library returns pure
 * PlayoffMatch descriptors. The caller (route/service) is responsible for
 * assigning UUIDs and persisting them to the database with phase='PLAYOFF'.
 */

import type { SwissStanding } from './swiss.js';

// ---------- Types ----------

export type PlayoffFormat = 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';

/** Maps a MatchFormat enum value to its game count. */
const MATCH_FORMAT_GAME_COUNT: Record<string, number> = {
  BO1: 1,
  BO3: 3,
  BO5: 5,
};

export interface PlayoffMatch {
  round: number;            // 1 = QF (TOP8) or SF (TOP4); 2 = SF (TOP8) or Final (TOP4); 3 = Final (TOP8)
  bracket_position: number; // 1-based position within the round
  player1_id: string;
  player2_id: string;
  game_count: number;       // derived from playoff_match_format / finale_match_format
}

export interface GeneratePlayoffArgs {
  tournament: {
    playoff_format: PlayoffFormat;
    playoff_match_format: string; // MatchFormat enum value: 'BO1' | 'BO3' | 'BO5'
    finale_match_format: string;  // MatchFormat enum value for the Final
  };
  finalStandings: SwissStanding[]; // sorted by full tiebreaker, index 0 = rank 1
  checkedInPlayerIds: Set<string>;
}

export interface GeneratePlayoffResult {
  format: PlayoffFormat;
  matches: PlayoffMatch[];
  fallbackApplied?: 'TOP8_TO_TOP4' | 'TOP4_TO_TOP2';
}

// ---------- Errors ----------

export class InsufficientPlayersError extends Error {
  constructor(
    public readonly required: number,
    public readonly actual: number,
    public readonly format: PlayoffFormat,
  ) {
    super(
      `${format} requires at least ${required} checked-in players, but only ${actual} are checked in`,
    );
    this.name = 'InsufficientPlayersError';
  }
}

// ---------- Internal helpers ----------

/** Convert a MatchFormat string to its game count. Defaults to 1 for unknown values. */
function gameCount(matchFormat: string): number {
  return MATCH_FORMAT_GAME_COUNT[matchFormat] ?? 1;
}

/**
 * Filter `standings` to the top N seeds that are checked in.
 * Returns the seeds in rank order (rank 1 first).
 */
function topNCheckedIn(
  standings: SwissStanding[],
  n: number,
  checkedInPlayerIds: Set<string>,
): SwissStanding[] {
  return standings.filter((s) => checkedInPlayerIds.has(s.userId)).slice(0, n);
}

// ---------- Public API ----------

/**
 * Generate playoff bracket matches.
 *
 * @throws {InsufficientPlayersError} when fewer than the required number of
 *   players are checked in and auto-fallback is not applicable.
 */
export function generatePlayoffBracket(args: GeneratePlayoffArgs): GeneratePlayoffResult {
  const { tournament, finalStandings, checkedInPlayerIds } = args;
  const format = tournament.playoff_format;

  if (format === 'NONE') {
    return { format: 'NONE', matches: [] };
  }

  const normalGameCount = gameCount(tournament.playoff_match_format);
  const finaleGameCount = gameCount(tournament.finale_match_format);

  // -------------------------------------------------------------------------
  // TOP4
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // TOP2 — Grand Final only (top 2 advance, no semis).
  // -------------------------------------------------------------------------
  if (format === 'TOP2') {
    return buildTop2(finalStandings, checkedInPlayerIds, finaleGameCount);
  }

  if (format === 'TOP4') {
    // Auto-fallback to TOP2 when fewer than 8 checked-in players.
    if (checkedInPlayerIds.size < 8) {
      const result = buildTop2(finalStandings, checkedInPlayerIds, finaleGameCount);
      return { ...result, fallbackApplied: 'TOP4_TO_TOP2' };
    }
    return buildTop4(
      finalStandings,
      checkedInPlayerIds,
      normalGameCount,
      finaleGameCount,
    );
  }

  // -------------------------------------------------------------------------
  // TOP8 — with auto-fallback to TOP4 when <16 checked-in players
  // -------------------------------------------------------------------------
  if (format === 'TOP8') {
    const totalCheckedIn = checkedInPlayerIds.size;

    if (totalCheckedIn < 16) {
      // Auto-fallback: not enough players for a full TOP8
      const result = buildTop4(
        finalStandings,
        checkedInPlayerIds,
        normalGameCount,
        finaleGameCount,
      );
      return { ...result, fallbackApplied: 'TOP8_TO_TOP4' };
    }

    return buildTop8(
      finalStandings,
      checkedInPlayerIds,
      normalGameCount,
      finaleGameCount,
    );
  }

  // Should never reach here if the caller passes a valid PlayoffFormat
  return { format, matches: [] };
}

// ---------- Private bracket builders ----------

function buildTop2(
  standings: SwissStanding[],
  checkedIn: Set<string>,
  finaleGames: number,
): GeneratePlayoffResult {
  const seeds = topNCheckedIn(standings, 2, checkedIn);

  if (seeds.length < 2) {
    throw new InsufficientPlayersError(2, seeds.length, 'TOP2');
  }

  const [s1, s2] = seeds as [SwissStanding, SwissStanding];

  // Round 1 = Grand Final (top 2 advance → no semi-finals).
  const matches: PlayoffMatch[] = [
    { round: 1, bracket_position: 1, player1_id: s1.userId, player2_id: s2.userId, game_count: finaleGames },
  ];

  return { format: 'TOP2', matches };
}

function buildTop4(
  standings: SwissStanding[],
  checkedIn: Set<string>,
  normalGames: number,
  finaleGames: number,
): GeneratePlayoffResult {
  const seeds = topNCheckedIn(standings, 4, checkedIn);

  if (seeds.length < 4) {
    throw new InsufficientPlayersError(4, seeds.length, 'TOP4');
  }

  // Seedings: index 0 = Seed 1 (highest rank), index 3 = Seed 4 (lowest)
  const [s1, s2, s3, s4] = seeds as [SwissStanding, SwissStanding, SwissStanding, SwissStanding];

  // Round 1 = Semi-Finals
  //   SF1: Seed1 vs Seed4  (bracket_position 1)
  //   SF2: Seed2 vs Seed3  (bracket_position 2)
  // Round 2 = Final
  //   F:  SF1-winner vs SF2-winner  (bracket_position 1, placeholder IDs)

  const matches: PlayoffMatch[] = [
    // SF1
    {
      round: 1,
      bracket_position: 1,
      player1_id: s1.userId,
      player2_id: s4.userId,
      game_count: normalGames,
    },
    // SF2
    {
      round: 1,
      bracket_position: 2,
      player1_id: s2.userId,
      player2_id: s3.userId,
      game_count: normalGames,
    },
    // Final — TBD players represented as empty string; caller resolves after SF results
    {
      round: 2,
      bracket_position: 1,
      player1_id: '',  // TBD: winner of SF1
      player2_id: '',  // TBD: winner of SF2
      game_count: finaleGames,
    },
  ];

  return { format: 'TOP4', matches };
}

function buildTop8(
  standings: SwissStanding[],
  checkedIn: Set<string>,
  normalGames: number,
  finaleGames: number,
): GeneratePlayoffResult {
  const seeds = topNCheckedIn(standings, 8, checkedIn);

  if (seeds.length < 8) {
    throw new InsufficientPlayersError(8, seeds.length, 'TOP8');
  }

  const [s1, s2, s3, s4, s5, s6, s7, s8] =
    seeds as [
      SwissStanding, SwissStanding, SwissStanding, SwissStanding,
      SwissStanding, SwissStanding, SwissStanding, SwissStanding,
    ];

  // Round 1 = Quarter-Finals (standard seeding: 1v8, 4v5, 3v6, 2v7)
  //   QF1: Seed1 vs Seed8
  //   QF2: Seed4 vs Seed5
  //   QF3: Seed3 vs Seed6
  //   QF4: Seed2 vs Seed7
  //
  // Round 2 = Semi-Finals (winners of adjacent QFs)
  //   SF1: QF1-W vs QF2-W
  //   SF2: QF3-W vs QF4-W
  //
  // Round 3 = Final
  //   F: SF1-W vs SF2-W

  const matches: PlayoffMatch[] = [
    // Quarter-Finals
    { round: 1, bracket_position: 1, player1_id: s1.userId, player2_id: s8.userId, game_count: normalGames },
    { round: 1, bracket_position: 2, player1_id: s4.userId, player2_id: s5.userId, game_count: normalGames },
    { round: 1, bracket_position: 3, player1_id: s3.userId, player2_id: s6.userId, game_count: normalGames },
    { round: 1, bracket_position: 4, player1_id: s2.userId, player2_id: s7.userId, game_count: normalGames },

    // Semi-Finals — TBD
    { round: 2, bracket_position: 1, player1_id: '', player2_id: '', game_count: normalGames },
    { round: 2, bracket_position: 2, player1_id: '', player2_id: '', game_count: normalGames },

    // Final — TBD
    { round: 3, bracket_position: 1, player1_id: '', player2_id: '', game_count: finaleGames },
  ];

  return { format: 'TOP8', matches };
}
