import { useEffect } from 'react';
import { useOnboarding } from '@/lib/onboarding';
import { OnboardingWelcome } from './OnboardingWelcome';

/**
 * The welcome page a player sees once, after his first login: full screen over the site until he
 * clicks through (which sets `onboarded_at`).
 */
export function OnboardingOverlay() {
  const { isOpen, complete, isCompleting } = useOnboarding();

  // Lock body scroll while the page is open.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div data-testid="onboarding-overlay" className="fixed inset-0 z-50 overflow-y-auto bg-rizzotto-iron-950/97 backdrop-blur-sm">
      <div className="flex min-h-screen w-full items-center justify-center px-4 py-16 sm:py-20">
        <OnboardingWelcome onDone={() => void complete()} isDone={isCompleting} />
      </div>
    </div>
  );
}
