import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RIZZOTTOVERSE_INVITE, useArenaMod } from '@/lib/arenaMod';

interface OnboardingStageSetupProps {
  onAdvance: () => void;
}

/**
 * Onboarding step "Discord + mod": join the RizzOttoverse (notifications only reach players who share a
 * server with the bot) and install RizzOtto's Arena Mod, with a link to How to Play. Hints only, no gate:
 * Continue works whether or not the player did either.
 */
export function OnboardingStageSetup({ onAdvance }: OnboardingStageSetupProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const mod = useArenaMod();

  const card = 'rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-5 text-left';
  const linkButton =
    'inline-block rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300';

  return (
    <div data-testid="onboarding-stage-setup" className="w-full max-w-2xl">
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0.24 } : { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
        className="space-y-5 text-center"
      >
        <h2 className="font-headline text-rizzotto-stone-100" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
          {t('onboarding.setup.title')}
        </h2>
        <p className="font-sans text-sm leading-relaxed text-rizzotto-stone-300">{t('onboarding.setup.body')}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className={card}>
            <h3 className="font-display text-base text-rizzotto-gold-400">{t('onboarding.setup.discord_title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-rizzotto-stone-300">{t('onboarding.setup.discord_body')}</p>
            <a href={RIZZOTTOVERSE_INVITE} target="_blank" rel="noopener noreferrer" className={`mt-4 ${linkButton}`}>
              {t('onboarding.setup.discord_cta')} ↗
            </a>
          </div>
          <div className={card}>
            <h3 className="font-display text-base text-rizzotto-gold-400">{t('onboarding.setup.mod_title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-rizzotto-stone-300">{t('onboarding.setup.mod_body')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={mod.url} target="_blank" rel="noopener noreferrer" className={linkButton}>
                {t('onboarding.setup.mod_cta')} ↗
              </a>
              <Link to="/how-to-play" target="_blank" className={linkButton}>
                {t('onboarding.setup.guide_cta')}
              </Link>
            </div>
          </div>
        </div>

        <Button variant="forge" size="md" onClick={onAdvance}>
          {t('onboarding.setup.continue')}
        </Button>
      </motion.div>
    </div>
  );
}
