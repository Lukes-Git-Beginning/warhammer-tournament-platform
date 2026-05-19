import { describe, expect, it } from 'vitest';
import {
  generatePlayoffBracket,
  InsufficientPlayersError,
  type GeneratePlayoffArgs,
  type PlayoffFormat,
} from '../src/lib/playoff-generator.js';
import type { SwissStanding } from '../src/lib/swiss.js';

// ---------- Helpers ----------

function fakeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  );
}

/** Build a minimal SwissStanding for testing. */
function makeStanding(userId: string, score = 0): SwissStanding {
  return {
    userId,
    score,
    wins: score,
    losses: 0,
    draws: 0,
    byes: 0,
    buchholz: 0,
    solkoff: 0,
    opponentsBeaten: [],
  };
}

/** Build standings for n players, score descending from n down to 1. */
function makeStandings(n: number): SwissStanding[] {
  return fakeIds(n).map((id, i) => makeStanding(id, n - i));
}

function buildArgs(
  format: PlayoffFormat,
  standings: SwissStanding[],
  checkedIn: Set<string>,
  opts?: { playoff_match_format?: string; finale_match_format?: string },
): GeneratePlayoffArgs {
  return {
    tournament: {
      playoff_format: format,
      playoff_match_format: opts?.playoff_match_format ?? 'BO3',
      finale_match_format: opts?.finale_match_format ?? 'BO5',
    },
    finalStandings: standings,
    checkedInPlayerIds: checkedIn,
  };
}

// ---------- NONE ----------

describe('generatePlayoffBracket — NONE', () => {
  it('returns empty match array', () => {
    const standings = makeStandings(8);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('NONE', standings, checkedIn));

    expect(result.format).toBe('NONE');
    expect(result.matches).toHaveLength(0);
  });
});

// ---------- TOP4 ----------

describe('generatePlayoffBracket — TOP4', () => {
  it('produces 3 matches (2 SF + 1 Final)', () => {
    const standings = makeStandings(8);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));

    expect(result.format).toBe('TOP4');
    expect(result.matches).toHaveLength(3);
  });

  it('SF1 = Seed1 vs Seed4', () => {
    const standings = makeStandings(8);
    const ids = standings.map((s) => s.userId);
    const checkedIn = new Set(ids);
    const result = generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));

    const sf1 = result.matches.find((m) => m.round === 1 && m.bracket_position === 1)!;
    expect(sf1.player1_id).toBe(ids[0]); // Seed 1
    expect(sf1.player2_id).toBe(ids[3]); // Seed 4
  });

  it('SF2 = Seed2 vs Seed3', () => {
    const standings = makeStandings(8);
    const ids = standings.map((s) => s.userId);
    const checkedIn = new Set(ids);
    const result = generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));

    const sf2 = result.matches.find((m) => m.round === 1 && m.bracket_position === 2)!;
    expect(sf2.player1_id).toBe(ids[1]); // Seed 2
    expect(sf2.player2_id).toBe(ids[2]); // Seed 3
  });

  it('Final is round=2, bracket_position=1 with TBD player IDs', () => {
    const standings = makeStandings(8);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));

    const final = result.matches.find((m) => m.round === 2)!;
    expect(final.bracket_position).toBe(1);
    expect(final.player1_id).toBe(''); // TBD
    expect(final.player2_id).toBe(''); // TBD
  });

  it('game_count for SFs = BO3 (3), Final = BO5 (5)', () => {
    const standings = makeStandings(8);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(
      buildArgs('TOP4', standings, checkedIn, {
        playoff_match_format: 'BO3',
        finale_match_format: 'BO5',
      }),
    );

    const sf = result.matches.filter((m) => m.round === 1);
    const final = result.matches.find((m) => m.round === 2)!;
    for (const m of sf) expect(m.game_count).toBe(3);
    expect(final.game_count).toBe(5);
  });

  it('only takes from checked-in players', () => {
    const standings = makeStandings(8);
    // Only players 2–5 (index 1–4) are checked in (Seed1 is NOT checked in)
    const checkedIn = new Set(standings.slice(1, 5).map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));

    // All match players should be in checkedIn
    const allPlayers = result.matches
      .flatMap((m) => [m.player1_id, m.player2_id])
      .filter((id) => id !== '');
    for (const id of allPlayers) {
      expect(checkedIn.has(id)).toBe(true);
    }
  });

  it('throws InsufficientPlayersError when fewer than 4 checked-in', () => {
    const standings = makeStandings(8);
    // Only 3 checked in
    const checkedIn = new Set(standings.slice(0, 3).map((s) => s.userId));

    expect(() => generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn))).toThrow(
      InsufficientPlayersError,
    );
  });

  it('InsufficientPlayersError carries required and actual counts', () => {
    const standings = makeStandings(4);
    const checkedIn = new Set(standings.slice(0, 2).map((s) => s.userId)); // only 2

    try {
      generatePlayoffBracket(buildArgs('TOP4', standings, checkedIn));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientPlayersError);
      const e = err as InsufficientPlayersError;
      expect(e.required).toBe(4);
      expect(e.actual).toBe(2);
      expect(e.format).toBe('TOP4');
    }
  });
});

