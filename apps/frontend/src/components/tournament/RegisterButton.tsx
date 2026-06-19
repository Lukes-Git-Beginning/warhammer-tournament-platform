import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { registerForTournament, withdrawFromTournament, getFactions } from '@/lib/api';
import type { Tournament, ParticipantStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { cn } from '@/lib/utils';

export interface RegisterButtonProps {
  tournament: Tournament;
  participantStatus: ParticipantStatus | null;
  isLoggedIn: boolean;
}

function FactionSelectGrid({
  selected,
  onSelect,
  allowedFactionIds,
}: {
  selected: string;
  onSelect: (id: string) => void;
  allowedFactionIds?: string[];
}) {
  const { data } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const factions = (data?.data ?? [])
    .map((e) => e.faction)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Empty allowlist means all factions are permitted
  const hasRestriction = allowedFactionIds != null && allowedFactionIds.length > 0;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {factions.map((f) => {
        const isSelected = selected === f.id;
        const isDisabled = hasRestriction && !allowedFactionIds!.includes(f.id);
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => !isDisabled && onSelect(f.id)}
            disabled={isDisabled}
            title={isDisabled ? 'Not permitted in this tournament' : undefined}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center transition-[border-color,background-color] duration-base ease-burn',
              isDisabled
                ? 'cursor-not-allowed opacity-40 border-rizzotto-iron-700 bg-rizzotto-iron-900'
                : isSelected
                  ? 'border-rizzotto-gold-500 bg-rizzotto-iron-800'
                  : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
            )}
          >
            <FactionBadge
              size="lg"
              colorHex={f.color_hex}
              initials={f.initials}
              name={f.name}
              iconUrl={f.icon_url}
            />
            <span className={cn(
              'line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide',
              isSelected ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300',
            )}>
              {f.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function RegisterButton({ tournament, participantStatus, isLoggedIn }: RegisterButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [pickingFaction, setPickingFaction] = useState(false);
  const [selectedFaction, setSelectedFaction] = useState('');

  const needsFactionPick = tournament.mode === 'SFT';

  const register = useMutation({
    mutationFn: (factionId?: string) =>
      registerForTournament(tournament.slug, factionId ? { factionId } : undefined),
    onSuccess: () => {
      setPickingFaction(false);
      setSelectedFaction('');
      void queryClient.invalidateQueries({ queryKey: ['tournament', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['participant-me', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', tournament.slug] });
    },
  });

  const withdraw = useMutation({
    mutationFn: () => withdrawFromTournament(tournament.slug),
    onSuccess: () => {
      setConfirmingWithdraw(false);
      void queryClient.invalidateQueries({ queryKey: ['tournament', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['participant-me', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', tournament.slug] });
    },
  });

  if (tournament.status !== 'OPEN_REGISTRATION') return null;

  if (participantStatus === 'REGISTERED' || participantStatus === 'CHECKED_IN') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-md border border-rizzotto-success/40 bg-rizzotto-success/10 px-4 py-2.5">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-rizzotto-success shrink-0" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-semibold text-rizzotto-success">
            {t('tournament.register.confirmed')}
          </span>
        </div>
        {!confirmingWithdraw ? (
          <button type="button" onClick={() => setConfirmingWithdraw(true)} className="rounded border border-stone-600 px-3 py-1 text-xs text-stone-400 hover:border-rizzotto-danger hover:text-rizzotto-danger transition-colors self-start">
            Withdraw from tournament
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-rizzotto-stone-400">Are you sure?</span>
            <button type="button" onClick={() => withdraw.mutate()} disabled={withdraw.isPending} className="text-xs text-rizzotto-danger hover:text-red-300 transition-colors disabled:opacity-50">
              {withdraw.isPending ? 'Withdrawing…' : 'Yes, withdraw'}
            </button>
            <button type="button" onClick={() => setConfirmingWithdraw(false)} className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors">
              Cancel
            </button>
          </div>
        )}
        {withdraw.isError && (
          <span className="text-xs text-rizzotto-danger">{(withdraw.error as Error).message}</span>
        )}
      </div>
    );
  }

  if (participantStatus === 'WITHDREW' || participantStatus === 'DISQUALIFIED') return null;

  if (!isLoggedIn) {
    return (
      <Link to="/login" className="inline-flex items-center rounded border border-rizzotto-gold-500 px-4 py-2 text-sm font-semibold text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 transition-colors">
        {t('tournament.register.login_required')}
      </Link>
    );
  }

  const isFull = tournament.max_participants != null && (tournament.participantCount ?? 0) >= tournament.max_participants;
  if (isFull) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-4 py-2.5">
        <span className="text-sm text-rizzotto-stone-400">{t('tournament.register.full')}</span>
      </div>
    );
  }

  if (needsFactionPick && pickingFaction) {
    return (
      <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-rizzotto-stone-200 mb-1">Choose your faction</p>
          <p className="text-xs text-rizzotto-stone-500">
            SFT — Single Faction Tournament. Your faction is locked for the entire event.
          </p>
        </div>
        <FactionSelectGrid
          selected={selectedFaction}
          onSelect={setSelectedFaction}
          allowedFactionIds={tournament.faction_allowlist}
        />
        {register.isError && (
          <p className="text-xs text-rizzotto-danger">{(register.error as Error).message}</p>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="forge"
            size="md"
            disabled={!selectedFaction || register.isPending}
            onClick={() => register.mutate(selectedFaction)}
          >
            {register.isPending ? t('tournament.register.pending') : 'Confirm Registration'}
          </Button>
          <button type="button" onClick={() => { setPickingFaction(false); setSelectedFaction(''); }} className="text-sm text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="forge"
        size="md"
        disabled={register.isPending}
        onClick={() => {
          if (needsFactionPick) {
            setPickingFaction(true);
          } else {
            register.mutate(undefined);
          }
        }}
      >
        {register.isPending ? t('tournament.register.pending') : t('tournament.register.cta')}
      </Button>
      {register.isError && (
        <span className="text-xs text-rizzotto-danger">{(register.error as Error).message}</span>
      )}
    </div>
  );
}
