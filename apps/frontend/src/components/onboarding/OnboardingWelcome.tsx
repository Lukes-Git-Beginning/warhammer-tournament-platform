import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { RizzottoSigil } from '@/components/icons/RizzottoSigil';
import { Button } from '@/components/ui/button';
import { useAuthQuery } from '@/lib/auth';
import { RIZZOTTOVERSE_INVITE, useArenaMod } from '@/lib/arenaMod';

/**
 * The whole onboarding (Alex, 2026-10-27): a welcome with the two things every player needs, the
 * RizzOttoverse Discord server (match notifications come as bot DMs) and RizzOtto's Arena Mod, then done.
 * Hints only, no gate. Logging in usually adds the player to the server already (guilds.join), so the
 * Discord card says so when the bot saw him there.
 */
export function OnboardingWelcome({ onDone, isDone }: { onDone: () => void; isDone: boolean }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const mod = useArenaMod();
  const { data: user } = useAuthQuery();
  const onServer = user?.discord_member === true;

  const fadeIn = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? { duration: 0.24 } : { duration: 0.5, ease: [0.4, 0, 0.2, 1] as const, delay },
  });
  const card = 'rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-5 text-left';
  const linkButton =
    'inline-block rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300';

  return (
    <div data-testid="onboarding-welcome" className="flex w-full max-w-2xl flex-col items-center text-center">
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0.32 } : { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 }}
        className="text-rizzotto-gold-400 drop-shadow-[0_0_36px_rgba(212,160,23,0.32)]"
      >
        <RizzottoSigil className="size-24 sm:size-28" drawable={!reduced} strokeWidth={1.5} />
      </motion.div>

      <motion.h1
        {...fadeIn(0.5)}
        className="mt-8 font-headline text-rizzotto-stone-100"
        style={{ fontSize: 'clamp(1.75rem, 4.5vw, 3rem)' }}
      >
        {t('onboarding.welcome.title')}
      </motion.h1>
      <motion.p {...fadeIn(0.7)} className="mt-4 max-w-xl font-sans text-base leading-relaxed text-rizzotto-stone-300">
        {t('onboarding.welcome.body')}
      </motion.p>

      <motion.div {...fadeIn(0.9)} className="mt-8 grid w-full gap-4 sm:grid-cols-2">
        <div className={card}>
          <h2 className="font-display text-base text-rizzotto-gold-400">{t('onboarding.welcome.discord_title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-rizzotto-stone-300">
            {t(onServer ? 'onboarding.welcome.discord_body_member' : 'onboarding.welcome.discord_body')}
          </p>
          <a href={RIZZOTTOVERSE_INVITE} target="_blank" rel="noopener noreferrer" className={`mt-4 ${linkButton}`}>
            {t(onServer ? 'onboarding.welcome.discord_cta_member' : 'onboarding.welcome.discord_cta')} ↗
          </a>
        </div>
        <div className={card}>
          <h2 className="font-display text-base text-rizzotto-gold-400">{t('onboarding.welcome.mod_title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-rizzotto-stone-300">{t('onboarding.welcome.mod_body')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={mod.url} target="_blank" rel="noopener noreferrer" className={linkButton}>
              {t('onboarding.welcome.mod_cta')} ↗
            </a>
            <Link to="/how-to-play" target="_blank" className={linkButton}>
              {t('onboarding.welcome.guide_cta')}
            </Link>
          </div>
        </div>
      </motion.div>

      <motion.div {...fadeIn(1.1)} className="mt-8">
        <Button variant="forge" size="lg" onClick={onDone} disabled={isDone}>
          {t(isDone ? 'onboarding.welcome.cta_loading' : 'onboarding.welcome.cta')}
        </Button>
      </motion.div>
    </div>
  );
}
