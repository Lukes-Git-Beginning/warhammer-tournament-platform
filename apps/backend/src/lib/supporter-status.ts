// Supporter recognition — pure status resolution (Alex, 2026-08-22). See plans/kofi-and-supporters.md.
//
// A user's supporter standing has two sources OR-ed together (cumulative — a user can hold all three
// at once): tiers derived from their Discord roles, and manual admin-granted overrides. Rule: every
// Lord and every Champion is automatically a Supporter too.

export type SupporterTier = 'supporter' | 'lord' | 'champion';

export interface SupporterTiers {
  supporter: boolean;
  lord: boolean;
  champion: boolean;
}

export const NO_TIERS: SupporterTiers = { supporter: false, lord: false, champion: false };

/** The three Discord role IDs that map to the tiers (from AdminConfig / env). */
export interface SupporterRoleConfig {
  supporterRoleId?: string | null;
  lordRoleId?: string | null;
  championRoleId?: string | null;
}

/** Enforce the cumulative rule: any Lord or Champion is also a Supporter. */
export function normalizeTiers(t: SupporterTiers): SupporterTiers {
  return { supporter: t.supporter || t.lord || t.champion, lord: t.lord, champion: t.champion };
}

/** Map a guild member's role IDs to supporter tiers via the configured role IDs. */
export function tiersFromDiscordRoles(
  roleIds: readonly string[],
  config: SupporterRoleConfig,
): SupporterTiers {
  const has = (id?: string | null) => id != null && id !== '' && roleIds.includes(id);
  return normalizeTiers({
    supporter: has(config.supporterRoleId),
    lord: has(config.lordRoleId),
    champion: has(config.championRoleId),
  });
}

/** OR two tier sets together (merge Discord-derived + admin-override), then normalise. */
export function resolveSupporterTiers(a: SupporterTiers, b: SupporterTiers): SupporterTiers {
  return normalizeTiers({
    supporter: a.supporter || b.supporter,
    lord: a.lord || b.lord,
    champion: a.champion || b.champion,
  });
}

/** True if the user holds any supporter standing at all. */
export function isSupporter(t: SupporterTiers): boolean {
  return t.supporter || t.lord || t.champion;
}

/** Highest tier for headline display (champion > lord > supporter), or null if none. */
export function highestTier(t: SupporterTiers): SupporterTier | null {
  if (t.champion) return 'champion';
  if (t.lord) return 'lord';
  if (t.supporter) return 'supporter';
  return null;
}
