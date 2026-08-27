import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KOFI_URL } from '@/lib/constants';
import { FundingGoalBar } from '@/components/supporter/FundingGoalBar';

const MODES = ['2v2', 'Conquest', 'Siege'];

/**
 * Funding band — the prominent Ko-Fi call-to-action for the three new battle modes,
 * with a progress bar toward the goal.
 *
 * - default: a centered, standalone section (e.g. the support page).
 * - `compact`: a wide, short horizontal band — headline + goal bar left, CTA right —
 *   for the top of a page (e.g. above the landing hero).
 */
export function FundingSection({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion();

  const rise = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.5, delay },
  });

  const cta = (
    <Button asChild variant="forge" size="lg">
      <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
        <Coffee className="size-5" strokeWidth={1.5} aria-hidden="true" />
        Support on Ko-Fi
      </a>
    </Button>
  );

  const backdrop = (
    <>
      {/* Stone-wall texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-stone-wall-texture bg-[length:1024px_1024px] opacity-[0.10] mix-blend-soft-light"
      />
      {/* Forge-radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 50% 45%, rgba(216,99,42,0.18), transparent 70%)',
        }}
      />
    </>
  );

  // Compact: wide, short horizontal band — headline + goal bar left, CTA right.
  if (compact) {
    return (
      <section
        aria-labelledby="funding-heading"
        className="relative overflow-hidden border-y border-rizzotto-gold-700/30 py-6 lg:py-7"
      >
        {backdrop}
        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <motion.div {...rise(0)} className="w-full text-center lg:flex-1 lg:text-left">
            <h2
              id="funding-heading"
              className="font-display font-bold text-rizzotto-stone-100"
              style={{ fontSize: 'clamp(1.3rem, 2.6vw, 2rem)', lineHeight: 1.15 }}
            >
              Help build <span className="text-rizzotto-gold-300">2v2, Conquest &amp; Siege</span>
            </h2>
            <FundingGoalBar className="mx-auto mt-3 max-w-md lg:mx-0 lg:max-w-xl" />
          </motion.div>
          <motion.div {...rise(0.1)} className="flex shrink-0 flex-wrap items-center justify-center gap-3">
            <Button asChild variant="etched" size="md">
              <Link to="/support">Learn more</Link>
            </Button>
            <Button asChild variant="etched" size="md">
              <Link to="/support" hash="hall-of-fame">Supporter Hall of Fame</Link>
            </Button>
            {cta}
          </motion.div>
        </div>
      </section>
    );
  }

  // Full: centered standalone section.
  return (
    <section
      aria-labelledby="funding-heading"
      className="relative overflow-hidden border-y border-rizzotto-gold-700/30 py-16 lg:py-24"
    >
      {backdrop}
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 text-center sm:px-6">
        <motion.p
          {...rise(0)}
          className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-rizzotto-gold-500"
        >
          Community-funded · no ads · no paywalls
        </motion.p>

        <motion.h2
          id="funding-heading"
          {...rise(0.05)}
          className="font-display font-bold text-rizzotto-stone-100"
          style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', lineHeight: 1.1 }}
        >
          Help build the next three battle modes
        </motion.h2>

        <motion.div
          {...rise(0.15)}
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          {MODES.map((m) => (
            <span
              key={m}
              className="rounded-full border border-rizzotto-gold-700/50 bg-rizzotto-gold-900/20 px-4 py-1.5 font-display text-base text-rizzotto-gold-300"
            >
              {m}
            </span>
          ))}
        </motion.div>

        {/* Support-page mission + cost statement (Alex's own copy). This full variant renders
            only on /support; the landing uses the compact variant, which omits this paragraph. */}
        <motion.p {...rise(0.2)} className="mt-6 max-w-2xl text-rizzotto-stone-300">
          RizzOtto&rsquo;s Arena has always been free: no ads, no paywalls, built and run by
          players. Now I want to build the next chapter: three new battle modes (2v2, Conquest and
          Siege), and keep the servers running. To get all this accomplished in a timely manner, I
          need some outside dev support, which costs money. Supporters are credited on the site.
        </motion.p>

        <motion.div {...rise(0.25)} className="mt-8 w-full max-w-md">
          <FundingGoalBar />
        </motion.div>

        <motion.div {...rise(0.32)} className="mt-8">
          {cta}
        </motion.div>
      </div>
    </section>
  );
}
