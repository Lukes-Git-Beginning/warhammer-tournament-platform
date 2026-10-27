/**
 * The community "Standard Ruleset" card.
 *
 * RizzOtto's Arena Mod sets the lobby, enforces the bans and (Land Battle, Conquest, Siege) the Fruit
 * Rules in its arena modes, so the card shows only what players must watch themselves: hosting in the
 * arena mode with the mod, and the ruleset's conduct (for Land Battle that includes its rules of play).
 * Settings and bans stay in the data, admin-editable via Admin → Settings (AdminConfig key
 * `standard_ruleset`, served by GET /api/meta/standard-ruleset), and `banned_factions` still drives Open
 * Play's faction restrictions; they just aren't a player duty on the card any more.
 *
 * The card fetches the live values and falls back to STANDARD_RULESET while loading or if nothing is
 * configured. Pass an explicit `ruleset` to render given values without fetching (the admin editor's
 * live preview). Host customisations still go into the "Custom Rules" / "Custom Restrictions" fields.
 *
 * The card is the tournament view: it lists `conduct` and then `tournament_conduct` (round limit,
 * disqualification). Open Play shows `conduct` only, in its code of conduct (OpenPlayConduct).
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getStandardRuleset, type BattleType, type StandardRuleset } from '@/lib/api.js';
import { BATTLE_TYPE_LABELS } from '@rizzotto/types';
import { battleTypeIconSrc } from '@/lib/battleTypeIcons';

const BATTLE_TYPE_LABEL: Record<string, string> = BATTLE_TYPE_LABELS;

/** Battle types whose arena mode enforces the Fruit Rules v10 (army composition limits). */
const FRUIT_RULES_TYPES = new Set<string>(['LAND_BATTLE', 'CONQUEST', 'SIEGE']);

/** The one rule the mod can't enforce for the players: that the host picks an arena mode. */
export const ARENA_MODE_DUTY =
  "Host the game in the arena mode (the aubergine button), with only RizzOtto's Arena Mod enabled.";

export const STANDARD_RULESET: StandardRuleset = {
  settings: ['Default Funds', 'Ultra Unit Scale', '1500 Tickets', 'Unit Caps On'],
  banned_factions: ['undead_legions'],
  banned: ['Masque of Slaanesh', 'Dreadmaw'],
  banned_abilities: [],
  conduct: ['10 minutes to ready up', 'Exploiting bugs or glitches is considered cheating.'],
  tournament_conduct: ['Cheating results in disqualification.', '40 minute round limit'],
};

const typeLabel = (bt: string) => BATTLE_TYPE_LABEL[bt] ?? bt;

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What the mod enforces for these battle types, as the middle of "RizzOtto's Arena Mod enforces …". */
export function modEnforces(battleTypes: string[]): string {
  const fruit = battleTypes.filter((bt) => FRUIT_RULES_TYPES.has(bt));
  if (fruit.length === 0) return 'the lobby settings and the bans in the arena modes';
  if (fruit.length === battleTypes.length) return 'the lobby settings, the bans and the Fruit Rules in the arena modes';
  return `the lobby settings and the bans in the arena modes, plus the Fruit Rules in ${joinNames(fruit.map(typeLabel))}`;
}

/**
 * Splits one list per battle type (conduct, settings) into what all of them share (in the first list's
 * order) and what each one adds. Types that add nothing are left out of `extra`.
 */
export function splitShared<T extends string>(
  lists: { battleType: T; items: string[] }[],
): { shared: string[]; extra: { battleType: T; items: string[] }[] } {
  const shared = (lists[0]?.items ?? []).filter((c) => lists.every((r) => r.items.includes(c)));
  const extra = lists
    .map((r) => ({ battleType: r.battleType, items: r.items.filter((c) => !shared.includes(c)) }))
    .filter((r) => r.items.length > 0);
  return { shared, extra };
}

/**
 * The live Standard Rulesets of several battle types (same query keys as the card, so they share the
 * cache). `rulesets` stays empty until every type has answered, so nothing regroups when the last one
 * arrives; a type whose fetch fails falls back to STANDARD_RULESET.
 */
