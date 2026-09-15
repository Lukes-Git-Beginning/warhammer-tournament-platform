import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayerClassification } from '@/lib/api.js';
import { Button } from '@/components/ui/button.js';
import { BANDS, bandIndex, winChance } from './skillBands.js';
import { SkillHistoryChart } from '@/components/users/SkillHistoryChart.js';

// Below this SE the data alone is confident enough to place a player without a questionnaire.
const CONFIDENT_SE = 1.0;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="mb-4 text-xs uppercase tracking-wider text-stone-500">Your Standing</p>
      {children}
    </div>
  );
}

export function PlayerLevelScale({
  userId,
  isOwnProfile,
  onCalibrate,
}: {
  userId: string;
  isOwnProfile: boolean;
  onCalibrate: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-classification', userId],
    queryFn: () => getPlayerClassification(userId),
    retry: false,
  });

  if (isLoading) {
    return (
      <Frame>
        <div className="h-8 animate-pulse rounded bg-stone-800" />
      </Frame>
    );
  }
  if (!data) return null;

  // With a questionnaire, show the blended estimate; otherwise the raw data
  // estimate (the default band-1 prior is not real signal to display).
  const displaySkill = data.hasQuestionnaire ? data.matchmakingSkill : data.generalSkill;
  const enoughSignal =
    data.hasQuestionnaire ||
    (data.generalSkill != null && data.generalSkillSe != null && data.generalSkillSe < CONFIDENT_SE);

  if (!enoughSignal || displaySkill == null) {
    return (
      <Frame>
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

  return (
    <Frame>
      <div className="mb-3 flex items-baseline justify-between">
        <span className={`font-display text-lg font-semibold ${BANDS[bi]!.text}`}>
          {BANDS[bi]!.name}
        </span>
        <span className="text-xs text-stone-500">{winPct}% vs. average player</span>
      </div>
      <SkillHistoryChart userId={userId} />
      {data.hasQuestionnaire && (
        <p className="mt-2 text-[11px] text-stone-500">
          The graph tracks your games only; your level above also blends in your questionnaire.
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
