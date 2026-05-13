import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { KarazSigil } from '@/components/icons/KarazSigil';
import { Button } from '@/components/ui/button';

interface OnboardingStage5DoneProps {
  onComplete: () => void;
  pending: boolean;
}

export function OnboardingStage5Done({ onComplete, pending }: OnboardingStage5DoneProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  return (
    <div
      className="relative flex w-full max-w-2xl flex-col items-center text-center"
      data-testid="onboarding-stage-4"
    >
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          reduced
            ? { duration: 0.32 }
            : { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 }
        }
        className="text-karaz-gold-400 drop-shadow-[0_0_36px_rgba(212,160,23,0.4)]"
      >
        <KarazSigil
          className="size-32 sm:size-40 animate-karaz-shimmer"
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
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 1.5 }
        }
        className="mt-10 font-headline text-karaz-stone-100"
        style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
      >
        {t('onboarding.stage5.title')}
      </motion.h1>

      <motion.p
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 1.8 }
        }
        className="mt-6 max-w-xl font-sans text-base leading-relaxed text-karaz-stone-300"
      >
        {t('onboarding.stage5.body')}
      </motion.p>

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: reduced ? 0 : 2.0 }
        }
        className="mt-10"
      >
        <Button variant="forge" size="lg" onClick={onComplete} disabled={pending}>
          {pending ? t('onboarding.stage5.cta_loading') : t('onboarding.stage5.cta')}
        </Button>
      </motion.div>
    </div>
  );
}
