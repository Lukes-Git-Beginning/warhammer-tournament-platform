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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { QueueStatusCard } from '../components/open-play/QueueStatusCard';
import { WeekAvailabilityGrid } from '../components/open-play/WeekAvailabilityGrid';
import { AvailabilityHeatmap } from '../components/open-play/AvailabilityHeatmap';
import { ScheduledMatchupCard } from '../components/open-play/ScheduledMatchupCard';
import { ScheduledMatchupForm } from '../components/open-play/ScheduledMatchupForm';

type Tab = 'queue' | 'availability' | 'challenges';

const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'availability', label: 'Availability' },
  { id: 'challenges', label: 'Challenges' },
];

export function OpenPlayPage() {
  useRequireAuth();
  const { data: me } = useAuthQuery();
  const [activeTab, setActiveTab] = useState<Tab>('queue');

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-100">Open Play</h1>
        <p className="text-sm text-stone-400 mt-1">
          Ranked matches outside of tournaments — all results count towards the leaderboard.
        </p>
      </div>

      <QueueStatusCard />

      {/* Tabs — same design as Leaderboard / Tournaments */}
      <div className="flex gap-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-1 w-fit">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === id
                ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === 'queue'        && <QueueTab />}
        {activeTab === 'availability' && <AvailabilityTab currentUserId={me?.id} />}
        {activeTab === 'challenges'   && <ChallengesTab currentUserId={me?.id} />}
      </div>
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
        Join the live queue to be instantly matched with another player. When two players queue
        for the same format, a match is created with a random map and blind faction pick — both
        receive a Discord DM.
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
          <a href={`/matches/${join.data.match_id}`} className="underline hover:text-green-300">
            Open match →
          </a>
        </p>
      )}
      {join.error && <p className="text-sm text-red-400">{String(join.error)}</p>}
      <p className="text-xs text-stone-500">
        Results count towards the leaderboard when both players confirm and one uploads the replay.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability Tab
// ---------------------------------------------------------------------------

function AvailabilityTab({ currentUserId }: { currentUserId?: string }) {
  const [editContext, setEditContext] = useState<AvailabilityContext>('MATCHMAKING');
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
      setMyAvailability(
        slots.map(({ day_of_week, hour_utc, context }) => ({ day_of_week, hour_utc, context })),
      ),
    onSuccess: (data) => {
      qc.setQueryData(['availability-me', currentUserId], data);
      setLocalSlots(null);
    },
  });

  const slots = localSlots ?? myData?.slots ?? [];
  const isDirty = localSlots !== null;

  if (isLoading) return <p className="text-sm text-stone-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Edit-mode selector — controls which context dragging affects */}
        <div className="flex gap-1 rounded border border-stone-700 bg-stone-900 p-0.5">
          {(['MATCHMAKING', 'TOURNAMENT'] as AvailabilityContext[]).map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => setEditContext(ctx)}
              className={[
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                editContext === ctx
                  ? ctx === 'MATCHMAKING'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-sky-500/20 text-sky-400'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              {ctx === 'MATCHMAKING' ? 'Edit Matchmaking' : 'Edit Tournaments'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowHeatmap((v) => !v)}
          className="text-xs text-stone-400 hover:text-stone-200 underline"
        >
          {showHeatmap ? 'My availability' : 'Community heatmap'}
        </button>

        {isDirty && (
          <Button size="sm" onClick={() => save.mutate(slots)} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {showHeatmap ? (
        <AvailabilityHeatmap slots={heatmapData?.slots ?? []} />
      ) : (
        <WeekAvailabilityGrid
          slots={slots}
          editContext={editContext}
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
        <Select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value as MatchFormat | 'ALL')} className="w-32">
          <option value="ALL">All formats</option>
          <option value="BO1">BO1</option>
          <option value="BO3">BO3</option>
          <option value="BO5">BO5</option>
        </Select>

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
