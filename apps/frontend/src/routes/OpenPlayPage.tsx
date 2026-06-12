import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRequireAuth, useAuthQuery } from '../lib/auth';
import {
  joinQueue,
  getMyAvailability,
  setMyAvailability,
  getAvailabilityHeatmap,
  getScheduledMatchups,
  createScheduledMatchup,
  acceptScheduledMatchup,
  cancelScheduledMatchup,
  getMyOpenPlayMatch,
  type AvailabilitySlot,
  type AvailabilityContext,
  type HeatmapSlot,
  type MatchFormat,
} from '../lib/api';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { QueueStatusCard } from '../components/open-play/QueueStatusCard';
import { WeekAvailabilityGrid } from '../components/open-play/WeekAvailabilityGrid';
import { AvailabilityHeatmap } from '../components/open-play/AvailabilityHeatmap';
import { ChallengeCalendar } from '../components/open-play/ChallengeCalendar';

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

  const { data: activeMatch } = useQuery({
    queryKey: ['my-open-play-match'],
    queryFn: getMyOpenPlayMatch,
    enabled: !!me,
    refetchInterval: 15_000,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-100">Open Play</h1>
        <p className="text-sm text-stone-400 mt-1">
          Ranked matches outside of tournaments — all results count towards the leaderboard.
        </p>
      </div>

      <QueueStatusCard />

      {/* Active match banner — shown when the user has an ongoing Open Play match */}
      {activeMatch?.match_id && (
        <a
          href={`/matches/${activeMatch.match_id}`}
          className="flex items-center justify-between rounded border border-rizzotto-gold-500/40 bg-rizzotto-gold-500/10 px-4 py-3 hover:bg-rizzotto-gold-500/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rizzotto-gold-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rizzotto-gold-500" />
            </span>
            <span className="text-sm text-rizzotto-stone-200 font-medium">You have an active match</span>
          </div>
          <span className="text-xs text-rizzotto-gold-400">Open match →</span>
        </a>
      )}

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
  const qc = useQueryClient();

  const join = useMutation({
    mutationFn: joinQueue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: getAvailabilityHeatmap,
    staleTime: 5 * 60 * 1000,
  });

  const matchmakingSlots: HeatmapSlot[] = (heatmapData?.slots ?? []).filter(
    (s) => s.context === 'MATCHMAKING',
  );

  return (
    <div className="space-y-6">
      <div className="max-w-sm space-y-4">
        <p className="text-sm text-stone-300">
          Join the queue to be instantly matched with another available player. A random map is
          drawn and both players pick their faction blind — you'll receive a Discord DM when your
          match is found.
        </p>
        <Button size="lg" onClick={() => join.mutate()} disabled={join.isPending}>
          {join.isPending ? 'Joining...' : 'Join Queue'}
        </Button>
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
          Counts towards the leaderboard when a replay is submitted via the bot and the reported outcome goes uncontested.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-300">When are people usually around?</p>
        <p className="text-xs text-stone-500">
          Community matchmaking availability — brighter means more players have marked this time as free.
        </p>
        <AvailabilityHeatmap slots={matchmakingSlots} />
      </div>
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [format, setFormat] = useState<MatchFormat>('BO3');
  const [anonymous, setAnonymous] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: getAvailabilityHeatmap,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['scheduled-matchups'],
    queryFn: () => getScheduledMatchups(),
    refetchInterval: 30_000,
  });

  const matchmakingSlots: HeatmapSlot[] = (heatmapData?.slots ?? []).filter(
    (s) => s.context === 'MATCHMAKING',
  );

  const create = useMutation({
    mutationFn: () =>
      createScheduledMatchup({
        format,
        proposed_at: selectedDate!.toISOString(),
        notes: notes || undefined,
        anonymous,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      setSelectedDate(null);
      setShowNotes(false);
      setNotes('');
    },
  });

  const accept = useMutation({
    mutationFn: acceptScheduledMatchup,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      void navigate({ to: '/matches/$matchId', params: { matchId: result.match_id } });
    },
  });

  const cancel = useMutation({
    mutationFn: cancelScheduledMatchup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-matchups'] }),
  });

  return (
    <div className="space-y-4">
      {/* Format + Anonymous — side by side */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-400">Format</span>
          <Select
            value={format}
            onChange={(e) => setFormat(e.target.value as MatchFormat)}
            className="w-44"
          >
            <option value="BO1">BO1 (~30 min)</option>
            <option value="BO3">BO3 (~90 min)</option>
            <option value="BO5">BO5 (~150 min)</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-amber-500"
          />
          <span className="text-sm text-stone-300">Anonymous</span>
        </label>
      </div>

      {/* Dual-purpose calendar: view open challenges + pick your slot */}
      {isLoading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : (
        <ChallengeCalendar
          format={format}
          slots={matchmakingSlots}
          selected={selectedDate}
          onSelect={setSelectedDate}
          matchups={data?.matchups}
          currentUserId={currentUserId}
          onAccept={(id) => accept.mutate(id)}
          onCancel={(id) => cancel.mutate(id)}
        />
      )}

      {/* Post button — only shown when logged in */}
      {currentUserId && (
        <div className="space-y-3">
          {!showNotes ? (
            <Button
              size="lg"
              onClick={() => setShowNotes(true)}
              disabled={!selectedDate}
            >
              Post a Challenge
            </Button>
          ) : (
            <div className="space-y-3 max-w-sm">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note — e.g. any faction welcome, looking for a close game"
                maxLength={500}
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => create.mutate()}
                  disabled={create.isPending}
                >
                  {create.isPending ? 'Posting…' : 'Confirm'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setShowNotes(false); setNotes(''); }}
                  className="text-sm text-stone-400 hover:text-stone-200 transition-colors px-2"
                >
                  Back
                </button>
              </div>
              {create.error && (
                <p className="text-xs text-red-400">{String(create.error)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
