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
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getStandardRuleset, type BattleType, type StandardRuleset } from '@/lib/api.js';
import { BATTLE_TYPE_LABELS } from '@rizzotto/types';
import { battleTypeIconSrc } from '@/lib/battleTypeIcons';

const BATTLE_TYPE_LABEL: Record<string, string> = BATTLE_TYPE_LABELS;

/** Battle types whose arena mode enforces the Fruit Rules v10 (army composition limits). */
const FRUIT_RULES_TYPES = new Set<string>(['LAND_BATTLE', 'CONQUEST', 'SIEGE']);

/** The one rule the mod can't enforce for the players: that the host picks an arena mode. */
const ARENA_MODE_DUTY = "Host the game in the arena mode (the aubergine button), with only RizzOtto's Arena Mod enabled.";

export const STANDARD_RULESET: StandardRuleset = {
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 sm:w-40">
      {children}
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
  const title = battleType ? `Standard ${BATTLE_TYPE_LABEL[battleType] ?? battleType} Ruleset` : 'Standard Ruleset';
  const enforced = FRUIT_RULES_TYPES.has(battleType ?? '')
    ? 'the lobby settings, the bans and the Fruit Rules'
    : 'the lobby settings and the bans';
  const duties = [ARENA_MODE_DUTY, ...rs.conduct];

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
            <span className="text-stone-400">
              RizzOtto&apos;s Arena Mod enforces {enforced} in the arena modes, so you don&apos;t need to check
              them yourself.{' '}
              <Link to="/how-to-play" className="text-rizzotto-gold-400 underline">
                How to Play
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
