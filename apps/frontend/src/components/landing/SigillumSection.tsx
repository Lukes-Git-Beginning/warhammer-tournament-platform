import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ExternalLink } from 'lucide-react';
import { KarazSigil } from '@/components/icons/KarazSigil';
import { Button } from '@/components/ui/button';

/**
 * Section 6 — Sigillum Karaz.
 * Final-CTA chamber. Centered sigil + motto + community links.
 */
export function SigillumSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  return (
    <section
      aria-labelledby="sigillum-heading"
      className="relative overflow-hidden py-20 lg:py-32"
    >
      {/* Stone-wall texture background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-stone-wall-texture bg-[length:1024px_1024px] opacity-[0.12] mix-blend-soft-light"
      />
      {/* Forge-radial glow centered on sigil */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(216,99,42,0.16), transparent 70%)',
        }}
      />

      <div className="relative mx-auto flex max-w-2xl flex-col items-center px-4 text-center sm:px-6">
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          className="mb-8"
          style={{ filter: 'drop-shadow(0 0 28px rgba(212, 160, 23, 0.25))' }}
        >
          <KarazSigil className="size-32 text-karaz-gold-500 sm:size-40" strokeWidth={1.2} />
        </motion.div>

        <motion.h2
          id="sigillum-heading"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="font-display font-bold text-karaz-stone-100"
          style={{ fontSize: 'clamp(2rem, 4.5vw, 3.5rem)', lineHeight: 1.1 }}
        >
          {t('sigillum.heading')}
        </motion.h2>

        <motion.p
          aria-hidden="true"
          lang="la"
          title="Everlasting Realm"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-3 font-display italic text-karaz-gold-500/80"
          style={{ fontSize: 'clamp(1rem, 2vw, 1.25rem)' }}
        >
          Karaz Ankor
        </motion.p>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10"
        >
          <Button asChild variant="forge" size="lg">
            <Link to="/login">{t('sigillum.cta')}</Link>
          </Button>
        </motion.div>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-8 flex items-center justify-center gap-6 text-karaz-stone-400"
        >
          <a
            href="https://discord.gg/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-display tracking-wider uppercase hover:text-karaz-gold-400 transition-colors"
          >
            Discord
            <ExternalLink className="size-3.5" strokeWidth={1.5} />
          </a>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-display tracking-wider uppercase hover:text-karaz-gold-400 transition-colors"
          >
            GitHub
            <ExternalLink className="size-3.5" strokeWidth={1.5} />
          </a>
          <a
            href="https://reddit.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-display tracking-wider uppercase hover:text-karaz-gold-400 transition-colors"
          >
            Reddit
            <ExternalLink className="size-3.5" strokeWidth={1.5} />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
