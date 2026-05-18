import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { RizzottoWordmarkImage } from '@/components/icons/RizzottoWordmarkImage';
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

  return (
    <section
      aria-label="Hero"
      className="relative isolate min-h-[100svh] w-full overflow-hidden"
    >
      {/* Hero photo (full-bleed background) */}
      <div aria-hidden="true" className="karaz-photo-frame absolute inset-0 -z-10">
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
        style={{ boxShadow: 'var(--shadow-karaz-stone-vignette)' }}
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

        {/* Tagline */}
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced
              ? { duration: 0.24 }
              : { duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: 1.0 }
          }
          className="mt-6 font-display italic text-karaz-stone-200"
          style={{
            fontSize: 'clamp(1.125rem, 2.4vw, 1.625rem)',
            textShadow: '0 2px 12px rgba(0,0,0,0.7)',
          }}
        >
          {t('hero.tagline')}
        </motion.p>

        {/* Latin sub-motto */}
        <motion.p
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={
            reduced ? { duration: 0.24 } : { duration: 0.6, delay: 1.15 }
          }
          lang="la"
          className="mt-1 font-display text-[11px] uppercase tracking-[0.4em] text-karaz-gold-500/80"
          title="Everlasting Realm"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
        >
          Karaz Ankor
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.08, delayChildren: reduced ? 0 : 1.2 },
            },
          }}
          className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
        >
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
