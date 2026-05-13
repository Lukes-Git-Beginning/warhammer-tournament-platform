import type { DraftTurn } from '@tww3/types';

interface DraftSequenceTimelineProps {
  turns: DraftTurn[];
  current?: number;
}

const ACTOR_LABEL: Record<string, string> = {
  host: 'H',
  guest: 'G',
  admin: 'A',
};

const ACTION_LABEL: Record<string, string> = {
  pick: 'Pick',
  ban: 'Ban',
  snipe: 'Snipe',
  steal: 'Steal',
  reveal_picks: 'Rev.Picks',
  reveal_bans: 'Rev.Bans',
  reveal_all: 'Rev.All',
};

const ACTOR_COLOR: Record<string, string> = {
  host: 'bg-blue-700 text-blue-100',
  guest: 'bg-red-800 text-red-100',
  admin: 'bg-stone-600 text-stone-200',
};

export function DraftSequenceTimeline({ turns, current }: DraftSequenceTimelineProps) {
  if (turns.length === 0) {
    return (
      <div className="rounded-md border border-stone-800 bg-stone-900/40 p-4 text-center text-stone-500 text-sm">
        Keine Züge definiert
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-center gap-1 min-w-max">
        {turns.map((turn, i) => {
          const isCurrent = current !== undefined && i === current;
          const isPast = current !== undefined && i < current;
          return (
          <div key={i} className="flex items-center gap-1">
            <div
              className={`flex flex-col items-center gap-1 rounded-md border p-2 min-w-[72px] transition-colors ${
                isCurrent
                  ? 'border-warhammer-gold bg-warhammer-gold/10 ring-2 ring-warhammer-gold/40'
                  : isPast
                  ? 'border-stone-800 bg-stone-950 opacity-50'
                  : 'border-stone-700 bg-stone-900'
              }`}
            >
              <div className="text-xs text-stone-500">#{i + 1}</div>
              <div
                className={`text-xs font-bold px-1.5 py-0.5 rounded ${ACTOR_COLOR[turn.actor] ?? 'bg-stone-600 text-stone-200'}`}
              >
                {ACTOR_LABEL[turn.actor] ?? turn.actor}
              </div>
              <div className="text-xs text-stone-300 font-medium">
                {ACTION_LABEL[turn.action] ?? turn.action}
              </div>
              <div className="flex flex-wrap gap-0.5 justify-center">
                {turn.is_hidden && (
                  <span className="text-[10px] bg-stone-700 text-stone-300 px-1 rounded">Hidden</span>
                )}
                {turn.is_parallel && (
                  <span className="text-[10px] bg-stone-700 text-stone-300 px-1 rounded">Parallel</span>
                )}
                {turn.as_opponent && (
                  <span className="text-[10px] bg-stone-700 text-stone-300 px-1 rounded">AsOpp</span>
                )}
              </div>
            </div>
            {i < turns.length - 1 && (
              <span className="text-stone-600 text-sm">›</span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
