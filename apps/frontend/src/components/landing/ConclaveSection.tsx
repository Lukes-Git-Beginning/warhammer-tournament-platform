import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Swords, GitBranch, Users } from 'lucide-react';
import { ArchHeader } from './ArchHeader';

/**
 * Section 5 — The Conclave.
 * Three formats, three pillars, gothic-arch column headers.
 */
export function ConclaveSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const pillars = [
    {
      key: 'swiss',
      icon: <Swords className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.swiss.title'),
      description: t('conclave.pillars.swiss.body'),
    },
    {
      key: 'bracket',
      icon: <GitBranch className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.bracket.title'),
      description: t('conclave.pillars.bracket.body'),
    },
    {
      key: 'draft',
      icon: <Users className="size-7" strokeWidth={1.25} />,
      title: t('conclave.pillars.draft.title'),
      description: t('conclave.pillars.draft.body'),
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
            >
              <ArchHeader icon={p.icon} title={p.title} />
              <p className="mx-auto mt-6 max-w-xs text-center text-rizzotto-stone-300 leading-relaxed">
                {p.description}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
