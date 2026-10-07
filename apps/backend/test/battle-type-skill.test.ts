/**
 * Battle-type skill (plans/battle-type-skill.md, 2026-10-08).
 *
 * Trigger: Maze (219 Domination + 1 Conquest game) showed 85% on his profile while the Rankings
 * board showed 93% — the profile read the raw base GS, which one game in a second battle type drags
 * toward the unweighted centroid of the per-type skills. Skill is now judged per scope: OVERALL =
 * game-weighted, a battle type = the overall level plus that type's deviation shrunk by its games.
 * The questionnaire floor of a type only counts that type's questions + the general ones.
 */
import { describe, expect, it } from 'vitest';
import { fitRatingModel, type MatchObservation } from '../src/lib/rating-model.js';
import {
  CALIBRATION_QUESTIONS,
  pendingCalibrationTypes,
  questionnaireFloor,
} from '../src/lib/skill-classification.js';
import { classifyWithModel, scopeForBattleType, withBattleTypeScopes } from '../src/lib/skill-classification-service.js';
import { buildSnapshotRows } from '../src/lib/gs-history.js';

// One faction for everyone → the matchup term is always a mirror (0), isolating GS/BTO behaviour.
const F = 'f';
function game(winnerId: string, loserId: string, battleType: string): MatchObservation {
  return { playerAId: winnerId, factionXId: F, playerBId: loserId, factionYId: F, aWon: true, battleType };
}
function record(p: string, wins: number, losses: number, battleType: string): MatchObservation[] {
  const obs: MatchObservation[] = [];
  for (let i = 0; i < wins; i++) obs.push(game(p, `${battleType}-w-${i}`, battleType));
  for (let i = 0; i < losses; i++) obs.push(game(`${battleType}-l-${i}`, p, battleType));
  return obs;
}

/** The Maze shape: a strong, high-volume Domination player who lost his one Conquest game. */
function mazeModel() {
  return fitRatingModel([...record('P', 160, 59, 'DOMINATION'), ...record('P', 0, 1, 'CONQUEST')], {
    hierarchical: true,
  });
}

describe('getSkillEstimate — scoped skill', () => {
  it('OVERALL is game-weighted, not the dragged base GS (the Maze case)', () => {
    const m = mazeModel();
    const overall = m.getSkillEstimate('P', 'OVERALL')!;
    const dom = m.getSkillEstimate('P', 'DOMINATION')!;
    expect(Math.abs(overall.skill - dom.skill)).toBeLessThan(0.05);
    expect(overall.skill).toBeGreaterThan(m.getGeneralSkill('P')!.skill); // base GS is dragged down
    expect(overall.gamesCount).toBe(220);
    expect(dom.gamesCount).toBe(219);
  });

  it('one game in a new battle type barely moves that type away from the overall level', () => {
    const m = mazeModel();
    const overall = m.getSkillEstimate('P', 'OVERALL')!.skill;
    const conq = m.getSkillEstimate('P', 'CONQUEST')!;
    const rawConq = m.getBattleTypeSkill('P', 'CONQUEST')!; // the fit's raw per-type view
    expect(conq.gamesCount).toBe(1);
    expect(overall - conq.skill).toBeLessThan(0.3); // shrunk toward the overall level…
    expect(conq.skill).toBeGreaterThan(rawConq + 0.5); // …not left at the raw one-game value
  });

  it('a battle type never played = the overall level, 0 games', () => {
    const m = mazeModel();
    const siege = m.getSkillEstimate('P', 'SIEGE')!;
    expect(siege.skill).toBeCloseTo(m.getSkillEstimate('P', 'OVERALL')!.skill, 10);
    expect(siege.gamesCount).toBe(0);
  });

  it('keeps a genuine per-type difference once both types have a real sample', () => {
    const m = fitRatingModel([...record('P', 28, 12, 'DOMINATION'), ...record('P', 14, 26, 'CONQUEST')], {
      hierarchical: true,
    });
    const dom = m.getSkillEstimate('P', 'DOMINATION')!.skill;
    const conq = m.getSkillEstimate('P', 'CONQUEST')!.skill;
    const overall = m.getSkillEstimate('P', 'OVERALL')!.skill;
    expect(dom).toBeGreaterThan(conq + 0.2);
    expect(overall).toBeLessThan(dom);
    expect(overall).toBeGreaterThan(conq);
  });

  it('null for a player without a fitted GS', () => {
    expect(mazeModel().getSkillEstimate('nobody', 'OVERALL')).toBeNull();
  });
});

