/**
 * Standard Ruleset ban categories (2026-10-07): banned_factions + banned_abilities were added next to
 * banned (units). Rulesets stored before then must still parse, with the new lists empty.
 */
import { describe, expect, it } from 'vitest';
import { StandardRulesetMapSchema, StandardRulesetSchema, DEFAULT_STANDARD_RULESET } from '../src/lib/standard-ruleset.js';

describe('StandardRulesetSchema', () => {
  it('reads a pre-2026-10-07 ruleset with the new ban lists defaulted to []', () => {
    const parsed = StandardRulesetSchema.parse({ settings: ['a'], banned: ['Dreadmaw'], conduct: ['c'] });
    expect(parsed.banned_factions).toEqual([]);
    expect(parsed.banned_abilities).toEqual([]);
    expect(parsed.banned).toEqual(['Dreadmaw']);
  });

  it('reads a stored per-combo map of old rulesets', () => {
    const map = StandardRulesetMapSchema.parse({ 'DOMINATION:ONE_V_ONE': { settings: [], banned: [], conduct: [] } });
    expect(map['DOMINATION:ONE_V_ONE']).toMatchObject({ banned_factions: [], banned_abilities: [] });
  });

  it('keeps the new lists when present, and the defaults carry them', () => {
    const parsed = StandardRulesetSchema.parse({
      settings: [], banned_factions: ['Kislev'], banned: [], banned_abilities: ['Masque of Slaanesh'], conduct: [],
    });
    expect(parsed.banned_factions).toEqual(['Kislev']);
    expect(parsed.banned_abilities).toEqual(['Masque of Slaanesh']);
    expect(DEFAULT_STANDARD_RULESET).toMatchObject({ banned_factions: ['undead_legions'], banned_abilities: [] });
  });
});
