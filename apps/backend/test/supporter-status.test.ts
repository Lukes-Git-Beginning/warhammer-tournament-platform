import { describe, expect, it } from 'vitest';
import {
  tiersFromDiscordRoles,
  resolveSupporterTiers,
  normalizeTiers,
  isSupporter,
  highestTier,
  NO_TIERS,
} from '../src/lib/supporter-status.js';

const ROLES = { supporterRoleId: 'r-sup', lordRoleId: 'r-lord', championRoleId: 'r-champ' };

describe('supporter-status', () => {
  it('maps Discord role IDs to tiers', () => {
    expect(tiersFromDiscordRoles(['r-lord', 'other'], ROLES)).toEqual({
      supporter: true, // cumulative: a Lord is also a Supporter
      lord: true,
      champion: false,
    });
  });

  it('ignores unconfigured / blank role IDs', () => {
    expect(tiersFromDiscordRoles(['r-sup'], { supporterRoleId: '', lordRoleId: null })).toEqual(NO_TIERS);
  });

  it('cumulative rule: any Lord or Champion is automatically a Supporter', () => {
    expect(normalizeTiers({ supporter: false, lord: false, champion: true }).supporter).toBe(true);
    expect(normalizeTiers({ supporter: false, lord: true, champion: false }).supporter).toBe(true);
    expect(normalizeTiers({ supporter: false, lord: false, champion: false }).supporter).toBe(false);
  });

  it('unions Discord-derived and admin-override tiers', () => {
    const discord = { supporter: true, lord: false, champion: false };
    const override = { supporter: false, lord: false, champion: true };
    expect(resolveSupporterTiers(discord, override)).toEqual({
      supporter: true,
      lord: false,
      champion: true,
    });
  });

  it('isSupporter + highestTier reflect standing', () => {
    expect(isSupporter(NO_TIERS)).toBe(false);
    expect(highestTier(NO_TIERS)).toBeNull();
    expect(highestTier({ supporter: true, lord: true, champion: false })).toBe('lord');
    expect(highestTier({ supporter: true, lord: true, champion: true })).toBe('champion');
    expect(highestTier({ supporter: true, lord: false, champion: false })).toBe('supporter');
  });
});
