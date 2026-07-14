import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth, useAuthQuery } from '../lib/auth';
import {
  joinQueue,
  getMyAvailability,
  setMyAvailability,
  getAvailabilityHeatmap,
  getAvailabilityHeatmapNamed,
  getAvailabilityNow,
  getQueueStatus,
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
import { StandardRulesetCard } from '../components/tournament/StandardRulesetCard';

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

  const { data: queueStatus } = useQuery({
    queryKey: ['queue-status'],
    queryFn: getQueueStatus,
    refetchInterval: 30_000,
    enabled: !!me,
  });

  const { data: availabilityNow } = useQuery({
    queryKey: ['availability-now'],
    queryFn: getAvailabilityNow,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-100">Open Play</h1>
          <p className="text-sm text-stone-400 mt-1">
            Ranked matches outside of tournaments — all results count towards the leaderboard.
          </p>
        </div>
        {(queueStatus !== undefined || availabilityNow !== undefined) && (
          <div className="flex items-center gap-2 rounded border border-stone-800 bg-stone-900/60 px-3 py-1.5 text-xs text-stone-400">
            {queueStatus !== undefined && (
              <span>
                <span className="font-semibold text-stone-200">{queueStatus.total}</span>{' '}
                in queue
              </span>
            )}
            {queueStatus !== undefined && availabilityNow !== undefined && (
              <span className="text-stone-700">·</span>
            )}
            {availabilityNow !== undefined && (
              <span>
                <span className="font-semibold text-stone-200">{availabilityNow.count}</span>{' '}
                available now
              </span>
            )}
          </div>
        )}
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
        {activeTab === 'queue'        && <QueueTab userTimezone={me?.timezone ?? undefined} />}
        {activeTab === 'availability' && <AvailabilityTab currentUserId={me?.id} userTimezone={me?.timezone ?? undefined} />}
        {activeTab === 'challenges'   && <ChallengesTab currentUserId={me?.id} />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Queue Tab
// ---------------------------------------------------------------------------

function QueueTab({ userTimezone }: { userTimezone?: string }) {
  const qc = useQueryClient();
  const { data: me } = useAuthQuery();
  const isStaff = me?.role === 'ADMIN' || me?.role === 'MODERATOR';

  const join = useMutation({
    mutationFn: joinQueue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: () => getAvailabilityHeatmap(),
    staleTime: 5 * 60 * 1000,
  });

  // #12: staff also get per-slot names in the hover.
  const { data: namedHeatmap } = useQuery({
    queryKey: ['availability-heatmap-named', 'all'],
    queryFn: () => getAvailabilityHeatmapNamed(),
    enabled: isStaff,
    staleTime: 5 * 60 * 1000,
  });

  const allSlots = heatmapData?.slots ?? [];

  return (
    <div className="space-y-6">
      <div className="max-w-sm space-y-4">
        <p className="text-sm text-stone-300">
          Join the queue to be instantly matched with another available player. A random map is
          drawn and both players pick their faction blind — you'll receive a Discord DM when your
          match is found.
        </p>
        <StandardRulesetCard compact />
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
        <AvailabilityHeatmap slots={allSlots} userTimezone={userTimezone} namedSlots={namedHeatmap?.slots} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability Tab
// ---------------------------------------------------------------------------

function AvailabilityTab({ currentUserId, userTimezone }: { currentUserId?: string; userTimezone?: string }) {
  const [editContext, setEditContext] = useState<AvailabilityContext>('MATCHMAKING');
  const [view, setView] = useState<'mine' | 'matchmaking' | 'tournament'>('mine');
  const [localSlots, setLocalSlots] = useState<AvailabilitySlot[] | null>(null);
  const qc = useQueryClient();
  const { data: me } = useAuthQuery();
  const isStaff = me?.role === 'ADMIN' || me?.role === 'MODERATOR';

  const { data: myData, isLoading } = useQuery({
    queryKey: ['availability-me', currentUserId],
    queryFn: getMyAvailability,
    enabled: !!currentUserId,
  });

  const { data: mmHeatmap } = useQuery({
    queryKey: ['availability-heatmap', 'MATCHMAKING'],
    queryFn: () => getAvailabilityHeatmap('MATCHMAKING'),
    enabled: view === 'matchmaking',
    staleTime: 5 * 60 * 1000,
  });
  const { data: tournHeatmap } = useQuery({
    queryKey: ['availability-heatmap', 'TOURNAMENT'],
    queryFn: () => getAvailabilityHeatmap('TOURNAMENT'),
    enabled: view === 'tournament',
    staleTime: 5 * 60 * 1000,
  });

  // #12: staff-only per-slot names, fetched alongside the active heatmap view.
  const { data: mmNamed } = useQuery({
    queryKey: ['availability-heatmap-named', 'MATCHMAKING'],
    queryFn: () => getAvailabilityHeatmapNamed('MATCHMAKING'),
    enabled: isStaff && view === 'matchmaking',
    staleTime: 5 * 60 * 1000,
  });
  const { data: tournNamed } = useQuery({
    queryKey: ['availability-heatmap-named', 'TOURNAMENT'],
    queryFn: () => getAvailabilityHeatmapNamed('TOURNAMENT'),
    enabled: isStaff && view === 'tournament',
    staleTime: 5 * 60 * 1000,
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

        {/* small visual gap between the edit-context buttons and the view toggle */}
        <div aria-hidden className="w-2" />

        {/* View selector — own availability or either community heatmap */}
        <div className="flex gap-1 rounded border border-stone-700 bg-stone-900 p-0.5">
          {([
            ['mine', 'My Availability'],
            ['matchmaking', 'Matchmaking Heatmap'],
            ['tournament', 'Tournament Heatmap'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={[
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                view === v
                  ? v === 'matchmaking'
                    ? 'bg-amber-500/20 text-amber-400'
                    : v === 'tournament'
                      ? 'bg-sky-500/20 text-sky-400'
                      : 'bg-stone-700 text-stone-100'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {isDirty && (
          <Button size="sm" onClick={() => save.mutate(slots)} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {view === 'mine' ? (
        <WeekAvailabilityGrid
          slots={slots}
          editContext={editContext}
          onChange={setLocalSlots}
          userTimezone={userTimezone}
        />
      ) : view === 'matchmaking' ? (
        <AvailabilityHeatmap slots={mmHeatmap?.slots ?? []} userTimezone={userTimezone} hue={38} namedSlots={mmNamed?.slots} />
      ) : (
        <AvailabilityHeatmap slots={tournHeatmap?.slots ?? []} userTimezone={userTimezone} hue={199} namedSlots={tournNamed?.slots} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Challenges Tab
// ---------------------------------------------------------------------------

function ChallengesTab({ currentUserId }: { currentUserId?: string }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<MatchFormat>('BO3');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: () => getAvailabilityHeatmap(),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['scheduled-matchups'],
    queryFn: () => getScheduledMatchups(),
    refetchInterval: 30_000,
  });

  const matchmakingSlots = heatmapData?.slots ?? [];

  const isImmediate = selectedDate === null;

  const create = useMutation({
    mutationFn: () =>
      createScheduledMatchup({
        format,
        proposed_at: isImmediate ? new Date().toISOString() : selectedDate.toISOString(),
        notes: notes || undefined,
        ...(isImmediate ? { expires_in_hours: 0.5 } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      setSelectedDate(null);
      setShowNotes(false);
      setNotes('');
    },
  });

  const [acceptedInfo, setAcceptedInfo] = useState<{ proposed_at: string } | null>(null);
  const accept = useMutation({
    mutationFn: acceptScheduledMatchup,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      setAcceptedInfo({ proposed_at: result.proposed_at });
    },
  });

  const cancel = useMutation({
    mutationFn: cancelScheduledMatchup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-matchups'] }),
  });

  return (
    <div className="space-y-4">
      <StandardRulesetCard compact />
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

      {/* Dual-purpose calendar: view open challenges + pick your slot */}
      {isLoading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : (
        <>
          {acceptedInfo && (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/40 p-4 text-emerald-300 text-sm">
              Challenge accepted! Your match will start at{' '}
              <strong>{new Date(acceptedInfo.proposed_at).toLocaleString()}</strong>. You'll receive
              a Discord notification with the map when it's time to play.
              <button
                type="button"
                className="ml-3 text-emerald-500 underline text-xs"
                onClick={() => setAcceptedInfo(null)}
              >
                Dismiss
              </button>
            </div>
          )}
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
        </>
      )}

      {/* Post button — only shown when logged in */}
      {currentUserId && (
        <div className="space-y-3">
          {!showNotes ? (
            <Button
              size="lg"
              onClick={() => setShowNotes(true)}

            >
              Post a Challenge
            </Button>
          ) : (
            <div className="space-y-3 max-w-sm">
              {isImmediate && (
                <p className="text-xs text-amber-400/90 rounded border border-amber-800/40 bg-amber-950/30 px-3 py-2">
                  You're about to post an <strong>immediate challenge</strong> — it expires in 30 minutes if no one accepts. To schedule a specific time, pick a slot in the calendar first.
                </p>
              )}
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
