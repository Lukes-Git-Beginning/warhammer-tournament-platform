import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  registerForTournament,
  requestJoinTournament,
  withdrawFromTournament,
  getFactions,
  getTakenFactions,
  getPlayerClassification,
} from '@/lib/api';
import type { Tournament, ParticipantStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { CalibrationWizard } from '@/components/meta/CalibrationWizard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Band map — mirrors PlayerLevelScale.tsx but kept local to avoid coupling
// ---------------------------------------------------------------------------
const BANDS: { name: string; color: string; text: string }[] = [
  { name: 'New',          color: 'bg-stone-100',           text: 'text-stone-100'          },
  { name: 'Beginner',     color: 'bg-orange-800',          text: 'text-orange-600'         },
  { name: 'Intermediate', color: 'bg-[#c17f38]',           text: 'text-[#cd9557]'          },
  { name: 'Advanced',     color: 'bg-slate-400',           text: 'text-slate-300'          },
  { name: 'Top',          color: 'bg-rizzotto-gold-400',   text: 'text-rizzotto-gold-400'  },
];

// ---------------------------------------------------------------------------
// Faction grid (unchanged)
// ---------------------------------------------------------------------------
function FactionSelectGrid({
  selected,
  onToggle,
  pickCount,
  allowedFactionIds,
  restrictedFactionIds,
  takenFactionIds,
  onSetSelected,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  pickCount: number;
  allowedFactionIds?: string[];
  restrictedFactionIds?: string[];
  /** FACTION_WAR: faction ids already claimed by other players — greyed out + unpickable. */
  takenFactionIds?: string[];
  /** When provided, enables a "Random" button that fills the selection with
   *  `pickCount` random pickable factions (respecting the allowlist). */
  onSetSelected?: (ids: string[]) => void;
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
  const isTaken = (id: string): boolean => takenFactionIds != null && takenFactionIds.includes(id);

  // Pickable pool for "Random" — allowlist is respected, but restricted factions
  // stay eligible (they are nerfed, not banned). Taken factions (Faction War) are out.
  const pickable = factions.filter(
    (f) => !(hasRestriction && !allowedFactionIds!.includes(f.id)) && !isTaken(f.id),
  );

  function pickRandom() {
    if (pickable.length === 0) return;
    const pool = [...pickable];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    onSetSelected?.(pool.slice(0, Math.min(pickCount, pool.length)).map((f) => f.id));
  }

  return (
    <div className="space-y-2">
      {onSetSelected && pickable.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={pickRandom}
            className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-2.5 py-1 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300"
          >
            🎲 {pickCount > 1 ? `Random ${pickCount}` : 'Random'}
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {factions.map((f) => {
        const isSelected = selected.includes(f.id);
        // Restricted factions are nerfed, not banned — keep them pickable; only
        // an allowlist actually forbids a faction.
        const isRestricted = restrictedFactionIds != null && restrictedFactionIds.includes(f.id);
        const isFull = pickCount > 1 && !isSelected && selected.length >= pickCount;
        const taken = isTaken(f.id) && !isSelected;
        const isDisabled = (hasRestriction && !allowedFactionIds!.includes(f.id)) || isFull || taken;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => !isDisabled && onToggle(f.id)}
            disabled={isDisabled}
            title={
              taken
                ? 'Already claimed by another player in this tournament'
                : isFull
                  ? `Pick limit reached (${pickCount})`
                  : hasRestriction && !allowedFactionIds!.includes(f.id)
                    ? 'Not permitted in this tournament'
                    : isRestricted
                      ? 'Restricted (nerfed) — games with this faction do not count toward the leaderboard'
                      : undefined
            }
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Band picker dialog for BALANCED_LIECHTENSTEIN
// ---------------------------------------------------------------------------
function BandPickerDialog({
  open,
  onOpenChange,
  userId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onConfirm: (band: number) => void;
}) {
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [selectedBand, setSelectedBand] = useState<number | null>(null);

  const { data: classification, refetch } = useQuery({
    queryKey: ['player-classification', userId],
    queryFn: () => getPlayerClassification(userId),
    enabled: open,
    retry: false,
  });

  // After calibration wizard closes, refresh classification and keep band picker open
  function handleCalibrationClose(isOpen: boolean) {
    setCalibrationOpen(isOpen);
    if (!isOpen) {
      void refetch();
    }
  }

  // matchmakingBand is 1-based (1..5); BANDS array is 0-based
  const currentBand = classification?.matchmakingBand ?? 1;
  const bandName   = classification?.bandName ?? 'New';
  const needsCalibration = classification != null && !classification.hasQuestionnaire;

  // Pre-select currentBand when data arrives (only if not manually chosen yet)
  const effectiveBand = selectedBand ?? currentBand;

  function handleOpen() {
    if (needsCalibration && !calibrationOpen) {
      setCalibrationOpen(true);
      return;
    }
  }

  // Sync when dialog opens: show calibration if needed, otherwise show picker
  // We derive via render — if calibration is needed we show CalibrationWizard and
  // suppress the band picker body.
  const showPicker = !calibrationOpen;

  return (
    <>
      <CalibrationWizard
        userId={userId}
        open={calibrationOpen}
        onOpenChange={handleCalibrationClose}
      />

      <Dialog open={open && showPicker} onOpenChange={(o) => {
        if (!o) {
          setSelectedBand(null);
          onOpenChange(false);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose your division</DialogTitle>
            <DialogDescription>
              {classification == null
                ? 'Loading your classification…'
                : needsCalibration
                  ? 'Complete a quick calibration first to set your starting level.'
                  : `You are rated as ${bandName}. You can compete at your level or higher — higher means stronger opponents and a higher division. You cannot play below your rated level.`
              }
            </DialogDescription>
          </DialogHeader>

          {classification == null ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-rizzotto-gold-500 border-t-transparent" />
            </div>
          ) : needsCalibration ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-rizzotto-stone-400">
                We need a few quick answers to set your starting band before you can register.
              </p>
              <Button variant="etched" size="sm" onClick={handleOpen}>
                Answer a few questions →
              </Button>
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {/* Highest division first (Top → New); each row keeps its own level via
                  the original index, only the display order is reversed. */}
              {BANDS.map((band, i) => {
                // i is 0-based; currentBand is 1-based → compare i+1 vs currentBand
                const bandNumber = i + 1;
                const isDisabled = bandNumber < currentBand;
                const isSelected = effectiveBand === bandNumber;
                return (
                  <button
                    key={band.name}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && setSelectedBand(bandNumber)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-4 py-2.5 text-left text-sm transition-colors',
                      isDisabled
                        ? 'cursor-not-allowed border-rizzotto-iron-700 bg-rizzotto-iron-900 opacity-40'
                        : isSelected
                          ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10'
                          : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
                    )}
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', band.color)} />
                    <span className={cn('font-semibold', isSelected ? 'text-rizzotto-gold-300' : band.text)}>
                      {band.name}
                    </span>
                    {bandNumber === currentBand && (
                      <span className="ml-auto text-xs text-rizzotto-stone-500">your level</span>
                    )}
                  </button>
                );
              }).reverse()}
            </div>
          )}

          {classification != null && !needsCalibration && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="forge"
                size="md"
                onClick={() => {
                  onConfirm(effectiveBand);
                  setSelectedBand(null);
                  onOpenChange(false);
                }}
              >
                Confirm Registration
              </Button>
              <button
                type="button"
                onClick={() => { setSelectedBand(null); onOpenChange(false); }}
                className="text-sm text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface RegisterButtonProps {
  tournament: Tournament;
  participantStatus: ParticipantStatus | null;
  isLoggedIn: boolean;
  /** Required for BALANCED_LIECHTENSTEIN band selection. */
  userId?: string;
}

export function RegisterButton({ tournament, participantStatus, isLoggedIn, userId }: RegisterButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [pickingFaction, setPickingFaction] = useState(false);
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [pickingBand, setPickingBand] = useState(false);
  // FREE_PICK: first the player chooses a fixed faction (SFT-like) or to pick
  // match-by-match; 'fixed' then flows into the normal faction picker.
  const [freePickChoice, setFreePickChoice] = useState<'fixed' | 'later' | null>(null);
  const [choosingFreePick, setChoosingFreePick] = useState(false);
  // Balanced Liechtenstein + Free Pick: the skill band is chosen first, then the
  // Free Pick choice — carry the band through so the final register call keeps it.
  const [requestedBand, setRequestedBand] = useState<number | null>(null);

  const isFreePick = tournament.mode === 'FREE_PICK';
  const isFactionWar = tournament.mode === 'FACTION_WAR';
  const needsFactionPick =
    tournament.mode === 'SFT' ||
    tournament.mode === 'TWO_D_THREE' ||
    isFactionWar ||
    (isFreePick && freePickChoice === 'fixed');
  const pickCount = tournament.mode === 'TWO_D_THREE' ? 3 : 1;

  // FACTION_WAR: the factions already claimed by other players, so the picker can grey
  // them out. Refetched whenever the picker opens so a just-taken faction disappears.
  const { data: takenData } = useQuery({
    queryKey: ['tournament-taken-factions', tournament.slug],
    queryFn: () => getTakenFactions(tournament.slug),
    enabled: isFactionWar && pickingFaction,
    staleTime: 10_000,
  });
  const takenFactionIds = isFactionWar ? (takenData?.takenFactionIds ?? []) : undefined;
  const isBalancedLiechtenstein = tournament.format === 'BALANCED_LIECHTENSTEIN';

  const toggleFaction = (id: string) =>
    setSelectedFactions((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (pickCount === 1) return [id];
      if (prev.length >= pickCount) return prev;
      return [...prev, id];
    });

  // Late-join: after start, when the host enabled it, the same sign-up flow submits
  // a join REQUEST (pending host approval) instead of entering directly.
  const lateJoinMode = tournament.status === 'ONGOING' && !!tournament.allow_late_join_requests;
  const register = useMutation({
    mutationFn: (opts?: { requested_band?: number }) => {
      const submit = lateJoinMode ? requestJoinTournament : registerForTournament;
      return pickCount > 1
        ? submit(tournament.slug, { factionIds: selectedFactions, ...opts })
        : submit(tournament.slug, selectedFactions[0] ? { factionId: selectedFactions[0], ...opts } : opts);
    },
    onSuccess: () => {
      setPickingFaction(false);
      setSelectedFactions([]);
      setChoosingFreePick(false);
      setFreePickChoice(null);
      setRequestedBand(null);
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

  if (tournament.status !== 'OPEN_REGISTRATION' && !lateJoinMode) return null;

  // Late-join (tournament already running): existing participants need no CTA; a
  // pending requester sees a note; everyone else falls through to the request flow.
  if (lateJoinMode) {
    if (participantStatus === 'REGISTERED' || participantStatus === 'CHECKED_IN' || participantStatus === 'DISQUALIFIED') {
      return null;
    }
    if (participantStatus === 'JOIN_REQUESTED') {
      return (
        <div className="flex items-center gap-2 rounded-md border border-rizzotto-gold-500/40 bg-rizzotto-gold-500/10 px-4 py-2.5">
          <span className="text-sm font-semibold text-rizzotto-gold-300">Join request pending host approval…</span>
        </div>
      );
    }
  }

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

  // Disqualified players can't rejoin; withdrawn players may re-register before
  // start (the register endpoint reactivates their row) — fall through below.
  if (participantStatus === 'DISQUALIFIED') return null;
  const isReRegister = participantStatus === 'WITHDREW';

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
    const is2D3 = tournament.mode === 'TWO_D_THREE';
    return (
      <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-rizzotto-stone-200 mb-1">
            {is2D3 ? 'Choose your 3 factions' : 'Choose your faction'}
          </p>
          <p className="text-xs text-rizzotto-stone-500">
            {is2D3
              ? 'Pick exactly 3 factions. One of them is drawn at random for you before each game.'
              : isFreePick
                ? 'Free Pick — this faction is locked for the whole event and revealed to others at start.'
                : 'SFT — Single Faction Tournament. Your faction is locked for the entire event.'}
          </p>
          {is2D3 && (
            <p className="mt-1 text-xs">
              <span className={cn('font-semibold', selectedFactions.length === pickCount ? 'text-rizzotto-gold-400' : 'text-rizzotto-stone-300')}>
                {selectedFactions.length}/{pickCount}
              </span>{' '}
              <span className="text-rizzotto-stone-500">selected</span>
            </p>
          )}
        </div>
        <FactionSelectGrid
          selected={selectedFactions}
          onToggle={toggleFaction}
          pickCount={pickCount}
          allowedFactionIds={tournament.faction_allowlist}
          restrictedFactionIds={tournament.restricted_factions}
          takenFactionIds={takenFactionIds}
          onSetSelected={setSelectedFactions}
        />
        {register.isError && (
          <p className="text-xs text-rizzotto-danger">{(register.error as Error).message}</p>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="forge"
            size="md"
            disabled={selectedFactions.length !== pickCount || register.isPending}
            onClick={() => register.mutate(requestedBand != null ? { requested_band: requestedBand } : undefined)}
          >
            {register.isPending ? t('tournament.register.pending') : 'Confirm Registration'}
          </Button>
          <button type="button" onClick={() => { setPickingFaction(false); setSelectedFactions([]); }} className="text-sm text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Band picker dialog for BALANCED_LIECHTENSTEIN */}
      {isBalancedLiechtenstein && userId && (
        <BandPickerDialog
          open={pickingBand}
          onOpenChange={setPickingBand}
          userId={userId}
          onConfirm={(band) => {
            // After the skill band, continue any faction step the mode needs
            // (Free Pick choice, or the SFT/2D3 faction picker) before registering;
            // plain BaLi registers straight away. Carry the band through.
            setRequestedBand(band);
            setPickingBand(false);
            if (isFreePick) {
              setChoosingFreePick(true);
            } else if (needsFactionPick) {
              setPickingFaction(true);
            } else {
              register.mutate({ requested_band: band });
            }
          }}
        />
      )}

      {/* Free Pick: choose a fixed faction or pick-per-match, in a modal like the band picker */}
      {isFreePick && (
        <Dialog open={choosingFreePick} onOpenChange={(o) => { if (!o) setChoosingFreePick(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>How do you want to play?</DialogTitle>
              <DialogDescription>
                Free Pick — commit to one faction for the whole event, or decide match by match.
              </DialogDescription>
            </DialogHeader>
            {register.isError && (
              <p className="text-xs text-rizzotto-danger">{(register.error as Error).message}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { setFreePickChoice('fixed'); setChoosingFreePick(false); setPickingFaction(true); }}
                className="rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-3 text-left transition-colors hover:border-rizzotto-gold-500/60"
              >
                <p className="text-sm font-semibold text-rizzotto-stone-100">Fixed faction</p>
                <p className="mt-0.5 text-xs text-rizzotto-stone-500">Play one faction all tournament — revealed to others at start.</p>
              </button>
              <button
                type="button"
                disabled={register.isPending}
                onClick={() => { setFreePickChoice('later'); register.mutate(requestedBand != null ? { requested_band: requestedBand } : undefined); }}
                className="rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-3 text-left transition-colors hover:border-rizzotto-gold-500/60 disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-rizzotto-stone-100">Pick match by match</p>
                <p className="mt-0.5 text-xs text-rizzotto-stone-500">Choose your faction per opponent when the match starts.</p>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isReRegister && (
        <p className="mb-2 text-xs text-rizzotto-stone-400">
          You&apos;ve withdrawn — you can sign up again (e.g. to change your faction choice).
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="forge"
          size="md"
          disabled={register.isPending}
          onClick={() => {
            if (isBalancedLiechtenstein && userId) {
              setPickingBand(true);
            } else if (isFreePick) {
              setChoosingFreePick(true);
            } else if (needsFactionPick) {
              setPickingFaction(true);
            } else {
              register.mutate(undefined);
            }
          }}
        >
          {register.isPending ? t('tournament.register.pending') : lateJoinMode ? 'Request to join' : isReRegister ? 'Register again' : t('tournament.register.cta')}
        </Button>
        {register.isError && (
          <span className="text-xs text-rizzotto-danger">{(register.error as Error).message}</span>
        )}
      </div>
    </>
  );
}
