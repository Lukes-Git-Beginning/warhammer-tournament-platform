import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportMatchResult, overrideMatchResult, getTournamentMaps, getFactions, dropParticipant, restoreMatch, cancelMatch } from '@/lib/api';
import { useState } from 'react';

interface MatchScoreModalProps {
  matchId: string;
  matchStatus?: string;
  matchFormat?: string | null;
  tournamentSlug?: string;
  player1Name?: string;
  player2Name?: string;
  player1Id: string | null;
  player2Id: string | null;
  initialWinnerId?: string | null;
  initialP1Score?: number;
  initialP2Score?: number;
  initialMapId?: string;
  initialP1FactionId?: string;
  initialP2FactionId?: string;
  onClose: () => void;
}

function ScoreCounter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-stone-400 truncate max-w-[80px] text-center">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-7 h-7 rounded bg-stone-700 text-stone-200 text-base font-bold hover:bg-stone-600 transition-colors select-none"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-semibold text-rizzotto-gold-400 tabular-nums">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-7 h-7 rounded bg-stone-700 text-stone-200 text-base font-bold hover:bg-stone-600 transition-colors select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function MatchScoreModal({
  matchId,
  matchStatus,
  matchFormat,
  tournamentSlug,
  player1Name,
  player2Name,
  player1Id,
  player2Id,
  initialWinnerId,
  initialP1Score = 0,
  initialP2Score = 0,
  initialMapId,
  initialP1FactionId,
  initialP2FactionId,
  onClose,
}: MatchScoreModalProps) {
  const queryClient = useQueryClient();
  const isCompleted = matchStatus === 'COMPLETED';
  const isBo1 = matchFormat === 'BO1';

  const [dropError, setDropError] = useState<string | null>(null);
  const dropMutation = useMutation({
    mutationFn: (userId: string) => dropParticipant(tournamentSlug!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
    onError: (err: Error) => {
      const msg = err.message.toLowerCase();
      if (msg.includes('already') || msg.includes('conflict') || msg.includes('409')) {
        setDropError('Player is already withdrawn. Use "Cancel Match" or "Restore to Pending" instead.');
      } else {
        setDropError(err.message);
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreMatch(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMatch(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  const isForfeitOrCancelled = matchStatus === 'FORFEIT' || matchStatus === 'CANCELLED';
  const canCancel = matchStatus === 'COMPLETED' || matchStatus === 'FORFEIT';
  const canRestore = isForfeitOrCancelled;

  const [winnerId, setWinnerId] = useState<string>(initialWinnerId ?? '');
  const [isDraw, setIsDraw] = useState(false);
  const [p1Score, setP1Score] = useState(initialP1Score);
  const [p2Score, setP2Score] = useState(initialP2Score);
  const [reason, setReason] = useState('');
  const [mapId, setMapId] = useState(initialMapId ?? '');
  const [p1FactionId, setP1FactionId] = useState(initialP1FactionId ?? '');
  const [p2FactionId, setP2FactionId] = useState(initialP2FactionId ?? '');

  const { data: mapsData } = useQuery({
    queryKey: ['tournament-maps', tournamentSlug],
    queryFn: () => getTournamentMaps(tournamentSlug!),
    enabled: !!tournamentSlug,
    staleTime: 5 * 60_000,
  });
  const maps = mapsData?.data ?? [];

  const { data: factionData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const factions = (factionData?.data ?? [])
    .map((e) => e.faction)
    .sort((a, b) => a.name.localeCompare(b.name));

  const p1FactionChanged = p1FactionId !== (initialP1FactionId ?? '');
  const p2FactionChanged = p2FactionId !== (initialP2FactionId ?? '');

  const mutation = useMutation({
    mutationFn: () => {
      if (isDraw) {
        return overrideMatchResult(matchId, {
          result: 'DRAW',
          player1_score: p1Score,
          player2_score: p2Score,
          reason: reason || undefined,
          map_id: mapId || undefined,
          player1FactionId: p1FactionId || undefined,
          player2FactionId: p2FactionId || undefined,
        });
      }
      if (isCompleted) {
        const result =
          winnerId === player1Id ? 'PLAYER1_WIN'
          : winnerId === player2Id ? 'PLAYER2_WIN'
          : 'DRAW';
        return overrideMatchResult(matchId, {
          result: result as 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW' | 'DOUBLE_LOSS',
          player1_score: p1Score,
          player2_score: p2Score,
          reason,
          map_id: mapId || undefined,
          player1FactionId: p1FactionId || undefined,
          player2FactionId: p2FactionId || undefined,
        });
      }
      const score = isBo1
        ? (winnerId === player1Id ? '1-0' : '0-1')
        : `${p1Score}-${p2Score}`;
      return reportMatchResult(matchId, {
        winnerId,
        score,
        map_id: mapId || undefined,
        player1FactionId: p1FactionId || undefined,
        player2FactionId: p2FactionId || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  const canSubmit = (!!winnerId || isDraw) && (!isCompleted || isDraw || reason.trim().length > 0);

  const scoreWinnerId =
    p1Score > p2Score ? player1Id
    : p2Score > p1Score ? player2Id
    : null;
  const scoreMismatch =
    winnerId && scoreWinnerId && scoreWinnerId !== winnerId;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div className="bg-stone-900 border border-stone-700 rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-1">
          {isCompleted ? 'Ergebnis korrigieren' : 'Ergebnis eintragen'}
        </h2>
        {isCompleted && (
          <p className="text-xs text-amber-400 mb-4">
            Dieses Match ist bereits abgeschlossen. Änderungen überschreiben das bestehende Ergebnis.
          </p>
        )}
        {!isCompleted && <div className="mb-4" />}

        {/* Match admin actions — Cancel available for COMPLETED+FORFEIT, Restore for FORFEIT+CANCELLED */}
        {(canCancel || canRestore) && (
          <div className="mb-4 rounded border border-stone-700 bg-stone-800/50 p-3 space-y-2">
            <p className="text-xs text-stone-400">
              {matchStatus === 'CANCELLED' ? 'This match is cancelled.'
               : matchStatus === 'FORFEIT' ? 'This match was forfeited.'
               : 'Admin actions:'}
            </p>
            <div className="flex gap-2">
              {canRestore && (
                <button
                  type="button"
                  disabled={restoreMutation.isPending || cancelMutation.isPending}
                  onClick={() => restoreMutation.mutate()}
                  className="flex-1 rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
                >
                  ↩ Restore to Pending
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  disabled={restoreMutation.isPending || cancelMutation.isPending}
                  onClick={() => {
                    if (confirm('Cancel this match? It will be removed from standings. The match data (replay, factions) is preserved and the match can be restored to Pending if needed.')) {
                      cancelMutation.mutate();
                    }
                  }}
                  className="flex-1 rounded border border-stone-600 px-2 py-1 text-xs text-stone-400 hover:bg-stone-700/30 transition-colors disabled:opacity-40"
                >
                  ✕ Cancel Match
                </button>
              )}
            </div>
            <p className="text-[10px] text-stone-600">
              Restore → enter correct result · Cancel → remove from standings
            </p>
          </div>
        )}

        <fieldset className="mb-4">
          <legend className="text-xs text-stone-400 mb-2">Gewinner</legend>
          <div className="space-y-2">
            {player1Id && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-stone-200 cursor-pointer">
                  <input
                    type="radio"
                    name="winner"
                    value={player1Id}
                    checked={winnerId === player1Id && !isDraw}
                    onChange={() => { setWinnerId(player1Id); setIsDraw(false); }}
                    className="accent-rizzotto-gold-500"
                  />
                  {player1Name ?? player1Id}
                </label>
                {tournamentSlug && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    onClick={() => dropMutation.mutate(player1Id)}
                    className="rounded border border-red-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40 shrink-0"
                    title="Drop this player from the tournament"
                  >
                    Drop
                  </button>
                )}
              </div>
            )}
            {player2Id && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-stone-200 cursor-pointer">
                  <input
                    type="radio"
                    name="winner"
                    value={player2Id}
                    checked={winnerId === player2Id && !isDraw}
                    onChange={() => { setWinnerId(player2Id); setIsDraw(false); }}
                    className="accent-rizzotto-gold-500"
                  />
                  {player2Name ?? player2Id}
                </label>
                {tournamentSlug && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    onClick={() => dropMutation.mutate(player2Id)}
                    className="rounded border border-red-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40 shrink-0"
                    title="Drop this player from the tournament"
                  >
                    Drop
                  </button>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="winner"
                value="draw"
                checked={isDraw}
                onChange={() => { setIsDraw(true); setWinnerId(''); }}
                className="accent-amber-500"
              />
              <span className="text-amber-400 font-medium">Draw</span>
              <span className="text-xs text-stone-500">(0.5 pts each — couldn't play)</span>
            </label>
            {dropError && (
              <p className="mt-2 text-xs text-amber-400 rounded border border-amber-800 bg-amber-950/30 px-2 py-1.5">
                {dropError}
              </p>
            )}
          </div>
        </fieldset>

        {!isBo1 && (
          <fieldset className="mb-4">
            <legend className="text-xs text-stone-400 mb-2">Score</legend>
            <div className="flex items-center justify-center gap-6">
              <ScoreCounter label={player1Name ?? 'Player 1'} value={p1Score} onChange={setP1Score} />
              <span className="text-stone-600 text-lg font-bold">:</span>
              <ScoreCounter label={player2Name ?? 'Player 2'} value={p2Score} onChange={setP2Score} />
            </div>
          </fieldset>
        )}

        {maps.length > 0 && (
          <div className="mb-4">
            <label className="text-xs text-stone-400 block mb-1" htmlFor="map-select">
              Map <span className="text-stone-600">(optional)</span>
            </label>
            <select
              id="map-select"
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              className="w-full rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
            >
              <option value="">— select map —</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        {factions.length > 0 && (
          <fieldset className="mb-4">
            <legend className="text-xs text-stone-400 mb-2">
              Factions <span className="text-stone-600">(optional)</span>
            </legend>
            <div className="space-y-2">
              {[
                { label: player1Name ?? 'Player 1', value: p1FactionId, onChange: setP1FactionId, changed: p1FactionChanged },
                { label: player2Name ?? 'Player 2', value: p2FactionId, onChange: setP2FactionId, changed: p2FactionChanged },
              ].map(({ label, value, onChange, changed }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-24 truncate text-xs text-stone-400">{label}</span>
                  <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`flex-1 rounded border px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500 bg-stone-800 ${changed ? 'border-amber-500' : 'border-stone-700'}`}
                  >
                    <option value="">— no faction —</option>
                    {factions.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  {changed && <span className="text-amber-400 text-xs">changed</span>}
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {isCompleted && (
          <div className="mb-4">
            <label className="text-xs text-stone-400 block mb-1" htmlFor="override-reason">
              Begründung <span className="text-rizzotto-danger">*</span>
            </label>
            <input
              id="override-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z.B. Falsches Ergebnis gemeldet, Disput aufgelöst"
              className="w-full rounded border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
            />
          </div>
        )}

        {scoreMismatch && (
          <p className="text-amber-400 text-xs mb-3">
            Score suggests a different winner — double-check before saving.
          </p>
        )}

        {mutation.isError && (
          <p className="text-red-400 text-xs mb-3">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-stone-400 hover:text-stone-200 transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-1.5 text-sm rounded bg-rizzotto-blood-500 text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {mutation.isPending ? 'Wird gespeichert…' : isCompleted ? 'Überschreiben' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
