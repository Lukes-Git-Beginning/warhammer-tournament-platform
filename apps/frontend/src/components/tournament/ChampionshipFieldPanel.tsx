import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  getChampionshipField,
  openChampionshipAvailability,
  rsvpChampionship,
  seedChampionship,
  setChampionshipInviteRsvp,
  type ChampionshipFieldEntry,
  type ChampionshipFieldView,
  type RsvpValue,
} from '../../lib/api';
import { winChance } from '../meta/skillBands';

/**
 * The championship final's phase-aware field panel (monthly ladder invite/RSVP flow):
 *   PREVIEW      — the live top-N as of now (updates while the cycle is still running).
 *   AVAILABILITY — the full frozen ranking with each invitee's RSVP; invitees confirm/decline,
 *                  hosts/staff can decline on an invitee's behalf, admins seed from the confirmed.
 *   SEEDED       — the sealed field.
 * Polls every 20s so the live preview + others' RSVPs stay current without a socket push.
 */
export function ChampionshipFieldPanel({
  slug,
  canManage,
  isLoggedIn,
}: {
  slug: string;
  /** Staff, or a host/co-host staff put on this final: opens the round, sets RSVPs on an
   *  invitee's behalf, seeds. */
  canManage: boolean;
  isLoggedIn: boolean;
}) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['championship-field', slug],
    queryFn: () => getChampionshipField(slug),
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['championship-field', slug] });
    void qc.invalidateQueries({ queryKey: ['tournament', slug] });
    void qc.invalidateQueries({ queryKey: ['tournament-participants', slug] });
  };

  const rsvpMut = useMutation({
    mutationFn: (available: boolean) => rsvpChampionship(slug, available),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const openMut = useMutation({
    mutationFn: () => openChampionshipAvailability(slug),
    onSuccess: (r) => { setError(null); setNotice(`Availability round opened — ${r.invited} invited (Top ${r.fieldSize}).`); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const seedMut = useMutation({
    mutationFn: () => seedChampionship(slug),
    onSuccess: (r) => { setError(null); setNotice(`Seeded ${r.seeded} player${r.seeded === 1 ? '' : 's'}${r.plannedSize && r.seeded < r.plannedSize ? ` (planned Top ${r.plannedSize}, shrunk to fit)` : ''}.`); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const managerRsvpMut = useMutation({
    mutationFn: (v: { competitorId: string; rsvp: RsvpValue }) =>
      setChampionshipInviteRsvp(slug, v.competitorId, v.rsvp),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !data) return null;

  const isLadder = data.kind === 'MONTHLY_LADDER';
  const title = isLadder ? 'Monthly Ladder Invitational' : 'Quarterly Final';
  const availableCount = data.entries.filter((e) => e.rsvp === 'AVAILABLE').length;
  const busy = rsvpMut.isPending || openMut.isPending || seedMut.isPending || managerRsvpMut.isPending;

  const setFor = (e: ChampionshipFieldEntry, rsvp: 'AVAILABLE' | 'DECLINED') => {
    const msg = rsvp === 'DECLINED'
      ? `Mark ${e.username} as NOT playing? Their spot goes to the next confirmed player.`
      : `Mark ${e.username} as available to play?`;
    if (window.confirm(`${msg} They get a DM about it and can still change it themselves until the field is seeded.`)) {
      managerRsvpMut.mutate({ competitorId: e.competitorId, rsvp });
    }
  };
  const resetFor = (e: ChampionshipFieldEntry) =>
    managerRsvpMut.mutate({ competitorId: e.competitorId, rsvp: 'PENDING' });
  const showManagerControls = canManage && data.phase === 'AVAILABILITY';
  const linkCls = 'text-xs underline disabled:opacity-50';
  const managerActionFor = (e: ChampionshipFieldEntry): ReactNode => (
    <span className="flex gap-2">
      {e.rsvp !== 'AVAILABLE' && (
        <button type="button" disabled={busy} onClick={() => setFor(e, 'AVAILABLE')} title="They told you they can play"
          className={`${linkCls} text-emerald-300/80 hover:text-emerald-200`}>
          Available
        </button>
      )}
      {e.rsvp !== 'DECLINED' && (
        <button type="button" disabled={busy} onClick={() => setFor(e, 'DECLINED')} title="They told you they won't play"
          className={`${linkCls} text-red-300/80 hover:text-red-200`}>
          Decline
        </button>
      )}
      {e.rsvpByManager && (
        <button type="button" disabled={busy} onClick={() => resetFor(e)} title="Back to no response"
          className={`${linkCls} text-rizzotto-stone-400 hover:text-rizzotto-stone-200`}>
          Undo
        </button>
      )}
    </span>
  );

  return (
    <section className="rounded-lg border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-rizzotto-stone-100">{title} field</h3>
          <p className="text-sm text-rizzotto-stone-400">{phaseBlurb(data)}</p>
        </div>
        <div className="text-right text-sm text-rizzotto-stone-400">
          <div>Top {data.cutRank}{data.phase === 'AVAILABILITY' ? ` · ${availableCount} confirmed` : ''}</div>
          {data.deadline && data.phase !== 'SEEDED' && (
            <div className="text-amber-300">Confirm by {formatDeadline(data.deadline)}</div>
          )}
        </div>
      </header>

      {(notice || error) && (
        <div className={`mb-3 rounded px-3 py-2 text-sm ${error ? 'bg-red-900/40 text-red-300' : 'bg-emerald-900/40 text-emerald-300'}`}>
          {error ?? notice}
        </div>
      )}

      {/* Invitee RSVP controls */}
      {data.phase === 'AVAILABILITY' && isLoggedIn && data.viewerIsInvitee && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded bg-rizzotto-iron-800/60 px-3 py-2">
          <span className="text-sm text-rizzotto-stone-300">Can you play?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => rsvpMut.mutate(true)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${data.viewerRsvp === 'AVAILABLE' ? 'bg-emerald-600 text-white' : 'bg-emerald-900/50 text-emerald-200 hover:bg-emerald-800/60'} disabled:opacity-50`}
          >
            ✓ I'm available
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => rsvpMut.mutate(false)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${data.viewerRsvp === 'DECLINED' ? 'bg-red-700 text-white' : 'bg-red-900/40 text-red-200 hover:bg-red-800/50'} disabled:opacity-50`}
          >
            ✗ Can't make it
          </button>
          {data.viewerRsvp === 'PENDING' && <span className="text-xs text-amber-300">No response yet — you'll be treated as unavailable if you don't confirm.</span>}
        </div>
      )}

      {/* Manager controls (staff, or a host/co-host of this final) */}
      {canManage && (
        <div className="mb-3 flex flex-wrap gap-2">
          {data.phase === 'PREVIEW' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => openMut.mutate()}
              className="rounded bg-rizzotto-gold-600 px-3 py-1.5 text-sm font-medium text-rizzotto-iron-950 hover:bg-rizzotto-gold-500 disabled:opacity-50"
            >
              Open availability round
            </button>
          )}
          {data.phase === 'AVAILABILITY' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => seedMut.mutate()}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Seed from confirmed ({availableCount} available)
            </button>
          )}
        </div>
      )}

      <ol className="divide-y divide-rizzotto-iron-700/70">
        {data.entries.map((e) => (
          <FieldRow
            key={e.competitorId}
            entry={e}
            phase={data.phase}
            managerAction={showManagerControls ? managerActionFor(e) : null}
          />
        ))}
        {data.entries.length === 0 && (
          <li className="py-3 text-sm text-rizzotto-stone-400">
            No one qualifies yet. {isLadder ? 'Play ranked Open Play games to appear here.' : 'Not enough activity for a field yet.'}
          </li>
        )}
      </ol>

      {data.phase === 'AVAILABILITY' && (
        <p className="mt-3 text-xs text-rizzotto-stone-400">
          The field is the top {data.cutRank} of the confirmed. Highlighted rows would currently make it; the rest are the
          seed pool and move up as players above them decline. <Link to="/leaderboard" className="underline">See the board</Link>.
        </p>
      )}
    </section>
  );
}

function FieldRow({
  entry,
  phase,
  managerAction,
}: {
  entry: ChampionshipFieldEntry;
  phase: ChampionshipFieldView['phase'];
  managerAction?: ReactNode;
}) {
  const dimmed = phase === 'AVAILABILITY' && !entry.inField;
  return (
    <li className={`flex items-center gap-3 py-2 ${dimmed ? 'opacity-60' : ''}`}>
      <span className="w-6 text-right text-sm tabular-nums text-rizzotto-stone-400">{entry.rank}</span>
      {entry.avatarUrl ? (
        <img src={entry.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
      ) : (
        <span className="h-7 w-7 rounded-full bg-rizzotto-iron-700" />
      )}
      <Link to="/users/$id" params={{ id: entry.userId }} className="flex-1 truncate text-sm text-rizzotto-stone-100 hover:underline">
        {entry.username}
      </Link>
      {entry.points != null && <span className="text-xs tabular-nums text-rizzotto-stone-400">{Math.round(entry.points)} pts</span>}
      {entry.gs != null && entry.points == null && (
        <span className="text-xs tabular-nums text-rizzotto-stone-400" title="Win% vs the average player (from General Skill)">
          {Math.round(winChance(entry.gs))}% vs avg
        </span>
      )}
      <RowBadge entry={entry} phase={phase} />
      {managerAction}
    </li>
  );
}

function RowBadge({ entry, phase }: { entry: ChampionshipFieldEntry; phase: ChampionshipFieldView['phase'] }) {
  if (phase === 'SEEDED') {
    if (entry.status === 'DISQUALIFIED') return <Badge tone="red">DQ</Badge>;
    return <Badge tone="green">seeded #{entry.rank}</Badge>;
  }
  if (phase === 'AVAILABILITY') {
    const byHost = entry.rsvpByManager ? ' (host)' : '';
    const hostTitle = entry.rsvpByManager ? 'Set by the host on their behalf' : undefined;
    if (entry.rsvp === 'AVAILABLE') {
      return (
        <span title={hostTitle}>
          <Badge tone={entry.inField ? 'green' : 'stone'}>{entry.inField ? '✓ in' : '✓ reserve'}{byHost}</Badge>
        </span>
      );
    }
    if (entry.rsvp === 'DECLINED') return <span title={hostTitle}><Badge tone="red">declined{byHost}</Badge></span>;
    return <Badge tone="amber">pending</Badge>;
  }
  return <Badge tone="green">in</Badge>;
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'stone'; children: ReactNode }) {
  const cls = {
    green: 'bg-emerald-900/40 text-emerald-300',
    amber: 'bg-amber-900/40 text-amber-300',
    red: 'bg-red-900/40 text-red-300',
    stone: 'bg-rizzotto-iron-700 text-rizzotto-stone-300',
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function phaseBlurb(data: ChampionshipFieldView): string {
  const n = data.cutRank;
  if (data.phase === 'PREVIEW') return `Provisional field — the current Top ${n}. It updates as the cycle runs and locks when it ends.`;
  if (data.phase === 'AVAILABILITY') return `The cycle is closed. Invitees confirm availability; the field is the Top ${n} of those who do.`;
  return `The field is locked — ${n} seeded player${n === 1 ? '' : 's'}.`;
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  const abs = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (ms <= 0) return `${abs} (passed)`;
  const hours = Math.round(ms / 3_600_000);
  return hours >= 1 ? `${abs} (${hours}h left)` : `${abs} (soon)`;
}
