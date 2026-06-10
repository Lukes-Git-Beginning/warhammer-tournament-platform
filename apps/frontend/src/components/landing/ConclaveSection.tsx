import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Trophy, Star, TrendingUp } from 'lucide-react';
import { ArchHeader } from './ArchHeader';

/**
 * Section 5 — The Conclave.
 * Three pillars: Tournaments, Roll of Honour, The Ladder (coming soon).
 */
export function ConclaveSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const pillars = [
    {
      key: 'tournaments',
      icon: <Trophy className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.tournaments.title'),
      description: t('conclave.pillars.tournaments.body'),
      comingSoon: false,
    },
    {
      key: 'honour',
      icon: <Star className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.honour.title'),
      description: t('conclave.pillars.honour.body'),
      comingSoon: false,
    },
    {
      key: 'ladder',
      icon: <TrendingUp className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.ladder.title'),
      description: t('conclave.pillars.ladder.body'),
      comingSoon: true,
    },
  ];

  return (
    <section aria-labelledby="conclave-heading" className="relative py-16 lg:py-24">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="mb-12 text-center lg:mb-16">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
            {t('conclave.eyebrow')}
          </span>
          <h2
            id="conclave-heading"
            className="mt-2 font-display font-bold text-rizzotto-stone-100"
            style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
          >
            {t('conclave.heading')}
          </h2>
        </div>

        <motion.ul
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: reduced ? 0 : 0.12 } },
          }}
          className="grid grid-cols-1 gap-12 md:grid-cols-3 lg:gap-8"
        >
          {pillars.map((p) => (
            <motion.li
              key={p.key}
              variants={{
                hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 24 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
              }}
              className={p.comingSoon ? 'opacity-50' : undefined}
            >
              <ArchHeader
                icon={p.icon}
                title={p.title}
                className={p.comingSoon ? 'text-rizzotto-stone-400' : undefined}
              />
              {p.comingSoon && (
                <div className="mt-3 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-sm border border-rizzotto-gold-500/40 bg-rizzotto-gold-500/10 px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.2em] text-rizzotto-gold-400">
                    {t('conclave.coming_soon')}
                  </span>
                </div>
              )}
              <p className="mx-auto mt-4 max-w-xs text-center text-rizzotto-stone-300 leading-relaxed">
                {p.description}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
