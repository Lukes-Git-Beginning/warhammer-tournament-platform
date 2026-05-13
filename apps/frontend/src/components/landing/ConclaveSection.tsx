import { motion, useReducedMotion } from 'motion/react';
import { Swords, GitBranch, Users } from 'lucide-react';
import { ArchHeader } from './ArchHeader';

const PILLARS = [
  {
    icon: <Swords className="size-7" strokeWidth={1.25} />,
    title: 'Swiss Toll',
    description:
      'Every marshal plays a fixed number of tolls, paired against opponents of equal standing. No one is eliminated; the Roll decides.',
  },
  {
    icon: <GitBranch className="size-7" strokeWidth={1.25} />,
    title: 'Lineage',
    description:
      'Single- and double-elimination brackets. Each engagement carves the lineage tree, until only one banner remains.',
  },
  {
    icon: <Users className="size-7" strokeWidth={1.25} />,
    title: 'The Choosing',
    description:
      "Live Captain's Mode draft. Marshals claim and forbid factions in real time — the choice is the first battle.",
  },
];

/**
 * Section 5 — The Conclave.
 * Three formats, three pillars, gothic-arch column headers.
 */
export function ConclaveSection() {
  const reduced = useReducedMotion();

  return (
    <section aria-labelledby="conclave-heading" className="relative py-16 lg:py-24">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="mb-12 text-center lg:mb-16">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-karaz-gold-500">
            How We Muster
          </span>
          <h2
            id="conclave-heading"
            className="mt-2 font-display font-bold text-karaz-stone-100"
            style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
          >
            The Conclave
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
          {PILLARS.map((p) => (
            <motion.li
              key={p.title}
              variants={{
                hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 24 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
              }}
            >
              <ArchHeader icon={p.icon} title={p.title} />
              <p className="mx-auto mt-6 max-w-xs text-center text-karaz-stone-300 leading-relaxed">
                {p.description}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
