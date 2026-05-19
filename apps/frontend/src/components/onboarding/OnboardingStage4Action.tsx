import { useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { UserMe } from '@rizzotto/types';
import { Button } from '@/components/ui/button';

interface OnboardingStage4ActionProps {
  user: UserMe;
  onAdvance: () => void;
}

export function OnboardingStage4Action({ user, onAdvance }: OnboardingStage4ActionProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const navigate = useNavigate();

  function gotoProfileAndAdvance() {
    onAdvance();
    void navigate({ to: '/users/$id', params: { id: user.id } });
  }

  return (
    <div data-testid="onboarding-stage-3" className="w-full max-w-xl">
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }
        }
        className="w-full rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-8 shadow-rizzotto-banner text-center"
      >
        <h2 className="font-headline text-rizzotto-stone-100" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
          {t('onboarding.stage3.title')}
        </h2>
        <p className="mt-3 font-sans text-sm leading-relaxed text-rizzotto-stone-300">
          {t('onboarding.stage3.body')}
        </p>

        <div className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button variant="etched" size="md" onClick={onAdvance}>
            {t('onboarding.stage3.later')}
          </Button>
          <Button variant="forge" size="md" onClick={gotoProfileAndAdvance}>
            {t('onboarding.stage3.cta')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