export function useStandardRulesets(
  battleTypes: readonly BattleType[],
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO',
): { battleType: BattleType; ruleset: StandardRuleset }[] {
  const results = useQueries({
    queries: battleTypes.map((bt) => ({
      queryKey: ['standard-ruleset', bt, competitorFormat ?? 'ONE_V_ONE'],
      queryFn: () => getStandardRuleset(bt, competitorFormat),
      staleTime: 5 * 60 * 1000,
    })),
  });
  if (!results.every((r) => r.data !== undefined || r.isError)) return [];
  return battleTypes.map((bt, i) => ({ battleType: bt, ruleset: results[i]?.data ?? STANDARD_RULESET }));
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 sm:w-40">
      {children}
    </span>
  );
}

export function ModNote({ battleTypes }: { battleTypes: string[] }) {
  return (
    <span className="text-stone-400">
      RizzOtto&apos;s Arena Mod enforces {modEnforces(battleTypes)}, so you don&apos;t need to check them yourself.{' '}
      <Link to="/how-to-play" hash="mod" className="text-rizzotto-gold-400 underline">
        How to Play
      </Link>
    </span>
  );
}

export function StandardRulesetCard({
  compact = false,
  ruleset,
  battleType,
  competitorFormat,
}: {
  compact?: boolean;
  ruleset?: StandardRuleset;
  /** Show the ruleset for this combo (defaults to Domination / 1v1 when omitted). */
  battleType?: BattleType;
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO';
}) {
  // Skip the fetch when explicit values are supplied (editor preview).
  const { data } = useQuery({
    queryKey: ['standard-ruleset', battleType ?? 'DOMINATION', competitorFormat ?? 'ONE_V_ONE'],
    queryFn: () => getStandardRuleset(battleType, competitorFormat),
    staleTime: 5 * 60 * 1000,
    enabled: !ruleset,
  });
  const rs = ruleset ?? data ?? STANDARD_RULESET;
  const icon = battleTypeIconSrc(battleType);
  const title = battleType ? `Standard ${typeLabel(battleType)} Ruleset` : 'Standard Ruleset';
  const duties = [ARENA_MODE_DUTY, ...rs.conduct, ...(rs.tournament_conduct ?? [])];

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-stone-800 bg-stone-900/50 text-sm leading-relaxed ${
        compact ? 'p-3' : 'p-6'
      }`}
    >
      {/* Battle-type watermark at a fixed, centered size (not stretched to the card) so it
          reads at the same scale as on the tournament tiles rather than filling the larger
          rules tile. opacity matches the tournament watermark (0.12). */}
      {icon && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
          <img src={icon} alt="" className="h-48 w-48 object-contain opacity-[0.12]" />
        </div>
      )}
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          {icon ? (
            <img src={icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
          ) : (
            <span className="text-rizzotto-gold-400">⚔️</span>
          )}
          <span className="font-display font-semibold text-rizzotto-gold-500">{title}</span>
        </div>
        <div className="space-y-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <Label>Your part</Label>
            <ul className="list-disc space-y-0.5 pl-5 text-stone-300">
              {duties.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <Label>Set by the mod</Label>
            <ModNote battleTypes={[battleType ?? 'DOMINATION']} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One block per battle type: its icon and name, then its items. A single item or `inline` items (short
 * ones such as lobby settings) sit on the same line as the name; a longer list goes below the name at
 * full width, so a narrow name column doesn't leave a tall empty gap next to it.
 */
export function PerBattleType({
  extra,
  inline = false,
}: {
  extra: { battleType: BattleType; items: string[] }[];
  inline?: boolean;
}) {
  return (
    <div className="space-y-2">
      {extra.map(({ battleType, items }) => {
        const icon = battleTypeIconSrc(battleType);
        const oneLine = inline || items.length === 1;
        return (
          <div key={battleType} className={oneLine ? 'flex flex-col gap-1 sm:flex-row sm:gap-3' : 'space-y-1'}>
            <span
              className={`flex shrink-0 items-center gap-1.5 self-start font-medium text-rizzotto-gold-400 ${oneLine ? 'sm:w-32' : ''}`}
            >
              {icon && <img src={icon} alt="" className="h-4 w-4 object-contain" />}
              {typeLabel(battleType)}
            </span>
            {oneLine ? (
              <span className="text-stone-300">{items.join(', ')}</span>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-stone-300">
                {items.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

