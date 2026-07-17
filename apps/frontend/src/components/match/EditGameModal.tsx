import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameHistoryEntry } from '@rizzotto/types';
import { editGame, getTournamentMaps, getFactions } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Props {
  game: GameHistoryEntry;
  tournamentSlug: string;
  onClose: () => void;
}

const selectClass =
  'rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-2 py-1.5 text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none';

/**
 * Staff-only game correction (factions / map / winner). Changing the winner is
 * rejected by the API (409) when it would flip the match result — the message is
 * surfaced so the host uses the match-result editor for outcome changes.
 */
export function EditGameModal({ game, tournamentSlug, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 60 * 60_000,
  });
  const { data: mapsData } = useQuery({
    queryKey: ['tournament-maps', tournamentSlug],
    queryFn: () => getTournamentMaps(tournamentSlug),
    staleTime: 5 * 60_000,
  });
  const factions = (factionsData?.data ?? []).map((e) => e.faction);
  const maps = mapsData?.data ?? [];

  const [p1Faction, setP1Faction] = useState<string>(game.player1FactionId ?? '');
  const [p2Faction, setP2Faction] = useState<string>(game.player2FactionId ?? '');
  const [pickedMap, setPickedMap] = useState<string>(''); // '' = keep current
  const [winner, setWinner] = useState<string>(game.winnerId ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      editGame(game.matchId, game.gameNumber, {
        player1FactionId: p1Faction || null,
        player2FactionId: p2Faction || null,
        winnerId: winner || null,
        ...(pickedMap ? { pickedMapId: pickedMap } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament-games', tournamentSlug] });
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-rizzotto-iron-700 bg-rizzotto-iron-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">
          Edit Game — R{game.round}·G{game.gameNumber}
        </h3>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-stone-400">{game.player1?.username ?? 'Player 1'} — faction</span>
            <select className={selectClass} value={p1Faction} onChange={(e) => setP1Faction(e.target.value)}>
              <option value="">— none —</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-stone-400">{game.player2?.username ?? 'Player 2'} — faction</span>
            <select className={selectClass} value={p2Faction} onChange={(e) => setP2Faction(e.target.value)}>
              <option value="">— none —</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-stone-400">Map (current: {game.mapName ?? '—'})</span>
            <select className={selectClass} value={pickedMap} onChange={(e) => setPickedMap(e.target.value)}>
              <option value="">— keep current —</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-stone-400">Winner</span>
            <select className={selectClass} value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">— none / draw —</option>
              {game.player1 && <option value={game.player1.id}>{game.player1.username}</option>}
              {game.player2 && <option value={game.player2.id}>{game.player2.username}</option>}
            </select>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
