import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Crown, Users, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { listTournaments, type Tournament } from '@/lib/api';

type TournamentState = 'live' | 'upcoming' | 'completed';

function tournamentState(t: Tournament): TournamentState {
  if (t.status === 'ONGOING') return 'live';
  if (t.status === 'COMPLETED') return 'completed';
  return 'upcoming';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function MusterCard({ tournament }: { tournament: Tournament }) {
  const { t } = useTranslation();
  const state = tournamentState(tournament);
  return (
    <Card variant="banner" interactive className="group h-full">
      <CardHeader>
        {state === 'live' && (
          <Badge variant="forge" className="self-start">
            <span className="size-1.5 rounded-full bg-rizzotto-forge-400 animate-rizzotto-pulse" />
            {t('musters.status_live')}
          </Badge>
        )}
        {state === 'upcoming' && (
          <Badge variant="gold" className="self-start">
            {t('musters.status_upcoming')}
          </Badge>
        )}
        {state === 'completed' && (
          <Badge variant="default" className="self-start">
            {t('musters.status_completed')}
          </Badge>
        )}
        {tournament.is_major && (
          <Badge variant="major" className="self-start">
            <Crown className="size-3" strokeWidth={1.5} />
            Major
          </Badge>
        )}
        <CardTitle className="line-clamp-2">{tournament.name}</CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-rizzotto-stone-400">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" strokeWidth={1.5} />
            <span className="font-mono">
              {tournament.participantCount ?? '—'}
              {tournament.max_participants ? ` / ${tournament.max_participants}` : ''}
            </span>
            <span className="text-xs uppercase tracking-wider">{t('musters.marshals')}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider">
            <span className="font-mono">{tournament.format.replace(/_/g, ' ')}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {tournament.description && (
          <p className="line-clamp-2 text-sm text-rizzotto-stone-300">{tournament.description}</p>
        )}
      </CardContent>
      <Separator engraved className="mx-6 my-2" />
      <CardFooter>
        <time
          dateTime={tournament.start_date}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-rizzotto-stone-400"
        >
          <Clock className="size-3.5" strokeWidth={1.5} />
          {formatDate(tournament.start_date)}
        </time>
        <Button asChild variant="etched" size="sm">
          <Link to="/tournaments/$slug" params={{ slug: tournament.slug }}>
            {t('musters.answer_call')}
            <ArrowRight className="size-3.5" strokeWidth={1.5} />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Section 3 — Active Musters.
 * Grid of upcoming and live tournaments. Uses listTournaments() and
 * gracefully degrades to an empty/loading state.
 */
export function ActiveMustersSection() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tournaments', 1, 6],
    queryFn: () => listTournaments(1, 6),
    retry: false,
  });

  const tournaments = data?.data ?? [];
  const hasTournaments = tournaments.length > 0;

  return (
    <section aria-labelledby="musters-heading" className="relative py-16 lg:py-24">
      {/* Section atmospheric texture — chainmail grid suggests list structure */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-chainmail-fine-texture bg-[length:480px_480px] opacity-[0.06] mix-blend-soft-light"
      />
      <div className="relative mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="mb-8 flex items-end justify-between gap-4 lg:mb-12">
          <div>
            <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
              {t('musters.eyebrow')}
            </span>
            <h2
              id="musters-heading"
              className="mt-2 font-display font-bold text-rizzotto-stone-100"
              style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
            >
              {t('musters.heading')}
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/tournaments" search={{ tab: 'upcoming', page: 1 }} className="!normal-case">
              {t('musters.view_all')}
              <ArrowRight className="size-3.5" strokeWidth={1.5} />
            </Link>
          </Button>
        </div>

        {isLoading && <LoadingGrid />}
        {!isLoading && (isError || !hasTournaments) && (
          <EmptyState
            variant="banner"
            title={t('musters.empty_title')}
            body={t('musters.empty_body')}
            motto={t('musters.empty_motto')}
            mottoTitle="Remember the fight"
            image={{ src: '/img/empty-musters', alt: '', width: 1448, height: 1086 }}
          />
        )}
        {hasTournaments && (
          <motion.ul
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: reduced ? 0 : 0.08, delayChildren: 0.1 },
              },
            }}
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6"
          >
            {tournaments.map((t) => (
              <motion.li
                key={t.id}
                variants={{
                  hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 20 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { type: 'spring', stiffness: 320, damping: 28, mass: 0.8 },
                  },
                }}
              >
                <MusterCard tournament={t} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </section>
  );
}
