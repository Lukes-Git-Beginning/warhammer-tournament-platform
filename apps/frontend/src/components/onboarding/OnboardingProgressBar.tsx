import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { ONBOARDING_STAGES, type OnboardingStage } from '@/lib/onboarding';

interface OnboardingProgressBarProps {
  current: OnboardingStage;
}

export function OnboardingProgressBar({ current }: OnboardingProgressBarProps) {
  return (
    <div className="pointer-events-none mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pt-6 sm:px-6">
      {ONBOARDING_STAGES.map((stage) => {
        const done = stage.index < current;
        const active = stage.index === current;
        return (
          <div
            key={stage.id}
            className="flex-1"
            aria-label={`Stage ${stage.index + 1} — ${stage.title}`}
          >
            <div
              className={cn(
                'h-[3px] w-full overflow-hidden rounded-sm bg-karaz-iron-800',
              )}
            >
              <motion.div
                className={cn(
                  'h-full origin-left',
                  done
                    ? 'bg-karaz-gold-500'
                    : active
                      ? 'bg-gradient-to-r from-karaz-gold-500 via-karaz-gold-400 to-karaz-forge-500'
                      : 'bg-transparent',
                )}
                initial={{ scaleX: done ? 1 : 0 }}
                animate={{ scaleX: done ? 1 : active ? 1 : 0 }}
                transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
