/**
 * The community "Standard Ruleset" — admin-editable, per (battle type × team size).
 *
 * Stored under the AdminConfig key `standard_ruleset` as a map keyed by
 * `"<BattleType>:<CompetitorFormat>"` (one combo per battle type and team size), each value being
 * `{ settings; banned_factions; banned (units); banned_abilities (spells/items/abilities); conduct }`,
 * all string lists. The two extra ban lists were added 2026-10-07 and default to [] so rulesets
 * stored before then still parse without a migration. Until an admin
 * overrides a combo, the defaults apply (the original Total Tavern research values,
 * previously hard-coded in the frontend StandardRulesetCard).
 *
 * Backwards compatible: an older single-ruleset value (the pre-6-combo shape) is read
 * as the ruleset for every combo.
 */
import { z } from 'zod';
import { BATTLE_TYPES } from '@rizzotto/types';
import type { $Enums } from '@rizzotto/db';
import { prisma } from '@rizzotto/db';

export const STANDARD_RULESET_CONFIG_KEY = 'standard_ruleset';

export const StandardRulesetSchema = z.object({
  settings: z.array(z.string()),
  banned_factions: z.array(z.string()).default([]),
  /** Banned units (kept as `banned` for backwards compatibility). */
  banned: z.array(z.string()),
  /** Banned spells, items and abilities. */
  banned_abilities: z.array(z.string()).default([]),
  conduct: z.array(z.string()),
});
export type StandardRuleset = z.infer<typeof StandardRulesetSchema>;

const COMPETITOR_FORMATS = ['ONE_V_ONE', 'TWO_V_TWO'] as const;

/** Config key for one combo, e.g. "DOMINATION:ONE_V_ONE". */
export function rulesetKey(battleType: $Enums.BattleType, competitorFormat: $Enums.CompetitorFormat): string {
  return `${battleType}:${competitorFormat}`;
}

/** Every (battle type × team size) key — one combo per battle type and team size. */
export function allRulesetKeys(): string[] {
  return BATTLE_TYPES.flatMap((bt) => COMPETITOR_FORMATS.map((cf) => `${bt}:${cf}`));
}

export const StandardRulesetMapSchema = z.record(z.string(), StandardRulesetSchema);
export type StandardRulesetMap = z.infer<typeof StandardRulesetMapSchema>;

export const DEFAULT_STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned_factions: ['undead_legions'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  banned_abilities: [],
  conduct: [
    '10 minutes to ready up',
    '40 minute round limit',
    'Exploiting bugs or glitches is considered cheating and results in disqualification.',
  ],
};

/**
 * Land Battle's rules of play, condensed from the Fruit Rules (Cranberry Edition v10, Land Battle):
 * the attacking rule, white line abuse and forest abuse. Conquest's edition has neither; a land
 * battle has no capture points, so these keep both players engaging (the full document is linked from
 * the ruleset via the fruit-rules-land-battle permalink). The migration that seeds the
 * Land Battle ruleset appends the same lines (a test keeps them in sync).
 */
export const LAND_BATTLE_CONDUCT: readonly string[] = [
  'Both players must attack at all times: shooting, melee, chasing routing units, and advancing or repositioning at a reasonable pace count. Stalling does not.',
  "Single entities only count as attacking by shooting (not characters or flyers, except Ku'Gath and Saytang), or in melee once all your multi-entity units are dead, routing or unable to attack. Cycle charging with single entities never counts.",
  "No white line abuse: don't hold or reposition defensively within about 200 m of a map border (impassable terrain on the border counts as border). Units near a border don't have to be attacked.",
  "No forest camping: don't hold defensive positions in forests with a significant part of your army. Nobody has to attack into or next to a forest; falling back to open field is allowed.",
];

/** Domquest's lobby settings as RizzOtto's Arena Mod fixes them (bans and conduct as in Domination). */
export const DOMQUEST_SETTINGS: readonly string[] = [
  'Starting Army 12,400',
  'Reinforcing Army up to 5,600',
  'Ultra Unit Scale',
  'Unit Caps On',
  'No Character Loading',
  '600 Tickets',
];

