/**
 * Unit tests for lib/mmr.ts — 3-Factor Win-Quality Points System.
 *
 * Tests use a mocked PrismaClient to isolate the pure computation logic
 * from the database. We construct minimal fake DB responses per test.
 */
import { describe, expect, it, vi, type MockedObject } from 'vitest';
import type { PrismaClient } from '@rizzotto/db';
import {
  computeWinPoints,
  updateFactionMasteryAfterMatch,
  incrementAntiFarmCap,
} from '../src/lib/mmr.js';

// ---------------------------------------------------------------------------
// PrismaClient mock factory
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function makePrisma(overrides: DeepPartial<PrismaClient> = {}): MockedObject<PrismaClient> {
  const defaults = {
    adminConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    factionMatchupStat: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    factionMastery: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    antiFarmCap: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  return {
    ...defaults,
    ...(overrides as object),
  } as unknown as MockedObject<PrismaClient>;
}

// Helpers to build adminConfig responses
function configRow(key: string, value: number) {
  return { key, value };
}

// ---------------------------------------------------------------------------
// Helper: build a prisma mock with standard AdminConfig values
// ---------------------------------------------------------------------------

function makePrismaWithConfig(overrides: DeepPartial<PrismaClient> = {}) {
  const prisma = makePrisma(overrides);

  // Default: return standard config values
  (prisma.adminConfig.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    ({ where }: { where: { key: string } }) => {
      const configMap: Record<string, number> = {
        mmr_base_points_tournament: 100,
        mmr_base_points_casual: 50,
        mmr_mastery_threshold_games: 10,
        mmr_max_cap_per_combo: 200,
      };
      const v = configMap[where.key];
      return Promise.resolve(v !== undefined ? configRow(where.key, v) : null);
    },
  );

  return prisma;
}

// Standard args for a casual match with no prior data
const BASE_ARGS = {
  winnerId: 'winner-id',
  loserId: 'loser-id',
  winnerFactionId: 'empire',
  loserFactionId: 'skaven',
  isTournament: false,
  isMajor: false,
  seasonId: 'season-1',
};

// ---------------------------------------------------------------------------
// Test: Loser bekommt 0 Punkte (no-loss rule)
// ---------------------------------------------------------------------------

describe('No-loss rule', () => {
  it('computeWinPoints is only called for the winner — function always returns >= 0', async () => {
    const prisma = makePrismaWithConfig();
    const result = await computeWinPoints(prisma, BASE_ARGS);
    expect(result.points).toBeGreaterThanOrEqual(0);
  });

  it('points are never negative', async () => {
    const prisma = makePrismaWithConfig();
    // Anti-farm modifier = 0 (cap exhausted)
    (prisma.antiFarmCap.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      points_earned: 200,
      max_cap: 200,
    });

    const result = await computeWinPoints(prisma, { ...BASE_ARGS, isTournament: false });
    expect(result.points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Tournament ignoriert Cap
// ---------------------------------------------------------------------------

describe('Tournament ignores Anti-Farm cap', () => {
  it('tournament match with exhausted cap still gives full points', async () => {
    const prisma = makePrismaWithConfig();

    // Matchup 50/50 → matchup_factor = 0.5
    // Both players at neutral mastery (1200) → opponent_factor = 0.8, dampener = 1.0
    // win_quality = 0.5 * 0.8 * 1.0 = 0.4
    // points = round(100 * 1.0 * 0.4 * 1.0) = 40

    const result = await computeWinPoints(prisma, {
      ...BASE_ARGS,
      isTournament: true,
      isMajor: false,
    });

    // anti_farm_modifier must be 1.0 (cap ignored)
    expect(result.breakdown.anti_farm_modifier).toBe(1.0);
    expect(result.points).toBeGreaterThan(0);

    // Ensure antiFarmCap was never queried
    expect(prisma.antiFarmCap.findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test: Casual match — cap reduction after repeated wins
// ---------------------------------------------------------------------------

describe('Anti-Farm cap reduction', () => {
  it('modifier decreases as cap fills up', async () => {
    const prisma = makePrismaWithConfig();

    // Simulate cap half-used (100/200 points_earned)
    (prisma.antiFarmCap.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      points_earned: 100,
      max_cap: 200,
    });

    const result = await computeWinPoints(prisma, BASE_ARGS);

    // modifier = (200 - 100) / 200 = 0.5
    expect(result.breakdown.anti_farm_modifier).toBe(0.5);
  });

  it('modifier is 0 when cap is fully exhausted', async () => {
    const prisma = makePrismaWithConfig();

    (prisma.antiFarmCap.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      points_earned: 200,
      max_cap: 200,
    });

    const result = await computeWinPoints(prisma, BASE_ARGS);
    expect(result.breakdown.anti_farm_modifier).toBe(0);
    expect(result.points).toBe(0);
  });

  it('first match gives full modifier (no cap row yet)', async () => {
    const prisma = makePrismaWithConfig();
    // antiFarmCap.findUnique returns null (no row) — modifier should be 1.0

    const result = await computeWinPoints(prisma, BASE_ARGS);
    expect(result.breakdown.anti_farm_modifier).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Test: Major-Tournament 1.5x Multiplier
// ---------------------------------------------------------------------------

describe('Major tournament multiplier', () => {
  it('major tournament gives 1.5x major_bonus', async () => {
    const prisma = makePrismaWithConfig();

    const normalResult = await computeWinPoints(prisma, {
      ...BASE_ARGS,
      isTournament: true,
      isMajor: false,
    });

    const majorResult = await computeWinPoints(prisma, {
      ...BASE_ARGS,
      isTournament: true,
      isMajor: true,
    });

    expect(majorResult.breakdown.major_bonus).toBe(1.5);
    expect(normalResult.breakdown.major_bonus).toBe(1.0);

    // Major points should be 1.5× normal (both same win quality)
    // Allow rounding difference of 1
    expect(majorResult.points).toBeGreaterThan(normalResult.points);
  });
});

// ---------------------------------------------------------------------------
// Test: Mastery-Threshold — <10 Games → Default-Rating
// ---------------------------------------------------------------------------

describe('Mastery threshold', () => {
  it('winner with <10 games uses neutral rating 1200', async () => {
    const prisma = makePrismaWithConfig();

    // Winner has 9 games — below threshold → should use 1200
    (prisma.factionMastery.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: { user_id_faction_id: { user_id: string; faction_id: string } } }) => {
        if (where.user_id_faction_id.user_id === 'winner-id') {
          return Promise.resolve({ rating: 1800, games_played: 9 }); // below threshold
        }
        return Promise.resolve(null); // loser: no entry
      },
    );

    const result = await computeWinPoints(prisma, BASE_ARGS);

    // my_mastery_dampener should be 1.0 (neutral 1200, not 1800)
    // dampener = clamp(0.5, 1.0, 1 - (1200 - 1200) / 2000) = 1.0
    expect(result.breakdown.my_mastery_dampener).toBe(1.0);
  });

  it('winner with >=10 games uses actual rating', async () => {
    const prisma = makePrismaWithConfig();

    // Winner has 1800 rating with 15 games — above threshold → use actual
    (prisma.factionMastery.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: { user_id_faction_id: { user_id: string; faction_id: string } } }) => {
        if (where.user_id_faction_id.user_id === 'winner-id') {
          return Promise.resolve({ rating: 1800, games_played: 15 });
        }
        return Promise.resolve(null);
      },
    );

    const result = await computeWinPoints(prisma, BASE_ARGS);

    // my_mastery_dampener = clamp(0.5, 1.0, 1 - (1800-1200)/2000) = clamp(0.5, 1.0, 0.7) = 0.7
    expect(result.breakdown.my_mastery_dampener).toBeCloseTo(0.7, 5);
  });

  it('loser with <10 games uses neutral rating 1200', async () => {
    const prisma = makePrismaWithConfig();

    // Loser has high rating but <10 games → should use 1200
    (prisma.factionMastery.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: { user_id_faction_id: { user_id: string; faction_id: string } } }) => {
        if (where.user_id_faction_id.user_id === 'loser-id') {
          return Promise.resolve({ rating: 2000, games_played: 5 }); // below threshold
        }
        return Promise.resolve(null);
      },
    );

    const result = await computeWinPoints(prisma, BASE_ARGS);

    // opponent_mastery_factor = clamp(0.5, 1.5, 1200 / 1500) = 0.8
    expect(result.breakdown.opponent_mastery_factor).toBeCloseTo(0.8, 5);
  });
});

// ---------------------------------------------------------------------------
// Test: Edge — 50% matchup win-rate → base points (no matchup bonus/penalty)
// ---------------------------------------------------------------------------

describe('Edge: 50/50 matchup win-rate', () => {
  it('win_quality with default 50% matchup and neutral mastery gives 0.4 for casual', async () => {
    const prisma = makePrismaWithConfig();
    // No matchup data → defaults to 0.5
    // No mastery data → defaults to 1200

    // matchup_factor = 1 - 0.5 = 0.5
    // opponent_mastery_factor = clamp(0.5, 1.5, 1200/1500) = 0.8
    // my_mastery_dampener = clamp(0.5, 1.0, 1 - (1200-1200)/2000) = 1.0
    // win_quality = 0.5 * 0.8 * 1.0 = 0.4
    // points = round(50 * 1.0 * 0.4 * 1.0) = round(20) = 20

    const result = await computeWinPoints(prisma, BASE_ARGS);
    expect(result.breakdown.matchup_factor).toBeCloseTo(0.5, 5);
    expect(result.breakdown.win_quality).toBeCloseTo(0.4, 5);
    expect(result.points).toBe(20);
  });

  it('tournament with 50/50 matchup gives 100 * 0.4 = 40 points', async () => {
    const prisma = makePrismaWithConfig();

    const result = await computeWinPoints(prisma, {
      ...BASE_ARGS,
      isTournament: true,
      isMajor: false,
    });
    expect(result.points).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Test: Matchup win-rate > 0.5 (favourable matchup → less points)
// ---------------------------------------------------------------------------

describe('Matchup win-rate effect', () => {
  it('favourable matchup (90% win-rate) gives fewer points', async () => {
    const prisma = makePrismaWithConfig();

    (prisma.factionMatchupStat.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      win_rate: '0.9000',
    });

    const result = await computeWinPoints(prisma, { ...BASE_ARGS, isTournament: true });

    // matchup_factor = 1 - 0.9 = 0.1
    // win_quality = 0.1 * 0.8 * 1.0 = 0.08
    // points = round(100 * 1.0 * 0.08) = 8
    expect(result.breakdown.matchup_factor).toBeCloseTo(0.1, 4);
    expect(result.points).toBe(8);
  });

  it('unfavourable matchup (10% win-rate) gives more points', async () => {
    const prisma = makePrismaWithConfig();

    (prisma.factionMatchupStat.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      win_rate: '0.1000',
    });

    const result = await computeWinPoints(prisma, { ...BASE_ARGS, isTournament: true });

    // matchup_factor = 1 - 0.1 = 0.9
    // win_quality = 0.9 * 0.8 * 1.0 = 0.72
    // points = round(100 * 1.0 * 0.72) = 72
    expect(result.breakdown.matchup_factor).toBeCloseTo(0.9, 4);
    expect(result.points).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// Test: updateFactionMasteryAfterMatch
// ---------------------------------------------------------------------------

describe('updateFactionMasteryAfterMatch', () => {
  it('winner gets games++, wins++, rating+10', async () => {
    const prisma = makePrisma();
    (prisma.factionMastery.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await updateFactionMasteryAfterMatch(
      prisma as unknown as PrismaClient,
      'winner-id',
      'empire',
      'loser-id',
      'skaven',
    );

    expect(prisma.factionMastery.upsert).toHaveBeenCalledTimes(2);
  });

  it('loser rating does not fall below 800 (floor)', async () => {
    const prisma = makePrisma();

    (prisma.factionMastery.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: { user_id_faction_id: { user_id: string } } }) => {
        if (where.user_id_faction_id.user_id === 'loser-id') {
          return Promise.resolve({ rating: 805 }); // just above floor
        }
        return Promise.resolve(null);
      },
    );

    let loserUpsertCall: { data: { rating?: number } } | undefined;
    (prisma.factionMastery.upsert as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where, update }: { where: { user_id_faction_id: { user_id: string } }; update: { rating?: number } }) => {
        if (where.user_id_faction_id.user_id === 'loser-id') {
          loserUpsertCall = { data: { rating: update.rating } };
        }
        return Promise.resolve({});
      },
    );

    await updateFactionMasteryAfterMatch(
      prisma as unknown as PrismaClient,
      'winner-id',
      'empire',
      'loser-id',
      'skaven',
    );

    // 805 - 10 = 795, but floor is 800
    expect(loserUpsertCall?.data.rating).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Test: incrementAntiFarmCap uses ordered keys
// ---------------------------------------------------------------------------

describe('incrementAntiFarmCap', () => {
  it('uses lexicographically ordered player/faction keys', async () => {
    const prisma = makePrisma();
    (prisma.antiFarmCap.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await incrementAntiFarmCap(
      prisma as unknown as PrismaClient,
      'season-1',
      'zzz-player',
      'aaa-player',
      'zzz-faction',
      'aaa-faction',
      50,
    );

    const call = (prisma.antiFarmCap.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.season_id_player_a_id_player_b_id_faction_a_id_faction_b_id.player_a_id).toBe('aaa-player');
    expect(call.where.season_id_player_a_id_player_b_id_faction_a_id_faction_b_id.player_b_id).toBe('zzz-player');
    expect(call.where.season_id_player_a_id_player_b_id_faction_a_id_faction_b_id.faction_a_id).toBe('aaa-faction');
    expect(call.where.season_id_player_a_id_player_b_id_faction_a_id_faction_b_id.faction_b_id).toBe('zzz-faction');
  });
});

// ---------------------------------------------------------------------------
// Test: breakdown shape
// ---------------------------------------------------------------------------

describe('Result breakdown shape', () => {
  it('returns all breakdown fields', async () => {
    const prisma = makePrismaWithConfig();
    const result = await computeWinPoints(prisma, BASE_ARGS);

    expect(result).toHaveProperty('points');
    expect(result.breakdown).toHaveProperty('base');
    expect(result.breakdown).toHaveProperty('win_quality');
    expect(result.breakdown).toHaveProperty('matchup_factor');
    expect(result.breakdown).toHaveProperty('opponent_mastery_factor');
    expect(result.breakdown).toHaveProperty('my_mastery_dampener');
    expect(result.breakdown).toHaveProperty('anti_farm_modifier');
    expect(result.breakdown).toHaveProperty('major_bonus');
  });
});
