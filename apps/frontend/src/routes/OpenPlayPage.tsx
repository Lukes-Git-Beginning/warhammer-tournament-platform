import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth, useAuthQuery } from '../lib/auth';
import {
  joinQueue,
  getMyAvailability,
  setMyAvailability,
  getAvailabilityHeatmap,
  getScheduledMatchups,
  type MatchFormat,
  type AvailabilitySlot,
  type AvailabilityContext,
} from '../lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { QueueStatusCard } from '../components/open-play/QueueStatusCard';
import { WeekAvailabilityGrid } from '../components/open-play/WeekAvailabilityGrid';
import { AvailabilityHeatmap } from '../components/open-play/AvailabilityHeatmap';
import { ScheduledMatchupCard } from '../components/open-play/ScheduledMatchupCard';
import { ScheduledMatchupForm } from '../components/open-play/ScheduledMatchupForm';

export function OpenPlayPage() {
  useRequireAuth();
  const { data: me } = useAuthQuery();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-100">Open Play</h1>
        <p className="text-sm text-stone-400 mt-1">
          Ranked matches outside of tournaments — all results count towards the leaderboard.
        </p>
      </div>

      <QueueStatusCard />

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="challenges">Challenges</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="pt-4">
          <QueueTab />
        </TabsContent>

        <TabsContent value="availability" className="pt-4">
          <AvailabilityTab currentUserId={me?.id} />
        </TabsContent>

        <TabsContent value="challenges" className="pt-4">
          <ChallengesTab currentUserId={me?.id} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Queue Tab
// ---------------------------------------------------------------------------

function QueueTab() {
  const [format, setFormat] = useState<MatchFormat>('BO3');
  const qc = useQueryClient();

  const join = useMutation({
    mutationFn: () => joinQueue(format),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });

  return (
    <div className="max-w-sm space-y-4">
      <p className="text-sm text-stone-300">
        Join the live queue to be instantly matched with another player. When two players are in
        the queue for the same format, a match is created and both receive a Discord DM.
      </p>
      <div className="flex gap-3">
        <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)} className="w-36">
          <option value="BO1">BO1</option>
          <option value="BO3">BO3</option>
          <option value="BO5">BO5</option>
        </Select>
        <Button onClick={() => join.mutate()} disabled={join.isPending}>
          {join.isPending ? 'Joining...' : 'Join Queue'}
        </Button>
      </div>
      {join.data?.matched && (
        <p className="text-sm text-green-400">
          Match found!{' '}
          <a
            href={`/matches/${join.data.match_id}`}
            className="underline hover:text-green-300"
          >
            Open match →
          </a>
        </p>
      )}
      {join.error && (
        <p className="text-sm text-red-400">{String(join.error)}</p>
      )}
      <p className="text-xs text-stone-500">
        Matches count towards the leaderboard when both players confirm the result and one player
        uploads the replay.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability Tab
// ---------------------------------------------------------------------------

function AvailabilityTab({ currentUserId }: { currentUserId?: string }) {
  const [context, setContext] = useState<AvailabilityContext>('MATCHMAKING');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [localSlots, setLocalSlots] = useState<AvailabilitySlot[] | null>(null);
  const qc = useQueryClient();

  const { data: myData, isLoading } = useQuery({
    queryKey: ['availability-me', currentUserId],
    queryFn: getMyAvailability,
    enabled: !!currentUserId,
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: getAvailabilityHeatmap,
    enabled: showHeatmap,
  });

  const save = useMutation({
    mutationFn: (slots: AvailabilitySlot[]) =>
      setMyAvailability(slots.map(({ day_of_week, hour_utc, context: ctx }) => ({ day_of_week, hour_utc, context: ctx }))),
    onSuccess: (data) => {
      qc.setQueryData(['availability-me', currentUserId], data);
      setLocalSlots(null);
    },
  });

  const slots = localSlots ?? myData?.slots ?? [];
  const isDirty = localSlots !== null;

  if (isLoading) return <p className="text-sm text-stone-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded border border-stone-700 p-0.5">
          {(['MATCHMAKING', 'TOURNAMENT'] as AvailabilityContext[]).map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => setContext(ctx)}
              className={[
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                context === ctx
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              {ctx === 'MATCHMAKING' ? 'Matchmaking' : 'Tournaments'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowHeatmap((v) => !v)}
          className="text-xs text-stone-400 hover:text-stone-200 underline"
        >
          {showHeatmap ? 'Show my grid' : 'Show community heatmap'}
        </button>
        {isDirty && (
          <Button size="sm" onClick={() => save.mutate(slots)} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {showHeatmap ? (
        <AvailabilityHeatmap slots={heatmapData?.slots ?? []} context={context} />
      ) : (
        <WeekAvailabilityGrid
          slots={slots}
          context={context}
          onChange={setLocalSlots}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Challenges Tab
// ---------------------------------------------------------------------------

function ChallengesTab({ currentUserId }: { currentUserId?: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formatFilter, setFormatFilter] = useState<MatchFormat | 'ALL'>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['scheduled-matchups', formatFilter],
    queryFn: () =>
      getScheduledMatchups(formatFilter !== 'ALL' ? { format: formatFilter } : undefined),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value as MatchFormat | 'ALL')} className="w-28">
            <option value="ALL">All formats</option>
            <option value="BO1">BO1</option>
            <option value="BO3">BO3</option>
            <option value="BO5">BO5</option>
          </Select>
        </div>
        {currentUserId && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Post a challenge</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Schedule a match</DialogTitle>
              </DialogHeader>
              <ScheduledMatchupForm onSuccess={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading && <p className="text-sm text-stone-400">Loading…</p>}

      {!isLoading && !data?.matchups.length && (
        <p className="text-sm text-stone-500">No open challenges yet. Be the first to post one!</p>
      )}

      <div className="space-y-2">
        {data?.matchups.map((m) => (
          <ScheduledMatchupCard key={m.id} matchup={m} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  );
}
