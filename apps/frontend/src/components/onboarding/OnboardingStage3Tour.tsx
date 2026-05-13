import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { OnboardingSpotlight } from './OnboardingSpotlight';

interface OnboardingStage3TourProps {
  onAdvance: () => void;
}

interface TourStop {
  id: string;
  selector: string;
  title: string;
  body: string;
}

const STOPS: TourStop[] = [
  {
    id: 'roll',
    selector: '[data-onboarding-target="leaderboard-nav"]',
    title: 'The Roll of Honour',
    body: "Every Marshal's standing — etched in stone. Your name will join the roll.",
  },
  {
    id: 'factions',
    selector: '[data-onboarding-target="factions-nav"]',
    title: 'The Factions',
    body: 'Twenty-four banners ride the Old World. Know each before the muster is called.',
  },
  {
    id: 'meta',
    selector: '[data-onboarding-target="meta-nav"]',
    title: 'The Heatmap',
    body: 'Matchup balance, season by season. Read the field before you ride it.',
  },
  {
    id: 'sigil',
    selector: '[data-onboarding-target="avatar"]',
    title: 'Your Sigil',
    body: 'Your sigil binds your army lists and your results. Keep it sharp.',
  },
];

export function OnboardingStage3Tour({ onAdvance }: OnboardingStage3TourProps) {
  const [stopIndex, setStopIndex] = useState(0);
  const stop = STOPS[stopIndex] ?? STOPS[0]!;
  const isLast = stopIndex === STOPS.length - 1;

  const controls = (
    <>
      <Button
        variant="etched"
        size="sm"
        onClick={() => setStopIndex((i) => Math.max(0, i - 1))}
        disabled={stopIndex === 0}
      >
        ← Retreat
      </Button>
      <div className="flex items-center gap-1.5" aria-label={`Stop ${stopIndex + 1} of ${STOPS.length}`}>
        {STOPS.map((s, i) => (
          <span
            key={s.id}
            className={
              i === stopIndex
                ? 'h-1.5 w-4 rounded-sm bg-karaz-gold-400'
                : i < stopIndex
                  ? 'h-1.5 w-1.5 rounded-full bg-karaz-gold-500/60'
                  : 'h-1.5 w-1.5 rounded-full bg-karaz-iron-600'
            }
          />
        ))}
      </div>
      <Button
        variant="forge"
        size="sm"
        onClick={() => (isLast ? onAdvance() : setStopIndex((i) => i + 1))}
      >
        {isLast ? 'Onward →' : 'Advance →'}
      </Button>
    </>
  );

  return (
    <div className="pointer-events-none" data-testid="onboarding-stage-2">
      <OnboardingSpotlight
        stopKey={stop.id}
        targetSelector={stop.selector}
        title={stop.title}
        body={stop.body}
        controls={controls}
      />
    </div>
  );
}
