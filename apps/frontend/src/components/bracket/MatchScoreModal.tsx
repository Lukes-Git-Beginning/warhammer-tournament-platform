import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportMatchResult, overrideMatchResult, getTournamentMaps } from '@/lib/api';
import { useState } from 'react';

interface MatchScoreModalProps {
  matchId: string;
  matchStatus?: string;
  tournamentSlug?: string;
  player1Name?: string;
  player2Name?: string;
  player1Id: string | null;
  player2Id: string | null;
  initialWinnerId?: string | null;
  initialP1Score?: number;
  initialP2Score?: number;
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
  tournamentSlug,
  player1Name,
  player2Name,
  player1Id,
  player2Id,
  initialWinnerId,
  initialP1Score = 0,
  initialP2Score = 0,
  onClose,
}: MatchScoreModalProps) {
  const queryClient = useQueryClient();
  const isCompleted = matchStatus === 'COMPLETED';

  const [winnerId, setWinnerId] = useState<string>(initialWinnerId ?? '');
  const [p1Score, setP1Score] = useState(initialP1Score);
  const [p2Score, setP2Score] = useState(initialP2Score);
  const [reason, setReason] = useState('');
  const [mapId, setMapId] = useState('');

  const { data: mapsData } = useQuery({
    queryKey: ['tournament-maps', tournamentSlug],
    queryFn: () => getTournamentMaps(tournamentSlug!),
    enabled: !!tournamentSlug,
    staleTime: 5 * 60_000,
  });
  const maps = mapsData?.data ?? [];

  const mutation = useMutation({
    mutationFn: () => {
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
        });
      }
      return reportMatchResult(matchId, {
        winnerId,
        score: `${p1Score}-${p2Score}`,
        map_id: mapId || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  const canSubmit = !!winnerId && (!isCompleted || reason.trim().length > 0);

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

        <fieldset className="mb-4">
          <legend className="text-xs text-stone-400 mb-2">Gewinner</legend>
          <div className="space-y-2">
            {player1Id && (
              <label className="flex items-center gap-2 text-sm text-stone-200 cursor-pointer">
                <input
                  type="radio"
                  name="winner"
                  value={player1Id}
                  checked={winnerId === player1Id}
                  onChange={() => setWinnerId(player1Id)}
                  className="accent-rizzotto-gold-500"
                />
                {player1Name ?? player1Id}
              </label>
            )}
            {player2Id && (
              <label className="flex items-center gap-2 text-sm text-stone-200 cursor-pointer">
                <input
                  type="radio"
                  name="winner"
                  value={player2Id}
                  checked={winnerId === player2Id}
                  onChange={() => setWinnerId(player2Id)}
                  className="accent-rizzotto-gold-500"
                />
                {player2Name ?? player2Id}
              </label>
            )}
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="text-xs text-stone-400 mb-2">Score</legend>
          <div className="flex items-center justify-center gap-6">
            <ScoreCounter label={player1Name ?? 'Spieler 1'} value={p1Score} onChange={setP1Score} />
            <span className="text-stone-600 text-lg font-bold">:</span>
            <ScoreCounter label={player2Name ?? 'Spieler 2'} value={p2Score} onChange={setP2Score} />
          </div>
        </fieldset>

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