/** The default for one battle type until an admin sets it. A land battle has no tickets, so its
 *  default drops the ticket count and adds the Land Battle rules of play. Domquest keeps Domination's
 *  bans and conduct with its own settings. */
export function defaultRulesetFor(battleType: $Enums.BattleType): StandardRuleset {
  if (battleType === 'DOMQUEST') return { ...DEFAULT_STANDARD_RULESET, settings: [...DOMQUEST_SETTINGS] };
  if (battleType !== 'LAND_BATTLE') return DEFAULT_STANDARD_RULESET;
  return {
    ...DEFAULT_STANDARD_RULESET,
    settings: DEFAULT_STANDARD_RULESET.settings.filter((s) => !/ticket/i.test(s)),
    conduct: [...DEFAULT_STANDARD_RULESET.conduct, ...LAND_BATTLE_CONDUCT],
  };
}

/** Parse the stored AdminConfig value into a per-combo map (handling the legacy single shape). */
function parseStored(value: unknown): StandardRulesetMap {
  const asMap = StandardRulesetMapSchema.safeParse(value);
  if (asMap.success) return asMap.data;
  // Legacy single-ruleset value → apply it to every combo.
  const asSingle = StandardRulesetSchema.safeParse(value);
  if (asSingle.success) {
    return Object.fromEntries(allRulesetKeys().map((k) => [k, asSingle.data]));
  }
  return {};
}

/** Read one combo's ruleset — the admin-configured value, or the defaults. */
export async function resolveStandardRuleset(
  battleType: $Enums.BattleType = 'DOMINATION',
  competitorFormat: $Enums.CompetitorFormat = 'ONE_V_ONE',
): Promise<StandardRuleset> {
  const row = await prisma.adminConfig.findUnique({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
  if (!row) return defaultRulesetFor(battleType);
  const map = parseStored(row.value);
  return map[rulesetKey(battleType, competitorFormat)] ?? defaultRulesetFor(battleType);
}

/** Read every combo, filling any missing combo with its battle type's defaults. */
export async function resolveAllStandardRulesets(): Promise<Record<string, StandardRuleset>> {
  const row = await prisma.adminConfig.findUnique({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
  const stored = row ? parseStored(row.value) : {};
  return Object.fromEntries(
    allRulesetKeys().map((k) => [k, stored[k] ?? defaultRulesetFor(k.split(':')[0] as $Enums.BattleType)]),
  );
}

const normFactionKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Faction ids banned by a combo's Standard Ruleset. The admin editor stores faction ids, but an
 * entry typed as a name ("Undead Legions") is resolved too (case/spacing-insensitive against the
 * faction id and name), so a legacy free-text entry still bans. Unknown entries are ignored.
 */
export async function standardBannedFactionIds(
  battleType: $Enums.BattleType = 'DOMINATION',
  competitorFormat: $Enums.CompetitorFormat = 'ONE_V_ONE',
): Promise<string[]> {
  const ruleset = await resolveStandardRuleset(battleType, competitorFormat);
  if (ruleset.banned_factions.length === 0) return [];
  const factions = await prisma.faction.findMany({ select: { id: true, name: true } });
  const byKey = new Map<string, string>();
  for (const f of factions) {
    byKey.set(normFactionKey(f.id), f.id);
    byKey.set(normFactionKey(f.name), f.id);
  }
  const ids = ruleset.banned_factions
    .map((entry) => byKey.get(normFactionKey(entry)))
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/**
 * Open Play is bound by the Standard Ruleset (Alex, 2026-10-07): its banned factions cannot be
 * picked there. Tournaments are NOT — a host runs with or without the Standard Rules and bans
 * factions per tournament. Returns [] for a tournament match.
 */
export async function openPlayBannedFactionIds(match: {
  tournament_id: string | null;
  competitor_format: $Enums.CompetitorFormat;
  battle_type: $Enums.BattleType | null | undefined;
}): Promise<string[]> {
  if (match.tournament_id) return [];
  return standardBannedFactionIds(match.battle_type ?? 'DOMINATION', match.competitor_format);
}
