import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Picture } from '@/components/ui/picture';

/**
 * Section 2 — The Forge.
 * Mission statement, beautifully framed. Split layout: photo placeholder
 * on the left, copy on the right (stacked on mobile).
 */
export function ForgeSection() {
  const reduced = useReducedMotion();

  return (
    <section aria-labelledby="forge-heading" className="relative py-16 lg:py-24">
      <div className="mx-auto grid max-w-[80rem] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-[2fr_3fr] lg:gap-16 lg:px-8 xl:gap-20 xl:px-12">
        {/* Forge photo */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          className="karaz-photo-frame relative aspect-[3/4] w-full overflow-hidden rounded-lg ring-1 ring-karaz-iron-600 shadow-karaz-banner"
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
        >
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-karaz-gold-500">
            The Forge
          </span>
          <h2
            id="forge-heading"
            className="mt-3 font-display font-bold text-karaz-stone-100"
            style={{ fontSize: 'clamp(2rem, 4.5vw, 3.5rem)', lineHeight: 1.1 }}
          >
            Every list is forged
            <br />
            in iron and resolve.
          </h2>
          <p className="dropcap dropcap-stone mt-6 max-w-prose text-lg leading-relaxed text-karaz-stone-200">
            Every campaign begins with the list. Every list is forged in iron
            and resolve. Here we record each muster, each toll of the bell,
            and every triumph and fall — so that the marshals of the
            Old World may stand on the Roll of Honour, their deeds
            sealed in stone.
          </p>
          <p
            aria-hidden="true"
            lang="la"
            title="From iron, law"
            className="mt-6 font-display italic text-base tracking-wider text-karaz-gold-500/80"
          >
            "Ex Ferro, Lex."
          </p>
          <div className="mt-8">
            <Button variant="etched" size="md">
              Read the Manifesto
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
