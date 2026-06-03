import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Picture } from '@/components/ui/picture';

/**
 * Section 2 — The Forge.
 * Mission statement, beautifully framed. Split layout: photo placeholder
 * on the left, copy on the right (stacked on mobile).
 */
export function ForgeSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  return (
    <section aria-labelledby="forge-heading" className="relative py-16 lg:py-20">
      {/* Section atmospheric texture — forge embers smoulder behind the anvil */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-forge-embers-texture bg-[length:640px_640px] opacity-[0.05] mix-blend-soft-light"
      />
      <div className="relative mx-auto grid max-w-[80rem] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-3 lg:gap-16 lg:px-8 xl:gap-20 xl:px-12">
        {/* Forge photo */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          className="rizzotto-photo-frame relative mx-auto aspect-[3/4] w-full min-w-0 max-h-[560px] overflow-hidden rounded-lg ring-1 ring-rizzotto-iron-600 shadow-rizzotto-banner lg:col-span-1 lg:max-h-[640px]"
        >
          <Picture
            src="/img/forge-anvil"
            alt=""
            width={1086}
            height={1448}
            className="h-full w-full object-cover"
          />
        </motion.div>

        {/* Copy */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: 0.15 }}
          className="min-w-0 lg:col-span-2"
        >
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
            {t('forge_section.eyebrow')}
          </span>
          <h2
            id="forge-heading"
            className="mt-3 font-display font-bold text-rizzotto-stone-100"
            style={{ fontSize: 'clamp(2rem, 4.5vw, 3.5rem)', lineHeight: 1.1 }}
          >
            {t('forge_section.heading_line1')}
            <br />
            {t('forge_section.heading_line2')}
          </h2>
          <p className="dropcap dropcap-stone mt-6 max-w-prose text-lg leading-relaxed text-rizzotto-stone-200">
            {t('forge_section.body')}
          </p>
          <p
            aria-hidden="true"
            lang="la"
            title="From iron, law"
            className="mt-6 font-display italic text-base tracking-wider text-rizzotto-gold-500/80"
          >
            {t('forge_section.motto')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
