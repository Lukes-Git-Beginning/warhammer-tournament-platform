import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getLeaderboard } from '@/lib/api';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Section 4 — Roll of Honour.
 * Top-10 marshals by dynamic weighted season standing (final points, Alex-Spec).
 * Uses getLeaderboard() and degrades to empty / loading states gracefully.
 */
export function RollOfHonourSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaderboard', 'landing-top-10'],
    queryFn: () => getLeaderboard({ page: 1, pageSize: 10 }),
    retry: false,
  });

  const entries = data?.entries ?? [];
  const hasEntries = entries.length > 0;

  return (
    <section aria-labelledby="roll-heading" className="relative py-16 lg:py-24">
      <div className="mx-auto max-w-[60rem] px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center lg:mb-12">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
            {t('roll_of_honour.eyebrow')}
          </span>
          <h2
            id="roll-heading"
            className="mt-2 font-display font-bold text-rizzotto-stone-100"
            style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
          >
            {t('roll_of_honour.heading')}
          </h2>
        </div>

        {!isLoading && (isError || !hasEntries) && (
          <EmptyState
            variant="banner"
            title={t('roll_of_honour.empty_title')}
            body={t('roll_of_honour.empty_body')}
            motto={t('roll_of_honour.empty_motto')}
            mottoTitle="Sealed in stone"
            image={{ src: '/img/empty-roll', alt: '', width: 1448, height: 1086 }}
          />
        )}

        {(isLoading || hasEntries) && (
          <Card variant="banner" className="overflow-hidden">
            {isLoading && (
              <ul className="divide-y divide-rizzotto-iron-700">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="grid grid-cols-[2.5rem_2.5rem_1fr_auto] items-center gap-4 px-5 py-3">
                    <Skeleton className="h-6 w-6" />
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-12" />
                  </li>
                ))}
              </ul>
            )}

            {hasEntries && (
              <motion.ol
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.15 }}
                variants={{
                  hidden: {},
                  visible: {
                    transition: { staggerChildren: reduced ? 0 : 0.06 },
                  },
                }}
                className="divide-y divide-rizzotto-iron-700"
              >
                {entries.slice(0, 10).map((entry, idx) => (
                  <motion.li
                    key={entry.playerId}
                    variants={{
                      hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] } },
                    }}
                    className="group grid grid-cols-[2.5rem_2.5rem_1fr_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-rizzotto-iron-800/70"
                  >
                    <span
                      className="font-display text-xl font-semibold tabular-nums text-rizzotto-bronze group-hover:text-rizzotto-gold-400"
                      aria-label={`Rank ${idx + 1}`}
                    >
                      {ROMAN[idx] ?? idx + 1}
                    </span>
                    <Avatar goldRim={idx < 3} className="size-10">
                      {entry.avatarUrl && <AvatarImage src={entry.avatarUrl} alt="" />}
                      <AvatarFallback>{entry.displayName[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-rizzotto-stone-100 group-hover:text-rizzotto-gold-300">
                      {entry.displayName}
                    </span>
                    <span className="font-mono tabular-nums text-rizzotto-gold-400">
                      {Math.round(entry.totalFinalPoints)}
                    </span>
                  </motion.li>
                ))}
              </motion.ol>
            )}

            <Separator engraved className="mx-5" />
            <div className="px-5 py-4 text-center">
              <Button asChild variant="etched" size="sm">
                <Link to="/leaderboard">
                  {t('roll_of_honour.view_all')}
                  <ArrowRight className="size-3.5" strokeWidth={1.5} />
                </Link>
              </Button>
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}
