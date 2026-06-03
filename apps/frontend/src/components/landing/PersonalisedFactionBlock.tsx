import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { getFactions } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { Skeleton } from '@/components/ui/skeleton';
import type { FactionDto } from '@rizzotto/types';

function FactionCard({ faction }: { faction: FactionDto }) {
  return (
    <Link
      to="/factions/$id"
      params={{ id: faction.id }}
      className="group flex flex-col items-center gap-3 rounded-md border border-rizzotto-iron-700/60 bg-rizzotto-iron-900/60 p-5 backdrop-blur-sm transition-colors hover:border-rizzotto-gold-500/50 hover:bg-rizzotto-iron-800/50"
    >
      <FactionBadge
        colorHex={faction.color_hex}
        initials={faction.initials}
        name={faction.name}
        size="lg"
        iconUrl={faction.icon_url}
      />
      <span className="text-center text-sm font-medium leading-tight text-rizzotto-stone-200 transition-colors group-hover:text-rizzotto-gold-400">
        {faction.name}
      </span>
    </Link>
  );
}

function LoadingGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-md" />
      ))}
    </div>
  );
}

/**
 * Landing-Block — Personalisierte Fraktionen.
 * Wird nur gerendert, wenn der User eingeloggt ist und `preferred_factions` gesetzt hat.
 * Löst die IDs aus preferred_factions gegen die vollständige Fraktionsliste auf.
 */
export function PersonalisedFactionBlock() {
  const { data: user } = useAuthQuery();
  const reduced = useReducedMotion();

  const hasPref = Array.isArray(user?.preferred_factions) && user.preferred_factions.length > 0;

  const { data: factionList, isLoading } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    enabled: hasPref,
  });

  // Nicht eingeloggt oder keine Präferenzen → unsichtbar
  if (!user || !hasPref) return null;

  const resolved =
    factionList?.data
      .filter((entry) => user.preferred_factions.includes(entry.faction.id))
      .map((entry) => entry.faction) ?? [];

  return (
    <section aria-labelledby="pref-factions-heading" className="relative py-16 lg:py-24">
      {/* Atmosphärische Textur — Chainmail, analog zu ActiveMustersSection */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-chainmail-fine-texture bg-[length:480px_480px] opacity-[0.04] mix-blend-soft-light"
      />
      <div className="relative mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="mb-8 lg:mb-12">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
            Karaz Ankor
          </span>
          <h2
            id="pref-factions-heading"
            className="mt-2 font-display font-bold text-rizzotto-stone-100"
            style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
          >
            Deine Fraktionen
          </h2>
        </div>

        {isLoading && <LoadingGrid count={user.preferred_factions.length} />}

        {!isLoading && resolved.length > 0 && (
          <motion.ul
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: reduced ? 0 : 0.07, delayChildren: 0.05 },
              },
            }}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          >
            {resolved.map((faction) => (
              <motion.li
                key={faction.id}
                variants={{
                  hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { type: 'spring', stiffness: 320, damping: 28, mass: 0.8 },
                  },
                }}
              >
                <FactionCard faction={faction} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </section>
  );
}
