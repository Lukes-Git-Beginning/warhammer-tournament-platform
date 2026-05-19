import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { RizzottoSigil } from '@/components/icons/RizzottoSigil';
import { Button } from '@/components/ui/button';

interface OnboardingStage1WelcomeProps {
  onAdvance: () => void;
}

export function OnboardingStage1Welcome({ onAdvance }: OnboardingStage1WelcomeProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  return (
    <div
      className="relative flex w-full max-w-2xl flex-col items-center text-center"
      data-testid="onboarding-stage-0"
    >
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          reduced
            ? { duration: 0.32 }
            : { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }
        }
        className="text-rizzotto-gold-400 drop-shadow-[0_0_36px_rgba(212,160,23,0.32)]"
      >
        <RizzottoSigil
          className="size-32 sm:size-40"
          drawable={!reduced}
          strokeWidth={1.5}
        />
      </motion.div>

      <motion.h1
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.32 }
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 1.6 }
        }
        className="mt-10 font-headline text-rizzotto-stone-100"
        style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
      >
        {t('onboarding.stage1.title')}
      </motion.h1>

      <motion.p
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 1.9 }
        }
        className="mt-6 max-w-xl font-sans text-base leading-relaxed text-rizzotto-stone-300"
      >
        {t('onboarding.stage1.body')}
      </motion.p>

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 2.3 }
        }
        className="mt-10"
      >
        <Button variant="forge" size="lg" onClick={onAdvance}>
          {t('onboarding.stage1.cta')}
        </Button>
      </motion.div>
    </div>
  );
}