// ---------- TOP8 ----------

describe('generatePlayoffBracket — TOP8', () => {
  it('produces 7 matches (4 QF + 2 SF + 1 Final) with 16+ checked-in players', () => {
    const standings = makeStandings(16);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP8', standings, checkedIn));

    expect(result.format).toBe('TOP8');
    expect(result.matches).toHaveLength(7);
    expect(result.fallbackApplied).toBeUndefined();
  });

  it('QF seeding is correct: 1v8, 4v5, 3v6, 2v7', () => {
    const standings = makeStandings(16);
    const ids = standings.map((s) => s.userId);
    const checkedIn = new Set(ids);
    const result = generatePlayoffBracket(buildArgs('TOP8', standings, checkedIn));

    const qfs = result.matches.filter((m) => m.round === 1).sort(
      (a, b) => a.bracket_position - b.bracket_position,
    );
    expect(qfs).toHaveLength(4);
    // QF1: Seed1 vs Seed8 (index 0 vs index 7)
    expect(qfs[0]!.player1_id).toBe(ids[0]);
    expect(qfs[0]!.player2_id).toBe(ids[7]);
    // QF2: Seed4 vs Seed5 (index 3 vs index 4)
    expect(qfs[1]!.player1_id).toBe(ids[3]);
    expect(qfs[1]!.player2_id).toBe(ids[4]);
    // QF3: Seed3 vs Seed6 (index 2 vs index 5)
    expect(qfs[2]!.player1_id).toBe(ids[2]);
    expect(qfs[2]!.player2_id).toBe(ids[5]);
    // QF4: Seed2 vs Seed7 (index 1 vs index 6)
    expect(qfs[3]!.player1_id).toBe(ids[1]);
    expect(qfs[3]!.player2_id).toBe(ids[6]);
  });

  it('Final is at round=3 with BO5 game count', () => {
    const standings = makeStandings(16);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(
      buildArgs('TOP8', standings, checkedIn, {
        playoff_match_format: 'BO3',
        finale_match_format: 'BO5',
      }),
    );

    const final = result.matches.find((m) => m.round === 3)!;
    expect(final).toBeDefined();
    expect(final.game_count).toBe(5);
  });

  it('auto-fallback to TOP4 when fewer than 16 checked-in', () => {
    const standings = makeStandings(12);
    const checkedIn = new Set(standings.map((s) => s.userId)); // 12 < 16
    const result = generatePlayoffBracket(buildArgs('TOP8', standings, checkedIn));

    expect(result.format).toBe('TOP4');
    expect(result.fallbackApplied).toBe('TOP8_TO_TOP4');
    expect(result.matches).toHaveLength(3); // TOP4 → 2 SF + 1 Final
  });

  it('auto-fallback with exactly 15 players still yields TOP4', () => {
    const standings = makeStandings(15);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP8', standings, checkedIn));

    expect(result.fallbackApplied).toBe('TOP8_TO_TOP4');
  });

  it('with exactly 16 players, no fallback is applied', () => {
    const standings = makeStandings(16);
    const checkedIn = new Set(standings.map((s) => s.userId));
    const result = generatePlayoffBracket(buildArgs('TOP8', standings, checkedIn));

    expect(result.fallbackApplied).toBeUndefined();
    expect(result.format).toBe('TOP8');
  });
});
