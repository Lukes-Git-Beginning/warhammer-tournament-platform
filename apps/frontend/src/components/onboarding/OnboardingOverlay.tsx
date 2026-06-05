import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useOnboarding } from '@/lib/onboarding';
import { cn } from '@/lib/utils';
import { OnboardingProgressBar } from './OnboardingProgressBar';
import { OnboardingStage1Welcome } from './OnboardingStage1Welcome';
import { OnboardingStage2Prefs } from './OnboardingStage2Prefs';
import { OnboardingStage3Tour } from './OnboardingStage3Tour';
import { OnboardingStage5Done } from './OnboardingStage5Done';

export function OnboardingOverlay() {
  const {
    isOpen,
    stage,
    user,
    advance,
    complete,
    isCompleting,
  } = useOnboarding();
  const reduced = useReducedMotion();

  // Lock body scroll while overlay is open (fullscreen stages only)
  const isTour = stage === 2;
  useEffect(() => {
    if (!isOpen || isTour) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen, isTour]);

  if (!isOpen || !user) return null;

  function handleEndTour() {
    void complete();
  }

  return (
    <div data-testid="onboarding-overlay">
      {/* Progress bar — always rendered, fixed top */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[58]">
        <OnboardingProgressBar current={stage} />
      </div>

      {/* Global End-tour link (not on final stage) */}
      {stage !== 4 && (
        <div className="fixed top-4 right-3 z-[59] sm:top-5 sm:right-6">
          <button
            type="button"
            onClick={handleEndTour}
            disabled={isCompleting}
            className={cn(
              'font-display text-[11px] uppercase tracking-[0.18em]',
              'text-rizzotto-stone-400 hover:text-rizzotto-gold-400',
              'transition-colors duration-base ease-burn',
              'disabled:opacity-50',
            )}
          >
            {isCompleting ? 'Sealing…' : 'End tour'}
          </button>
        </div>
      )}

      {/* Stage content */}
      {isTour ? (
        <OnboardingStage3Tour onAdvance={() => advance(4)} />
      ) : (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-rizzotto-iron-950/97 backdrop-blur-sm">
          <div className="flex min-h-screen w-full items-center justify-center px-4 py-16 sm:py-20">
            <AnimatePresence mode="wait">
              <motion.div
                key={stage}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={
                  reduced
                    ? { duration: 0.18 }
                    : { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }
                }
                className="flex w-full justify-center"
              >
                {stage === 0 && <OnboardingStage1Welcome onAdvance={() => advance(1)} />}
                {stage === 1 && (
                  <OnboardingStage2Prefs user={user} onAdvance={() => advance(2)} />
                )}
                {stage === 4 && (
                  <OnboardingStage5Done
                    onComplete={() => void complete()}
                    pending={isCompleting}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
