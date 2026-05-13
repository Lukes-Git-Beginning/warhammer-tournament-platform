import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Picture } from '@/components/ui/picture';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getLeaderboard } from '@/lib/api';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Section 4 — Roll of Honour.
 * Top-10 marshals by ELO standing. Uses getLeaderboard() and degrades to
 * empty / loading states gracefully.
 */
export function RollOfHonourSection() {
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
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-karaz-gold-500">
            Sealed in Stone
          </span>
          <h2
            id="roll-heading"
            className="mt-2 font-display font-bold text-karaz-stone-100"
            style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
          >
            The Roll of Honour
          </h2>
          <p
            aria-hidden="true"
            lang="la"
            title="Sealed in stone"
            className="mt-2 font-display italic text-karaz-gold-500/70 text-sm tracking-wider"
          >
            In Lapide Sigillata
          </p>
        </div>

        <Card variant="banner" className="overflow-hidden">
          {isLoading && (
            <ul className="divide-y divide-karaz-iron-700">
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

          {!isLoading && (isError || !hasEntries) && (
            <div className="grid grid-cols-1 items-center gap-6 px-6 py-10 text-center sm:grid-cols-[auto_1fr] sm:gap-8 sm:text-left">
              <Picture
                src="/img/empty-roll"
                alt=""
                width={1448}
                height={1086}
                className="mx-auto h-40 w-auto rounded-md ring-1 ring-karaz-iron-700/60"
              />
              <div>
                <h3 className="font-display text-xl font-semibold text-karaz-stone-100">
                  A blank Roll.
                </h3>
                <p className="mt-2 text-karaz-stone-300">
                  The forge awaits its first strike.
                </p>
                <p
                  aria-hidden="true"
                  lang="la"
                  title="Sealed in stone"
                  className="mt-3 font-display italic text-sm tracking-wider text-karaz-gold-500/70"
                >
                  "In Lapide Sigillata"
                </p>
              </div>
            </div>
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
              className="divide-y divide-karaz-iron-700"
            >
              {entries.slice(0, 10).map((entry, idx) => (
                <motion.li
                  key={entry.user.id}
                  variants={{
                    hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] } },
                  }}
                  className="group grid grid-cols-[2.5rem_2.5rem_1fr_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-karaz-iron-800/70"
                >
                  <span
                    className="font-display text-xl font-semibold tabular-nums text-karaz-bronze group-hover:text-karaz-gold-400"
                    aria-label={`Rank ${idx + 1}`}
                  >
                    {ROMAN[idx] ?? idx + 1}
                  </span>
                  <Avatar goldRim={idx < 3} className="size-10">
                    {entry.user.avatar_url && <AvatarImage src={entry.user.avatar_url} alt="" />}
                    <AvatarFallback>{entry.user.username[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate font-medium text-karaz-stone-100 group-hover:text-karaz-gold-300">
                    {entry.user.username}
                  </span>
                  <span className="font-mono tabular-nums text-karaz-gold-400">
                    {Math.round(entry.elo_rating ?? 0)}
                  </span>
                </motion.li>
              ))}
            </motion.ol>
          )}

          <Separator engraved className="mx-5" />
          <div className="px-5 py-4 text-center">
            <Button asChild variant="etched" size="sm">
              <Link to="/leaderboard">
                View the full Roll of Honour
                <ArrowRight className="size-3.5" strokeWidth={1.5} />
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}
