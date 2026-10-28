/**
 * Open Play's rules and code of conduct, as two boxes. Rules: what the mod enforces and what each selected
 * battle type adds on top (the `conduct` lines not every type shares, e.g. Land Battle's attacking rules).
 * Code of conduct: what players watch themselves (hosting in the arena mode with the mod, the `conduct`
 * every type shares; tournament-only conduct such as the round limit is left out), why strikes exist and,
 * folded in, what gets a strike, what a strike does and cancelling. The strike numbers come from
 * OPEN_PLAY_CONDUCT in @rizzotto/types, the same values the backend enforces (lib/queue-penalty.ts), so
 * the text can't drift from the code. How to Play shows the same texts through the exported helpers.
 */
import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { BATTLE_TYPES, OPEN_PLAY_CONDUCT, openPlayCooldownHours } from '@rizzotto/types';
import type { BattleType } from '@/lib/api.js';
import { cn } from '@/lib/utils';
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

/**
 * Why strikes exist: joining the queue pings every player who marked himself available (the matchmaking
 * DM wave), and a matched opponent waits for the pick; leaving right away or not picking wastes their time.
 */
export function strikeWhy(): string {
  return (
    "Open Play runs on other players' time. When you join the queue, everyone who marked himself available " +
    "gets a DM that someone wants a game, and once you're matched, your opponent waits for your pick. If you " +
    "leave right after joining or don't pick, they turned up for nothing. Strikes keep that rare: the first one " +
    `is only a warning, and one is taken off for every ${OPEN_PLAY_CONDUCT.decayDays} days without a new one, so ` +
    'an occasional slip costs you nothing. They only add up for players who keep doing it.'
  );
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

const box = 'rounded-md border border-stone-800 bg-stone-900/50 p-4 text-sm leading-relaxed';

/**
 * The `conduct` of every battle type, split into what all of them share (conduct for every game) and what
 * each type adds (its own rules). Split over all types, like How to Play, so a type's own rules stay
 * apart even when it's the only one selected.
 */
function useConductSplit(competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO') {
  const rulesets = useStandardRulesets(BATTLE_TYPES, competitorFormat);
  return splitShared(rulesets.map((r) => ({ battleType: r.battleType, items: r.ruleset.conduct })));
}

/** The rules box on Open Play: what the mod enforces, then the selected types' own rules. */
export function OpenPlayRules({
  battleTypes,
  competitorFormat,
}: {
  battleTypes: BattleType[];
  competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO';
}) {
  const { extra } = useConductSplit(competitorFormat);
  const selected = battleTypes.flatMap((bt) => extra.filter((e) => e.battleType === bt));

  return (
    <div className={cn(box, 'space-y-3')}>
      <div>
        <Heading>Set by the mod</Heading>
        <ModNote battleTypes={battleTypes} />
      </div>
      {selected.length > 0 && (
        <div>
          <Heading>Per battle type</Heading>
          <PerBattleType extra={selected} />
        </div>
      )}
    </div>
  );
}

/**
 * The code of conduct box on Open Play: your part and why strikes exist; the strike details and
 * cancelling are folded in (they're on How to Play in full too).
 */
export function OpenPlayConduct({ competitorFormat }: { competitorFormat?: 'ONE_V_ONE' | 'TWO_V_TWO' }) {
  const { shared } = useConductSplit(competitorFormat);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={box}>
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
        <div>
          <Heading>Your part</Heading>
          <List items={[ARENA_MODE_DUTY, ...shared, OPEN_PLAY_CHEATING]} />
        </div>
        <div>
          <Heading>What not to do</Heading>
          <p className="text-stone-300">{strikeWhy()}</p>
        </div>
      </div>
      <div className="mt-3 border-t border-stone-800 pt-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80 transition-colors hover:text-rizzotto-gold-400"
        >
          <ChevronRight aria-hidden="true" className={cn('size-4 transition-transform duration-200', open && 'rotate-90')} />
          How strikes work
        </button>
        {open && (
          <div id={panelId} className="mt-3 grid gap-x-8 gap-y-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Heading>What gets you a strike</Heading>
                <List items={strikeOffences()} />
              </div>
              <div>
                <Heading>Cancelling</Heading>
                <p className="text-stone-300">{OPEN_PLAY_CANCELLING}</p>
              </div>
            </div>
            <div>
              <Heading>What a strike does</Heading>
              <List items={strikeLadder()} />
              <p className="mt-1 text-stone-400">{strikeDecay()}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
