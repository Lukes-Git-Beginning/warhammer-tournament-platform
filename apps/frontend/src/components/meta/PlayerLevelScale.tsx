import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayerClassification, type SkillScope } from '@/lib/api.js';
import { Button } from '@/components/ui/button.js';
import { BANDS, bandIndex, winChance } from './skillBands.js';
import { SkillHistoryChart } from '@/components/users/SkillHistoryChart.js';

// Below this SE the data alone is confident enough to place a player without a questionnaire.
const CONFIDENT_SE = 1.0;

const SCOPE_LABEL: Record<SkillScope, string> = {
  OVERALL: 'Overall',
  DOMINATION: 'Domination',
  CONQUEST: 'Conquest',
  SIEGE: 'Siege',
};

function Frame({ children, scope }: { children: ReactNode; scope: SkillScope }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="mb-4 text-xs uppercase tracking-wider text-stone-500">
        Your Standing{scope !== 'OVERALL' ? ` · ${SCOPE_LABEL[scope]}` : ''}
      </p>
      {children}
    </div>
  );
}

/** Own-profile hint for players who calibrated before the per-battle-type questionnaire. */
function PendingTypesBanner({ types, onCalibrate }: { types: string[]; onCalibrate: () => void }) {
  const names = types.map((t) => SCOPE_LABEL[t as SkillScope] ?? t);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 px-3 py-2">
      <p className="text-xs text-stone-300">
        Your level is now set per battle type. Answer a few {list} questions so we can place you there too.
      </p>
      <Button variant="etched" size="sm" onClick={onCalibrate}>
        Answer →
      </Button>
    </div>
  );
}

export function PlayerLevelScale({
  userId,
  isOwnProfile,
  onCalibrate,
  battleType = 'OVERALL',
}: {
  userId: string;
  isOwnProfile: boolean;
  onCalibrate: () => void;
  /** The scope the profile is viewing: OVERALL (game-weighted) or one battle type. */
  battleType?: SkillScope;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-classification', userId, battleType],
    queryFn: () => getPlayerClassification(userId, battleType),
    retry: false,
  });

  if (isLoading) {
    return (
      <Frame scope={battleType}>
        <div className="h-8 animate-pulse rounded bg-stone-800" />
      </Frame>
    );
  }
  if (!data) return null;

  const pending = isOwnProfile ? (data.pendingCalibrationTypes ?? []) : [];
  // Calibrated before this battle type had its own questions → unrated in it (no floor to show).
  const typePending = battleType !== 'OVERALL' && (data.pendingCalibrationTypes ?? []).includes(battleType);

  if (typePending) {
    const type = SCOPE_LABEL[battleType];
    return (
      <Frame scope={battleType}>
        {isOwnProfile ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-400">
              Your level is set per battle type. Answer a few {type} questions so we can place you in {type} too.
            </p>
            <Button variant="etched" size="sm" onClick={onCalibrate}>
              Answer a few questions →
            </Button>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Not placed in {type} yet.</p>
        )}
      </Frame>
    );
  }

  // With a questionnaire, show the blended estimate; otherwise the raw data
  // estimate (the default band-1 prior is not real signal to display).
  const displaySkill = data.hasQuestionnaire ? data.matchmakingSkill : data.generalSkill;
  const enoughSignal =
    data.hasQuestionnaire ||
    (data.generalSkill != null && data.generalSkillSe != null && data.generalSkillSe < CONFIDENT_SE);

  if (!enoughSignal || displaySkill == null) {
    return (
      <Frame scope={battleType}>
        {isOwnProfile ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-400">
              Hi! We don&apos;t have enough match data yet to gauge your level. Want to answer a
              few quick questions so we can give you the best experience in RizzOtto&apos;s Arena?
            </p>
            <Button variant="etched" size="sm" onClick={onCalibrate}>
              Answer a few questions →
            </Button>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Not enough data to place this player yet.</p>
        )}
      </Frame>
    );
  }

  const bi = bandIndex(displaySkill);
  const winPct = Math.round(winChance(displaySkill));
  const games = data.scopeGames ?? 0;

  return (
    <Frame scope={battleType}>
      {pending.length > 0 && <PendingTypesBanner types={pending} onCalibrate={onCalibrate} />}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className={`font-display text-lg font-semibold ${BANDS[bi]!.text}`}>{BANDS[bi]!.name}</span>
          {data.provisional && (
            <span
              className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400"
              title={
                battleType === 'OVERALL'
                  ? 'Fewer than 5 games — this level is still settling.'
                  : `Fewer than 5 ${SCOPE_LABEL[battleType]} games — this level still leans on your ${SCOPE_LABEL[battleType]} calibration answers.`
              }
            >
              Provisional · {games} {games === 1 ? 'game' : 'games'}
            </span>
          )}
        </span>
        <span className="text-xs text-stone-500">{winPct}% vs. average player</span>
      </div>
      <SkillHistoryChart userId={userId} battleType={battleType} />
      {data.hasQuestionnaire && (
        <p className="mt-2 text-[11px] text-stone-500">
          The chart shows your match results only. The level above also factors in your calibration questionnaire.
        </p>
      )}
      {isOwnProfile && !data.hasQuestionnaire && (
        <button
          onClick={onCalibrate}
          className="mt-3 text-xs text-rizzotto-gold-400 transition-colors hover:text-rizzotto-gold-300"
        >
          Refine your level with a few questions →
        </button>
      )}
    </Frame>
  );
}
