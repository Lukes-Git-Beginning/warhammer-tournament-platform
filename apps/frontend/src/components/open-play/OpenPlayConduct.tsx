/**
 * Open Play's code of conduct: what players watch themselves (hosting in the arena mode with the mod,
 * the `conduct` of the selected battle types' Standard Rulesets; tournament-only conduct such as the
 * round limit is left out), what gets a strike and what a strike does, cancelling, and what the mod
 * takes care of. The strike numbers come from OPEN_PLAY_CONDUCT in @rizzotto/types, the same values
 * the backend enforces (lib/queue-penalty.ts), so the text can't drift from the code. How to Play
 * shows the same texts through the exported helpers.
 */
import type { ReactNode } from 'react';
import { OPEN_PLAY_CONDUCT, openPlayCooldownHours } from '@rizzotto/types';
import type { BattleType } from '@/lib/api.js';
import {
  ARENA_MODE_DUTY,
  ModNote,
  PerBattleType,
  splitShared,
  useStandardRulesets,
} from '@/components/tournament/StandardRulesetCard';

/** Open Play's consequence for cheating (tournaments disqualify instead). */
export const OPEN_PLAY_CHEATING = 'Cheating voids the result, and an admin can ban you from Open Play.';

/** Cancelling isn't penalised for now (Alex, 2026-10-27), but it's discouraged. */
export const OPEN_PLAY_CANCELLING =
  "Something came up? Cancel the match on its page. That isn't penalised, but please don't make a habit of it: your opponent queued for this game too.";

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "1 hour", "24 hours", "7 days". */
export function cooldownLabel(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour');
}

/** What gets a strike. */
export function strikeOffences(): string[] {
  const c = OPEN_PLAY_CONDUCT;
  return [
    `Leaving the queue right after joining: ${c.shortStintsPerStrike} times within ${c.shortStintWindowHours} hours, each within ${c.shortStintMinutes} minutes of joining, is one strike.`,
    `Not picking your faction in time: ${c.pickDeadlineMinutes} minutes after your opponent picked (or after the match started, if neither of you has), the match is cancelled and whoever hasn't picked gets a strike.`,
  ];
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/** What a strike does, one line per level. */
export function strikeLadder(): string[] {
  const ladder = OPEN_PLAY_CONDUCT.cooldownHoursByLevel;
  return ladder.map((_, i) => {
    const hours = openPlayCooldownHours(i + 1);
    const what =
      hours === 0
        ? 'a warning by DM'
        : hours === null
          ? 'no queueing until an admin lifts it'
          : `no queueing for ${cooldownLabel(hours)}`;
    const which = i === ladder.length - 1 ? `${ORDINALS[i]} and every further strike` : `${ORDINALS[i]} strike`;
    return `${which}: ${what}.`;
  });
}

/** How strikes fade. */
export function strikeDecay(): string {
  return `Every ${OPEN_PLAY_CONDUCT.decayDays} days without a new strike, one strike is taken off.`;
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-stone-300">
      {items.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  );
}

/**
 * The box on Open Play: the rules of the selected battle types (shared ones once, then what each type
 * adds) next to the strikes.
 */
export function OpenPlayConduct({
  battleTypes,
  competitorFormat,
}: {
  battleTypes: BattleType[];
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO';
}) {
  const rulesets = useStandardRulesets(battleTypes, competitorFormat);
  const { shared, extra } = splitShared(rulesets.map((r) => ({ battleType: r.battleType, items: r.ruleset.conduct })));

  return (
    <div className="grid gap-x-8 gap-y-3 rounded-md border border-stone-800 bg-stone-900/50 p-4 text-sm leading-relaxed lg:grid-cols-2">
      <div className="space-y-3">
        <div>
          <Heading>Your part</Heading>
          <List items={[ARENA_MODE_DUTY, ...shared, OPEN_PLAY_CHEATING]} />
        </div>
        {extra.length > 0 && (
          <div>
            <Heading>Per battle type</Heading>
            <PerBattleType extra={extra} />
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <Heading>What gets you a strike</Heading>
          <List items={strikeOffences()} />
        </div>
        <div>
          <Heading>What a strike does</Heading>
          <List items={strikeLadder()} />
          <p className="mt-1 text-stone-400">{strikeDecay()}</p>
        </div>
        <div>
          <Heading>Cancelling</Heading>
          <p className="text-stone-300">{OPEN_PLAY_CANCELLING}</p>
        </div>
        <div>
          <Heading>Set by the mod</Heading>
          <ModNote battleTypes={battleTypes} />
        </div>
      </div>
    </div>
  );
}
