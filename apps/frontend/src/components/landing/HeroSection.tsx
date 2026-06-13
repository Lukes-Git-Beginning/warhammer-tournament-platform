import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { RizzottoWordmarkImage } from '@/components/icons/RizzottoWordmarkImage';
import { useAuthQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Picture } from '@/components/ui/picture';
import { ScrollCue } from './ScrollCue';

/**
 * Section 1 — Hero. Cinematic photo backdrop + animated wordmark reveal +
 * tagline + dual CTA.
 *
 * The wordmark fades in with a slight scale-up as the hero photo brightens.
 * Honors prefers-reduced-motion by cutting to final state with a single fade.
 */
export function HeroSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { data: user } = useAuthQuery();

  return (
    <section
      aria-label="Hero"
      className="relative isolate min-h-[100svh] w-full overflow-hidden"
    >
      {/* Hero photo (full-bleed background) */}
      <div aria-hidden="true" className="rizzotto-photo-frame absolute inset-0 -z-10">
        <Picture
          src="/img/hero-knight"
          alt=""
          width={1915}
          height={821}
          priority
          className="h-full w-full object-cover"
          objectPosition="70% 50%"
        />
      </div>

      {/* Stone vignette on top */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ boxShadow: 'var(--shadow-rizzotto-stone-vignette)' }}
      />

      {/* Content column */}
      <div className="relative z-10 mx-auto flex min-h-[88svh] max-w-[80rem] flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8 lg:py-20 xl:px-12">
        {/* Wordmark — generated raster asset (sigil + lettering combined) */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={
            reduced
              ? { duration: 0.32 }
              : { duration: 1.0, ease: [0.2, 0.8, 0.2, 1], delay: 0.3 }
          }
          className="drop-shadow-[0_0_48px_rgba(212,160,23,0.25)]"
        >
          <RizzottoWordmarkImage
            className="mx-auto w-[min(640px,90vw)]"
            loading="eager"
          />
        </motion.div>

        {/* Caption */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0.32 } : { duration: 0.8, ease: 'easeOut', delay: 0.7 }}
          className="mt-4 flex items-center gap-3"
        >
          <span className="h-px w-12 bg-rizzotto-gold-500/30" />
          <span className="font-display text-[11px] uppercase tracking-[0.3em] text-rizzotto-stone-400">
            Open Beta Tournament
          </span>
          <span className="h-px w-12 bg-rizzotto-gold-500/30" />
        </motion.div>

        {/* CTAs — sign-in button only shown to guests; leaderboard always visible */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.08, delayChildren: reduced ? 0 : 1.0 },
            },
          }}
          className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
        >
          {!user && (
            <motion.div
              variants={{
                hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
              }}
            >
              <Button asChild variant="forge" size="lg">
                <Link to="/login">{t('hero.cta_primary')}</Link>
              </Button>
            </motion.div>
          )}
          <motion.div
            variants={{
              hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
            }}
          >
            <Button asChild variant="iron" size="lg">
              <Link to="/leaderboard">{t('hero.cta_secondary')}</Link>
            </Button>
          </motion.div>
        </motion.div>

        {/* Scroll cue */}
        <ScrollCue className="absolute bottom-8 left-1/2 -translate-x-1/2" />
      </div>
    </section>
  );
}
