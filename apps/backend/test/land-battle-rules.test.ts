/**
 * Land Battle rules (pure) — the fourth battle type (2026-10-17). Wired like Conquest: its own skill scope and
 * questionnaire block (no CA Ranked queue → no ranked question), Open Play queue offers, Standard
 * Ruleset (a Conquest copy without tickets), required mod, and its own map pool (Humanboy's 34 maps;
 * the ones Conquest already has get their own Land Battle rows).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BATTLE_TYPES } from '@rizzotto/types';
import {
  CALIBRATION_QUESTIONS,
  battleTypeLabel,
  pendingCalibrationTypes,
  questionnaireFloor,
} from '../src/lib/skill-classification.js';
import { decodeOffer, encodeOffer, offerBullet } from '../src/lib/queue-matching.js';
import { DEFAULT_STANDARD_RULESET, LAND_BATTLE_CONDUCT, defaultRulesetFor } from '../src/lib/standard-ruleset.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('Land Battle — shared list and labels', () => {
  it('is a battle type with a readable label', () => {
    expect(BATTLE_TYPES).toContain('LAND_BATTLE');
    expect(battleTypeLabel('LAND_BATTLE')).toBe('Land Battle');
  });
});

describe('Land Battle — questionnaire', () => {
  const landQuestions = CALIBRATION_QUESTIONS.filter((q) => q.battleTypes?.includes('LAND_BATTLE'));

  it('asks best result, battles and self-rating — no ranked question', () => {
    expect(landQuestions.map((q) => q.id).sort()).toEqual([
      'land_battle_battles',
      'land_battle_best_result',
      'land_battle_self_rating',
    ]);
  });

  it('a Land Battle answer only raises Land Battle', () => {
    const answers = { land_battle_self_rating: '4' };
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'LAND_BATTLE')).toBe(4);
    expect(questionnaireFloor(answers, CALIBRATION_QUESTIONS, 'CONQUEST')).toBeLessThan(4);
  });

  it('asks players who calibrated before Land Battle existed for the new block', () => {
    const answers = { self_rating: '3', conquest_self_rating: '3', siege_self_rating: '3' };
    expect(pendingCalibrationTypes(answers)).toEqual(['LAND_BATTLE']);
  });
});

describe('Land Battle — Open Play offers', () => {
  it('round-trips through the Discord button id with its own letter', () => {
    const offer = { battleType: 'LAND_BATTLE' as const, size: 1 as const, matchFormat: 'BO1' as const };
    expect(encodeOffer(offer)).toBe('L:1:1');
    expect(decodeOffer(encodeOffer(offer).split(':'))).toEqual(offer);
    expect(offerBullet(offer)).toBe('Land Battle · 1v1 · Bo1');
  });
});

describe('Land Battle — Standard Ruleset default', () => {
  it('drops the ticket count (a land battle has none) and adds the Land Battle rules of play', () => {
    const lb = defaultRulesetFor('LAND_BATTLE');
    expect(lb.settings.some((s) => /ticket/i.test(s))).toBe(false);
    expect(lb.banned).toEqual(DEFAULT_STANDARD_RULESET.banned);
    expect(lb.conduct).toEqual([...DEFAULT_STANDARD_RULESET.conduct, ...LAND_BATTLE_CONDUCT]);
    expect(defaultRulesetFor('CONQUEST')).toBe(DEFAULT_STANDARD_RULESET);
  });

  it('the migration appends exactly the same rules of play as the code default', () => {
    const migration = readFileSync(
      join(repoRoot, 'packages/db/prisma/migrations/20261017100100_land_battle_maps_prefs_ruleset/migration.sql'),
      'utf8',
    );
    // In the SQL the lines sit in a JSON array inside a single-quoted literal (apostrophes doubled).
    expect(migration).toContain(JSON.stringify(LAND_BATTLE_CONDUCT).replace(/'/g, "''"));
  });
});

describe('Land Battle — map images', () => {
  // A map image URL that 404s gets the SPA fallback cached under it by the CDN, so every image the
  // migration and the seed point at must ship with the frontend build.
  it('every Land Battle image path in the migration and the seed data exists', () => {
    const migration = readFileSync(
      join(repoRoot, 'packages/db/prisma/migrations/20261017100100_land_battle_maps_prefs_ruleset/migration.sql'),
      'utf8',
    );
    const fromMigration = [...migration.matchAll(/'(\/maps\/land-battle\/[a-z0-9-]+\.png)'/g)].map((m) => m[1]!);
    const seed = JSON.parse(readFileSync(join(repoRoot, 'packages/db/prisma/map-data.json'), 'utf8')) as Array<{
      battle_type?: string;
      local_path: string | null;
    }>;
    const fromSeed = seed.filter((m) => m.battle_type === 'LAND_BATTLE').map((m) => m.local_path!);
    expect(fromMigration).toHaveLength(34);
    expect(new Set(fromSeed)).toEqual(new Set(fromMigration));
    for (const p of fromMigration) expect(existsSync(join(repoRoot, 'apps/frontend/public', p)), p).toBe(true);
  });
});