describe('questionnaire floor per battle type', () => {
  it('a Domination achievement does not set a Conquest floor (no transfer)', () => {
    const answers = { best_result: 'tt_top16' }; // Domination band 5
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'DOMINATION')).toBe(5);
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'CONQUEST')).toBe(1);
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'OVERALL')).toBe(5);
  });

  it('general questions count toward every type', () => {
    const answers = { years_competitive: 'gt2y' }; // general, band 3
    for (const scope of ['DOMINATION', 'CONQUEST', 'SIEGE', 'OVERALL'] as const) {
      expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, scope)).toBe(3);
    }
  });

  it('a type-specific answer only raises its own type', () => {
    const answers = { conquest_self_rating: '4', siege_battles: '50_200' };
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'CONQUEST')).toBe(4);
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'SIEGE')).toBe(2);
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'DOMINATION')).toBe(1);
  });

  it('Conquest has a CA Ranked question, Siege does not', () => {
    const ids = CALIBRATION_QUESTIONS.map((q) => q.id);
    expect(ids).toContain('conquest_ranked');
    expect(ids.some((id) => id.startsWith('siege_') && id.includes('ranked'))).toBe(false);
  });
});

describe('pendingCalibrationTypes — banner for players calibrated before the rework', () => {
  it('pre-rework answers (Domination + general) → Conquest and Siege pending', () => {
    expect(pendingCalibrationTypes({ best_result: 'won_open', years_competitive: 'gt2y' })).toEqual([
      'CONQUEST',
      'SIEGE',
    ]);
  });
  it('any answer for a type clears it (a "skipped" marker counts)', () => {
    expect(pendingCalibrationTypes({ best_result: 'none', conquest_battles: 'lt10', siege_self_rating: 'skipped' })).toEqual([]);
  });
  it('uncalibrated players get the normal CTA, not the banner', () => {
    expect(pendingCalibrationTypes({})).toEqual([]);
  });
});

describe('withBattleTypeScopes — admin catalogs saved before the rework', () => {
  it('unscoped legacy questions inherit their built-in scope and missing types are appended', () => {
    const legacy = CALIBRATION_QUESTIONS.filter((q) => !q.id.startsWith('conquest_') && !q.id.startsWith('siege_')).map(
      ({ battleTypes: _bt, ...q }) => q,
    );
    const migrated = withBattleTypeScopes(legacy);
    expect(migrated.find((q) => q.id === 'best_result')?.battleTypes).toEqual(['DOMINATION']);
    expect(migrated.find((q) => q.id === 'years_competitive')?.battleTypes).toBeUndefined();
    expect(migrated.some((q) => q.id === 'conquest_self_rating')).toBe(true);
    expect(migrated.some((q) => q.id === 'siege_best_result')).toBe(true);
  });
  it('is a no-op for an already-scoped catalog', () => {
    expect(withBattleTypeScopes([...CALIBRATION_QUESTIONS]).length).toBe(CALIBRATION_QUESTIONS.length);
  });
});

describe('classifyWithModel', () => {
  it('Maze: OVERALL and Domination stay Top, Conquest stays near it and is provisional', () => {
    const m = mazeModel();
    const overall = classifyWithModel(m, {}, CALIBRATION_QUESTIONS, 'P', 'OVERALL');
    const conq = classifyWithModel(m, {}, CALIBRATION_QUESTIONS, 'P', 'CONQUEST');
    expect(overall.scope).toBe('OVERALL');
    expect(overall.provisional).toBe(false);
    expect(conq.scope).toBe('CONQUEST');
    expect(conq.scopeGames).toBe(1);
    expect(conq.provisional).toBe(true);
    expect(conq.matchmakingWinChance).toBeGreaterThan(overall.matchmakingWinChance - 0.06);
  });

  it('scopeForBattleType maps tournament battle types, falls back to OVERALL', () => {
    expect(scopeForBattleType('CONQUEST')).toBe('CONQUEST');
    expect(scopeForBattleType(null)).toBe('OVERALL');
    expect(scopeForBattleType('LAND_BATTLE')).toBe('OVERALL');
  });
});

describe('buildSnapshotRows — one row per scope', () => {
  it('OVERALL + every played battle type, real users only', () => {
    const m = mazeModel();
    const day = new Date(Date.UTC(2026, 9, 8));
    const rows = buildSnapshotRows(m, day, new Set(['P']), 'v1');
    expect(rows.map((r) => r.battle_type).sort()).toEqual(['CONQUEST', 'DOMINATION', 'OVERALL']);
    const overall = rows.find((r) => r.battle_type === 'OVERALL')!;
    expect(overall.general_skill).toBeCloseTo(m.getSkillEstimate('P', 'OVERALL')!.skill, 10);
    expect(overall).toMatchObject({ user_id: 'P', snapshot_date: day, games_count: 220, version_id: 'v1' });
    expect(rows.every((r) => r.user_id === 'P')).toBe(true); // opponents aren't in validUserIds
  });
});
