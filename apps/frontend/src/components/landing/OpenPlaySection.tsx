import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getScheduledMatchups,
  getQueueStatus,
  joinQueue,
  acceptScheduledMatchup,
  type ScheduledMatchup,
} from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';

const FORMAT_DURATION: Record<string, string> = {
  BO1: '~30 min',
  BO3: '~90 min',
  BO5: '~150 min',
};

// ---------------------------------------------------------------------------
// Queue Card
// ---------------------------------------------------------------------------

function QueueCard({ userId }: { userId?: string }) {
  const qc = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['queue-status'],
    queryFn: getQueueStatus,
    refetchInterval: 10_000,
    enabled: !!userId,
  });

  const join = useMutation({
    mutationFn: joinQueue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });

  return (
    <Card variant="banner" className="h-full flex flex-col">
      <CardHeader>
        <Badge variant="gold" className="self-start">Queue</Badge>
        <CardTitle>Jump In</CardTitle>
        <p className="text-sm text-rizzotto-stone-400 mt-1">
          Get matched instantly — random map, blind faction pick. All results count toward the
          leaderboard.
        </p>
      </CardHeader>

      <CardContent className="flex-1">
        {status && (
          <p className="text-sm text-stone-300">
            <span className="font-mono font-bold text-amber-400">{status.total}</span>{' '}
            {status.total === 1 ? 'player' : 'players'} waiting
          </p>
        )}
      </CardContent>

      <Separator engraved className="mx-6 my-2" />

      <CardFooter>
        {!userId ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/open-play" className="!normal-case">
              View Open Play
              <ArrowRight className="size-3.5" strokeWidth={1.5} />
            </Link>
          </Button>
        ) : status?.inQueue ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            In queue — #{status.position} of {status.total}
          </span>
        ) : (
          <Button size="sm" onClick={() => join.mutate()} disabled={join.isPending}>
            {join.isPending ? 'Joining…' : 'Join Queue'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Challenge Card
// ---------------------------------------------------------------------------

function ChallengeCard({ matchup, userId }: { matchup: ScheduledMatchup; userId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isOwn = userId != null && matchup.proposer?.id === userId;

  const accept = useMutation({
    mutationFn: () => acceptScheduledMatchup(matchup.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      void navigate({ to: '/matches/$matchId', params: { matchId: data.match_id } });
    },
  });

  const date = new Date(matchup.proposed_at);

  return (
    <Link to="/open-play" className="block group h-full">
      <Card variant="banner" interactive className="h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="self-start font-mono text-xs">
              {matchup.format}
            </Badge>
            <span className="text-xs text-stone-500">{FORMAT_DURATION[matchup.format]}</span>
          </div>
          <CardTitle className="text-base line-clamp-1">
            {matchup.proposer ? `${matchup.proposer.username}'s challenge` : 'Open challenge'}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1">
          {matchup.notes && (
            <p className="text-sm text-rizzotto-stone-400 line-clamp-2">{matchup.notes}</p>
          )}
        </CardContent>

        <Separator engraved className="mx-6 my-2" />

        <CardFooter>
          <time className="inline-flex items-center gap-1.5 font-mono text-xs text-rizzotto-stone-400">
            <Clock className="size-3.5" strokeWidth={1.5} />
            {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
            {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </time>
          {userId && !isOwn && (
            <Button
              size="sm"
              disabled={accept.isPending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                accept.mutate();
              }}
            >
              {accept.isPending ? 'Accepting…' : 'Accept'}
            </Button>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function OpenPlaySection() {
  const reduced = useReducedMotion();
  const { data: me } = useAuthQuery();

  const { data, isLoading } = useQuery({
    queryKey: ['scheduled-matchups'],
    queryFn: () => getScheduledMatchups(),
    staleTime: 60_000,
  });

  const challenges = data?.matchups.slice(0, 2) ?? [];

  return (
    <section aria-labelledby="open-play-heading" className="relative py-16 lg:py-24">
      <div className="relative mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">

        <div className="mb-8 flex items-end justify-between gap-4 lg:mb-12">
          <div>
            <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-rizzotto-gold-500">
              Open Play
            </span>
            <h2
              id="open-play-heading"
              className="mt-2 font-display font-bold text-rizzotto-stone-100"
              style={{ fontSize: 'clamp(1.625rem, 3.5vw, 2.5rem)', lineHeight: 1.15 }}
            >
              Find an Adversary
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/open-play" className="!normal-case">
              Open Play
              <ArrowRight className="size-3.5" strokeWidth={1.5} />
            </Link>
          </Button>
        </div>

        <motion.div
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
          {/* Queue card — always first */}
          <motion.div
            variants={{
              hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.8 } },
            }}
          >
            <QueueCard userId={me?.id} />
          </motion.div>

          {/* Challenge cards */}
          {isLoading ? (
            <>
              <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}>
                <Skeleton className="h-52 rounded-lg" />
              </motion.div>
              <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}>
                <Skeleton className="h-52 rounded-lg" />
              </motion.div>
            </>
          ) : challenges.length === 0 ? (
            <motion.div
              variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
              className="sm:col-span-1 lg:col-span-2 flex items-center"
            >
              <p className="text-sm text-stone-500">
                No open challenges yet.{' '}
                <Link to="/open-play" className="text-stone-400 underline hover:text-stone-200 transition-colors">
                  Post one
                </Link>{' '}
                and let opponents come to you.
              </p>
            </motion.div>
          ) : (
            challenges.map((m) => (
              <motion.div
                key={m.id}
                variants={{
                  hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.8 } },
                }}
              >
                <ChallengeCard matchup={m} userId={me?.id} />
              </motion.div>
            ))
          )}
        </motion.div>

      </div>
    </section>
  );
}
