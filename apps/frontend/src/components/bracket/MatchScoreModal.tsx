import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFactions, reportMatchResult } from '@/lib/api';
import type { FactionListResponse } from '@/lib/api';
import { useState } from 'react';

interface MatchScoreModalProps {
  matchId: string;
  player1Name?: string;
  player2Name?: string;
  player1Id: string | null;
  player2Id: string | null;
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
  player1Name,
  player2Name,
  player1Id,
  player2Id,
  onClose,
}: MatchScoreModalProps) {
  const queryClient = useQueryClient();
  const [winnerId, setWinnerId] = useState<string>('');
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [p1FactionId, setP1FactionId] = useState('');
  const [p2FactionId, setP2FactionId] = useState('');

  const { data: factionData } = useQuery<FactionListResponse>({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });
  const factions = (factionData?.data ?? [])
    .map((entry) => entry.faction)
    .sort((a, b) => a.name.localeCompare(b.name));

  const mutation = useMutation({
    mutationFn: () =>
      reportMatchResult(matchId, {
        winnerId,
        score: `${p1Score}-${p2Score}`,
        player1FactionId: p1FactionId || undefined,
        player2FactionId: p2FactionId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div className="bg-stone-900 border border-stone-700 rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
          Ergebnis eintragen
        </h2>

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
            <ScoreCounter
              label={player1Name ?? 'Spieler 1'}
              value={p1Score}
              onChange={setP1Score}
            />
            <span className="text-stone-600 text-lg font-bold">:</span>
            <ScoreCounter
              label={player2Name ?? 'Spieler 2'}
              value={p2Score}
              onChange={setP2Score}
            />
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="text-xs text-stone-400 mb-2">
            Factions (optional — feeds the meta statistics)
          </legend>
          <div className="space-y-2">
            {player1Id && (
              <div className="flex items-center gap-2">
                <span className="w-28 truncate text-xs text-stone-400">
                  {player1Name ?? player1Id}
                </span>
                <select
                  value={p1FactionId}
                  onChange={(e) => setP1FactionId(e.target.value)}
                  className="flex-1 rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                >
                  <option value="">— keine Angabe —</option>
                  {factions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {player2Id && (
              <div className="flex items-center gap-2">
                <span className="w-28 truncate text-xs text-stone-400">
                  {player2Name ?? player2Id}
                </span>
                <select
                  value={p2FactionId}
                  onChange={(e) => setP2FactionId(e.target.value)}
                  className="flex-1 rounded border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                >
                  <option value="">— keine Angabe —</option>
                  {factions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </fieldset>

        {mutation.isError && (
          <p className="text-red-400 text-xs mb-3">
            Fehler beim Speichern: {(mutation.error as Error).message}
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
            disabled={!winnerId || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-1.5 text-sm rounded bg-rizzotto-blood-500 text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {mutation.isPending ? 'Wird gespeichert…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
