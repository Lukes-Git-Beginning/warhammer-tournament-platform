import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { getFactions, getWeeklyBan, resetAdminUserWeeklyBan, setWeeklyBan } from '@/lib/api';
import { formatInUserTimezone } from '@/lib/timezone';

/**
 * The weekly Open Play ban on a profile (plans/discord-open-play.md §11): one faction, banned for both players in
 * every Open Play match of its owner. A new one can be set 7 days after the last one; dropping it works any time and
 * leaves that lock running. Editable on your own profile, shown on everyone's once set; an admin can clear it
 * together with its lock.
 */
export function WeeklyBanSection({ userId, isOwn, isAdmin }: { userId: string; isOwn: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: ban } = useQuery({ queryKey: ['weekly-ban', userId], queryFn: () => getWeeklyBan(userId) });
  const { data: factionsData } = useQuery({ queryKey: ['factions'], queryFn: () => getFactions(), staleTime: 60 * 60_000 });
  // The select's value while it differs from the saved ban; null = shows the saved one.
  const [draft, setDraft] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (factionId: string | null) => setWeeklyBan(factionId),
    onSuccess: (next) => {
      qc.setQueryData(['weekly-ban', userId], next);
      setDraft(null);
    },
  });
  const reset = useMutation({
    mutationFn: () => resetAdminUserWeeklyBan(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-ban', userId] }),
  });

  if (!ban || (!isOwn && !ban.factionId && !isAdmin)) return null;
  const factions = factionsData?.data.map((f) => f.faction) ?? [];
  // A faction the Standard Ruleset bans everywhere would ban nothing; the saved one stays listed so the select shows it.
  const choices = factions.filter((f) => !ban.rulesetBanned.includes(f.id) || f.id === ban.factionId);
  const nameOf = (id: string | null) => (id ? (factions.find((f) => f.id === id)?.name ?? id) : 'No ban');
  const opensAt = ban.opensAt ? formatInUserTimezone(ban.opensAt) : null;
  const value = draft ?? ban.factionId ?? '';
  const changed = value !== '' && value !== ban.factionId;

  function submit() {
    if (!window.confirm(`Make ${nameOf(value)} your weekly ban? You can't change it again for 7 days.`)) return;
    save.mutate(value);
  }

  const savedName = nameOf(ban.factionId);
  function drop() {
    const newOne = opensAt ? `You can set a new one on ${opensAt}.` : 'You can set a new one any time.';
    const text = `Drop your weekly ban? ${savedName} is no longer banned in your new Open Play matches; matches already under way keep it. ${newOne}`;
    if (!window.confirm(text)) return;
    save.mutate(null);
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-3">Weekly Open Play ban</h2>
      {isOwn ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={value}
              disabled={!!opensAt || save.isPending}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none disabled:opacity-60"
            >
              {!ban.factionId && <option value="">No ban</option>}
              {choices.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={!changed || !!opensAt || save.isPending}
              className="rounded border border-rizzotto-gold-600 px-3 py-1.5 text-sm text-rizzotto-gold-400 hover:bg-rizzotto-gold-900/20 disabled:opacity-40 transition-colors"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {ban.factionId && (
              <button
                type="button"
                onClick={drop}
                disabled={save.isPending}
                className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-40 transition-colors"
              >
                Drop ban
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {ban.covered
              ? `The Standard Ruleset already bans ${savedName} in every Open Play game, so you can pick another one now.`
              : <>
                  Banned for both players in every Open Play match of yours.{' '}
                  {opensAt
                    ? ban.factionId
                      ? `You can change it on ${opensAt}, or drop it any time.`
                      : `You can set a new one on ${opensAt}.`
                    : 'Once saved, you can change it again after 7 days, and drop it any time.'}
                </>}
          </p>
          {save.error && <p className="mt-1 text-xs text-red-400">{save.error.message}</p>}
        </>
      ) : ban.factionId ? (
        <p className="text-sm text-stone-300">
          <span className="font-semibold text-stone-100">{nameOf(ban.factionId)}</span>
          <span className="text-stone-500"> · banned for both players in his Open Play matches</span>
        </p>
      ) : (
        <p className="text-sm text-stone-500">No weekly ban set.</p>
      )}
      {isAdmin && (ban.factionId || ban.opensAt) && (
        <button
          type="button"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          className="mt-2 text-[10px] font-mono uppercase tracking-wider text-stone-500 hover:text-stone-300 disabled:opacity-40"
          title="Clear the ban and its 7-day lock, so the player can set a new one at once"
        >
          {reset.isPending ? 'Resetting…' : 'Admin · reset weekly ban'}
        </button>
      )}
    </section>
  );
}

/** One line for the queue settings: your weekly ban, with the way to your profile to set or change it. */
export function WeeklyBanHint({ userId }: { userId: string }) {
  const { data: ban } = useQuery({ queryKey: ['weekly-ban', userId], queryFn: () => getWeeklyBan(userId) });
  const { data: factionsData } = useQuery({ queryKey: ['factions'], queryFn: () => getFactions(), staleTime: 60 * 60_000 });
  if (!ban) return null;
  const name = ban.factionId ? (factionsData?.data.find((f) => f.faction.id === ban.factionId)?.faction.name ?? ban.factionId) : null;
  return (
    <p className="text-xs text-stone-500">
      {name && ban.covered ? (
        <>
          Your weekly ban: <span className="font-semibold text-stone-300">{name}</span>, which the Standard Ruleset already
          bans in every Open Play game.{' '}
        </>
      ) : name ? (
        <>
          Your weekly ban: <span className="font-semibold text-stone-300">{name}</span>, banned for both players in your
          matches.{' '}
        </>
      ) : (
        'You can ban one faction for both players in all your matches. '
      )}
      <Link to="/users/$id" params={{ id: userId }} className="underline hover:text-rizzotto-gold-400 transition-colors">
        {name ? 'Change it on your profile' : 'Set it on your profile'}
      </Link>
    </p>
  );
}
