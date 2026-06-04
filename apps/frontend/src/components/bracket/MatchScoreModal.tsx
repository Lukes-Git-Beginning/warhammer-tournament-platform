import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFactions, reportMatchResult } from '@/lib/api';
import type { FactionListResponse } from '@/lib/api';

interface MatchScoreModalProps {
  matchId: string;
  player1Name?: string;
  player2Name?: string;
  player1Id: string | null;
  player2Id: string | null;
  onClose: () => void;
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
  const [score, setScore] = useState('');
  const [p1FactionId, setP1FactionId] = useState('');
  const [p2FactionId, setP2FactionId] = useState('');

  // Faction pre-pick feeds MatchupStats/heatmap — optional but encouraged.
  const { data: factionData } = useQuery<FactionListResponse>({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });
  const factions = (factionData?.data ?? []).map((entry) => entry.faction);

  const mutation = useMutation({
    mutationFn: () =>
      reportMatchResult(matchId, {
        winnerId,
        score: score || undefined,
        player1FactionId: p1FactionId || undefined,
        player2FactionId: p2FactionId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
  });

  // Close on backdrop click
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

        <div className="mb-6">
          <label className="text-xs text-stone-400 block mb-1" htmlFor="score-input">
            Score (optional, z.B. "2-1")
          </label>
          <input
            id="score-input"
            type="text"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="2-1"
            className="w-full rounded border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
          />
        </div>

        {mutation.isError && (
          <p className="text-red-400 text-xs mb-3">
            Fehler beim Speichern. Bitte erneut versuchen.
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
