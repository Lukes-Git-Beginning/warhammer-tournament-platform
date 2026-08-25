/**
 * The community "Standard Ruleset" — now admin-editable.
 *
 * Stored under the AdminConfig key `standard_ruleset` as
 * `{ settings: string[]; banned: string[]; conduct: string[] }`. Until an admin
 * overrides it, these defaults apply (the original Total Tavern research values,
 * previously hard-coded in the frontend StandardRulesetCard).
 */
import { z } from 'zod';
import { prisma } from '@rizzotto/db';

export const STANDARD_RULESET_CONFIG_KEY = 'standard_ruleset';

export const StandardRulesetSchema = z.object({
  settings: z.array(z.string()),
  banned: z.array(z.string()),
  conduct: z.array(z.string()),
});

export type StandardRuleset = z.infer<typeof StandardRulesetSchema>;

export const DEFAULT_STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  conduct: [
    '10 minutes to ready up',
    '40 minute round limit',
    'Exploiting bugs or glitches is considered cheating and results in disqualification.',
  ],
};

/** Read the current standard ruleset — the admin-configured value, or the defaults. */
export async function resolveStandardRuleset(): Promise<StandardRuleset> {
  const row = await prisma.adminConfig.findUnique({ where: { key: STANDARD_RULESET_CONFIG_KEY } });
  if (!row) return DEFAULT_STANDARD_RULESET;
  const parsed = StandardRulesetSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_STANDARD_RULESET;
}
