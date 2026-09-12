/**
 * The community "Standard Ruleset" — admin-editable, per (battle type × team size).
 *
 * Stored under the AdminConfig key `standard_ruleset` as a map keyed by
 * `"<BattleType>:<CompetitorFormat>"` (6 combos), each value being
 * `{ settings: string[]; banned: string[]; conduct: string[] }`. Until an admin
 * overrides a combo, the defaults apply (the original Total Tavern research values,
 * previously hard-coded in the frontend StandardRulesetCard).
 *
 * Backwards compatible: an older single-ruleset value (the pre-6-combo shape) is read
 * as the ruleset for every combo.
 */
import { z } from 'zod';
import type { $Enums } from '@rizzotto/db';
import { prisma } from '@rizzotto/db';

export const STANDARD_RULESET_CONFIG_KEY = 'standard_ruleset';

export const StandardRulesetSchema = z.object({
  settings: z.array(z.string()),
  banned: z.array(z.string()),
  conduct: z.array(z.string()),
});
export type StandardRuleset = z.infer<typeof StandardRulesetSchema>;

const BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;
const COMPETITOR_FORMATS = ['ONE_V_ONE', 'TWO_V_TWO'] as const;

/** Config key for one combo, e.g. "DOMINATION:ONE_V_ONE". */
export function rulesetKey(battleType: $Enums.BattleType, competitorFormat: $Enums.CompetitorFormat): string {
  return `${battleType}:${competitorFormat}`;
}

/** Every (battle type × team size) key — the 6 combos. */
export function allRulesetKeys(): string[] {
  return BATTLE_TYPES.flatMap((bt) => COMPETITOR_FORMATS.map((cf) => `${bt}:${cf}`));
}

export const StandardRulesetMapSchema = z.record(z.string(), StandardRulesetSchema);
export type StandardRulesetMap = z.infer<typeof StandardRulesetMapSchema>;

export const DEFAULT_STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  conduct: [
    '10 minutes to ready up',
    '40 minute round limit',
    'Exploiting bugs or glitches is considered cheating and results in disqualification.',
  ],
};

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
  if (!row) return DEFAULT_STANDARD_RULESET;
  const map = parseStored(row.value);
  return map[rulesetKey(battleType, competitorFormat)] ?? DEFAULT_STANDARD_RULESET;
}

/** Read all 6 combos, filling any missing combo with the defaults. */
export async function resolveAllStandardRulesets(): Promise<Record<string, StandardRuleset>> {
  const row = await prisma.adminConfig.findUnique({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
  const stored = row ? parseStored(row.value) : {};
  return Object.fromEntries(allRulesetKeys().map((k) => [k, stored[k] ?? DEFAULT_STANDARD_RULESET]));
}
