import { describe, it, expect, vi } from 'vitest';

// Mock the rating model so we can assert HOW the GS is fetched (all-time, not version-scoped) and
// feed a decisive band-3 GS regardless of any version's game count.
vi.mock('../src/lib/rating-model-service.js', () => ({ getRatingModel: vi.fn() }));

import { getRatingModel } from '../src/lib/rating-model-service.js';
import { getPlayerClassification } from '../src/lib/skill-classification-service.js';
import { bandToLogOdds } from '../src/lib/skill-classification.js';

const mockedGetRatingModel = getRatingModel as unknown as ReturnType<typeof vi.fn>;

// Minimal prisma stub: a player whose questionnaire self-rating implies floor = 4 ("Advanced"),
// and the default calibration catalog (adminConfig row absent).
const fakePrisma = {
  user: { findUnique: async () => ({ calibration_answers: { self_rating: '4' } }) },
  adminConfig: { findUnique: async () => null },
} as never;

describe('getPlayerClassification uses the TIMELESS General Skill (regression)', () => {
  it('fits GS all-time (versionId: null) and rates on the data band, not the questionnaire floor', async () => {
    // A player with decisive mid-skill (band 3) all-time data, but their questionnaire claims band 4.
    mockedGetRatingModel.mockResolvedValue({
      getGeneralSkill: () => ({ skill: bandToLogOdds(3), se: 0.05 }), // small SE = decisive data
    });

    // The active version id is passed (as the caller does) — the fix must IGNORE it and fit all-time.
    const cls = await getPlayerClassification(fakePrisma, undefined, 'active-version-id', 'player-1');

    // The fix: the GS fit is scoped all-time (versionId: null), NOT to the passed active version —
    // otherwise a freshly-active version with no games would null the GS and reset the player.
    expect(mockedGetRatingModel).toHaveBeenCalledTimes(1);
    expect(mockedGetRatingModel.mock.calls[0]![2]).toMatchObject({ versionId: null });

    // Real all-time data → the player is rated (not "Unrated") on their data band, BELOW the floor 4.
    expect(cls.generalSkill).not.toBeNull();
    expect(cls.questionnaireFloor).toBe(4);
    expect(cls.matchmakingBand).toBeLessThan(4);
    expect(cls.rated).toBe(true);
  });
});
