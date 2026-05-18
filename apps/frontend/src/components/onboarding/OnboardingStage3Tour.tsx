import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function getStops(t: ReturnType<typeof useTranslation>['t']): TourStop[] {
  return [
    {
      id: 'roll',
      selector: '[data-onboarding-target="leaderboard-nav"]',
      title: t('onboarding.tour.stops.roll_of_honour.title'),
      body: t('onboarding.tour.stops.roll_of_honour.body'),
    },
    {
      id: 'factions',
      selector: '[data-onboarding-target="factions-nav"]',
      title: t('onboarding.tour.stops.factions.title'),
      body: t('onboarding.tour.stops.factions.body'),
    },
    {
      id: 'meta',
      selector: '[data-onboarding-target="meta-nav"]',
      title: t('onboarding.tour.stops.meta.title'),
      body: t('onboarding.tour.stops.meta.body'),
    },
    {
      id: 'sigil',
      selector: '[data-onboarding-target="avatar"]',
      title: t('onboarding.tour.stops.sigil.title'),
      body: t('onboarding.tour.stops.sigil.body'),
    },
  ];
}

export function OnboardingStage3Tour({ onAdvance }: OnboardingStage3TourProps) {
  const { t } = useTranslation('common');
  const [stopIndex, setStopIndex] = useState(0);
  const STOPS = getStops(t);
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
        {t('onboarding.tour.btn_back')}
      </Button>
      <div
        className="flex items-center gap-1.5"
        aria-label={t('onboarding.tour.dot_aria', { current: stopIndex + 1, total: STOPS.length })}
      >
        {STOPS.map((s, i) => (
          <span
            key={s.id}
            className={
              i === stopIndex
                ? 'h-1.5 w-4 rounded-sm bg-rizzotto-gold-400'
                : i < stopIndex
                  ? 'h-1.5 w-1.5 rounded-full bg-rizzotto-gold-500/60'
                  : 'h-1.5 w-1.5 rounded-full bg-rizzotto-iron-600'
            }
          />
        ))}
      </div>
      <Button
        variant="forge"
        size="sm"
        onClick={() => (isLast ? onAdvance() : setStopIndex((i) => i + 1))}
      >
        {isLast ? t('onboarding.tour.btn_finish') : t('onboarding.tour.btn_next')}
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
