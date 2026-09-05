import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { reportMatchResult, overrideMatchResult, getTournamentMaps, getMaps, getFactions, getMatchGames, restoreMatch, cancelMatch, fullResetMatch, backfillNextSeed, swapPlayer, deleteMatch, getParticipants, forfeitMatch, setMatchNoContest } from '@/lib/api';
import type { OverrideGameInput } from '@/lib/api';
import { useEffect, useState } from 'react';

const DRAW = '__draw__';

function maxGamesForFormat(format?: string | null): number {
  switch (format) {
    case 'BO5': return 5;
    case 'BO3': return 3;
    case 'BO2': return 2;
    default: return 3;
  }
}

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
  canManage?: boolean;
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
  canManage = false,
  onClose,
}: MatchScoreModalProps) {
  const queryClient = useQueryClient();
  const isCompleted = matchStatus === 'COMPLETED';
  const isDisputed = matchStatus === 'DISPUTED';
  // Both go through the host/admin override endpoint (result + factions + map),
  // which bypasses the dual-submit flow.
  const isOverride = isCompleted || isDisputed;
  const isPending = matchStatus === 'PENDING';
  const isBo1 = matchFormat === 'BO1';

  const [dropError, setDropError] = useState<string | null>(null);
  const dropMutation = useMutation({
    mutationFn: (userId: string) => forfeitMatch(matchId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
    onError: (err: Error) => {
      setDropError(err.message);
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

  // Full reset — wipe the node clean (games + draft + factions + advancement) so it can be
  // re-seeded from scratch. Also invalidate participants (stats/standings shift on wipe).
  const fullResetMutation = useMutation({
    mutationFn: () => fullResetMatch(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
      onClose();
    },
  });

  // Backfill the next non-qualified seed into a playoff node's open slot (semis-drop → re-seed
  // instead of walkover). The backend enforces all guards; surface its message on failure.
  const backfillMutation = useMutation({
    mutationFn: () => backfillNextSeed(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
    onError: (err: Error) => alert(`Backfill failed: ${err.message}`),
  });

  // B10: technical-abort double-bye (both players get a bye point, no winner).
  const noContestMutation = useMutation({
    mutationFn: () => setMatchNoContest(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
      onClose();
    },
  });

  // Swap Player
  const [swapOldId, setSwapOldId] = useState('');
  const [swapNewId, setSwapNewId] = useState('');
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapNeedsOverride, setSwapNeedsOverride] = useState(false);
  const { data: participantsData } = useQuery({
    queryKey: ['tournament-participants', tournamentSlug],
    queryFn: () => getParticipants(tournamentSlug!),
    enabled: !!tournamentSlug && canManage && isPending,
    staleTime: 60_000,
  });
  const participants = participantsData?.data ?? [];
  const swapMutation = useMutation({
    mutationFn: (confirm: boolean) => swapPlayer(matchId, swapOldId, swapNewId, confirm),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      onClose();
    },
    onError: (err: Error) => {
      // Balanced Liechtenstein group-phase safety: hosts are blocked, an admin can override with a
      // second confirm. (Playoff swaps are exempt from this guard entirely.)
      if (/confirmBalancedOverride|ConfirmationRequired/i.test(err.message)) {
        setSwapNeedsOverride(true);
        setSwapError('Balanced Liechtenstein group-phase pairing — this can desync the bracket. Override only if you know what you are doing.');
      } else {
        setSwapNeedsOverride(false);
        setSwapError(err.message);
      }
    },
  });

  // Delete Match
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteMatch(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-matches'] });
      onClose();
    },
  });

  const isForfeitOrCancelled = matchStatus === 'FORFEIT' || matchStatus === 'CANCELLED';
  const canCancel = matchStatus === 'COMPLETED' || matchStatus === 'FORFEIT' || matchStatus === 'PENDING';
  const canRestore = isForfeitOrCancelled;

  const [winnerId, setWinnerId] = useState<string>(initialWinnerId ?? '');
  const [isDraw, setIsDraw] = useState(false);
  const [p1Score, setP1Score] = useState(initialP1Score);
  const [p2Score, setP2Score] = useState(initialP2Score);
  const [reason, setReason] = useState('');
  const [mapId, setMapId] = useState(initialMapId ?? '');
  const [p1FactionId, setP1FactionId] = useState(initialP1FactionId ?? '');
  const [p2FactionId, setP2FactionId] = useState(initialP2FactionId ?? '');

  // Tournament matches use the tournament's map pool; Open Play / Ladder matches have no
  // tournament, so fall back to the global map list — otherwise the override modal shows no
  // map selector at all (the per-game rows would have factions + winner but no map).
  const { data: mapsData } = useQuery({
    queryKey: tournamentSlug ? ['tournament-maps', tournamentSlug] : ['maps'],
    queryFn: () => (tournamentSlug ? getTournamentMaps(tournamentSlug) : getMaps()),
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

  // ── Per-game (non-Bo1): edit each played game's map / factions / winner. Covers both
  // an override on a completed/disputed match AND entering the result on a PENDING one
  // (e.g. after a Cancel → Restore), so a restored multi-game match keeps its per-game rows.
  const perGame = !isBo1 && (isOverride || isPending);
  const maxGames = maxGamesForFormat(matchFormat);
  type GameRow = { gameNumber: number; mapId: string; p1FactionId: string; p2FactionId: string; winnerId: string };
  const [gameRows, setGameRows] = useState<GameRow[]>([]);
  const [gamesSeeded, setGamesSeeded] = useState(false);
  const { data: matchGamesData } = useQuery({
    queryKey: ['match-games', matchId],
    queryFn: () => getMatchGames(matchId),
    enabled: perGame,
  });
  useEffect(() => {
    if (!perGame || gamesSeeded || !matchGamesData) return;
    const rows: GameRow[] = (matchGamesData.games ?? [])
      .filter((g) => g.id !== null) // skip the virtual placeholder game
      .map((g) => ({
        gameNumber: g.gameNumber,
        mapId: g.decision?.pickedMapId ?? '',
        p1FactionId: g.player1FactionId ?? '',
        p2FactionId: g.player2FactionId ?? '',
        winnerId: g.winnerId ?? '',
      }));
    setGameRows(rows.length > 0 ? rows : [{ gameNumber: 1, mapId: '', p1FactionId: '', p2FactionId: '', winnerId: '' }]);
    setGamesSeeded(true);
  }, [perGame, gamesSeeded, matchGamesData]);

  const updateRow = (idx: number, patch: Partial<GameRow>) =>
    setGameRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () =>
    setGameRows((rows) => (rows.length >= maxGames ? rows : [...rows, { gameNumber: rows.length + 1, mapId: '', p1FactionId: '', p2FactionId: '', winnerId: '' }]));
  const removeRow = (idx: number) =>
    setGameRows((rows) => rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, gameNumber: i + 1 })));

  const perGameTally = gameRows.reduce(
    (acc, r) => {
      if (r.winnerId === player1Id) acc.p1++;
      else if (r.winnerId === player2Id) acc.p2++;
      else if (r.winnerId === DRAW) acc.draw++;
      return acc;
    },
    { p1: 0, p2: 0, draw: 0 },
  );
  const allGamesHaveResult = gameRows.length > 0 && gameRows.every((r) => r.winnerId !== '');

  const overrideGames = (): OverrideGameInput[] =>
    gameRows.map((r) => ({
      gameNumber: r.gameNumber,
      mapId: r.mapId || null,
      player1FactionId: r.p1FactionId || null,
      player2FactionId: r.p2FactionId || null,
      winnerId: r.winnerId === DRAW ? null : r.winnerId || null,
    }));

  const mutation = useMutation({
    mutationFn: () => {
      // Non-Bo1: the per-game winners are the single source of truth — the match result
      // and score are DERIVED from them (more game wins → that player; equal → a played
      // draw). No separate winner radio or manual counter. Host authority; handles PENDING
      // entry and completed/disputed override uniformly via the override endpoint.
      if (perGame) {
        const result: 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW' | 'DOUBLE_LOSS' =
          perGameTally.p1 > perGameTally.p2 ? 'PLAYER1_WIN'
          : perGameTally.p2 > perGameTally.p1 ? 'PLAYER2_WIN'
          : 'DRAW';
        return overrideMatchResult(matchId, {
          result,
          player1_score: perGameTally.p1,
          player2_score: perGameTally.p2,
          reason: reason || undefined,
          games: overrideGames(),
        });
      }
      if (isDraw) {
        return overrideMatchResult(matchId, {
          result: 'DRAW',
          player1_score: p1Score,
          player2_score: p2Score,
          reason: reason || undefined,
          map_id: mapId || undefined,
          player1FactionId: p1FactionId || undefined,
          player2FactionId: p2FactionId || undefined,
          games: perGame ? overrideGames() : undefined,
        });
      }
      if (isOverride) {
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
          games: perGame ? overrideGames() : undefined,
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

  const canSubmit = perGame
    ? allGamesHaveResult && (!isOverride || reason.trim().length > 0)
    : (!!winnerId || isDraw) && (!isOverride || isDraw || reason.trim().length > 0);

  const scoreWinnerId =
    p1Score > p2Score ? player1Id
    : p2Score > p1Score ? player2Id
    : null;
  const scoreMismatch =
    winnerId && scoreWinnerId && scoreWinnerId !== winnerId;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // #1: render via a portal to document.body so `fixed` escapes the bracket's
  // TransformWrapper (a transformed ancestor makes `position: fixed` relative to it,
  // not the viewport — which is why the modal popped up inside a huge bracket).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div className="bg-stone-900 border border-stone-700 rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-1">
          {isDisputed ? 'Resolve Dispute' : isCompleted ? 'Override Result' : 'Enter Result'}
        </h2>
        {isCompleted && (
          <p className="text-xs text-amber-400 mb-4">
            This match is already complete. Changes will overwrite the existing result.
          </p>
        )}
        {isDisputed && (
          <p className="text-xs text-amber-400 mb-4">
            This match is disputed. Setting the result here resolves it — check the factions and map.
          </p>
        )}
        {!isOverride && <div className="mb-4" />}

        {/* Match admin actions — Cancel for COMPLETED+FORFEIT, Restore for FORFEIT+CANCELLED, Full Reset for any manageable node */}
        {(canCancel || canRestore || canManage) && (
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
              {canManage && isPending && (
                <button
                  type="button"
                  disabled={noContestMutation.isPending}
                  onClick={() => {
                    if (confirm('Declare a No Contest (double bye)? Both players get a bye point (1.0, no Buchholz). Use this for a technical abort that was never really played — it does NOT withdraw either player.')) {
                      noContestMutation.mutate();
                    }
                  }}
                  className="flex-1 rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 transition-colors disabled:opacity-40"
                >
                  ⚖ No Contest
                </button>
              )}
            </div>
            {canManage && (
              <button
                type="button"
                disabled={fullResetMutation.isPending}
                onClick={() => {
                  if (confirm('Full-reset this node? This DELETES its games, draft, picked map, factions and lobby code, and pulls any winner it advanced back out of the next match (→ TBD). Use this to re-seed a node from scratch. The players stay; their tournament faction is kept.')) {
                    fullResetMutation.mutate();
                  }
                }}
                className="w-full rounded border border-red-800 px-2 py-1 text-xs text-red-300/90 hover:bg-red-950/30 transition-colors disabled:opacity-40"
              >
                ⟲ Full Reset (wipe node clean)
              </button>
            )}
            {canManage && isPending && (
              <button
                type="button"
                disabled={backfillMutation.isPending}
                onClick={() => {
                  if (confirm('Backfill the next non-qualified seed into this playoff node’s open slot (instead of a walkover)? Use this after a player dropped out of an entry-round playoff match — Full-Reset the node first if the survivor already advanced.')) {
                    backfillMutation.mutate();
                  }
                }}
                className="w-full rounded border border-sky-800 px-2 py-1 text-xs text-sky-300/90 hover:bg-sky-950/30 transition-colors disabled:opacity-40"
              >
                ↧ Backfill next seed (playoff drop)
              </button>
            )}
            <p className="text-[10px] text-stone-600">
              Restore → enter correct result · Cancel → remove from standings · No Contest → double bye · Full Reset → wipe everything &amp; re-seed · Backfill → next seed fills a playoff drop
            </p>
          </div>
        )}

        {/* Swap Player — PENDING matches only */}
        {canManage && isPending && tournamentSlug && (
          <div className="mb-4 rounded border border-stone-700 bg-stone-800/50 p-3 space-y-2">
            <p className="text-xs text-stone-400">Swap player in this match:</p>
            <div className="flex gap-2 items-center">
              <select
                value={swapOldId}
                onChange={(e) => { setSwapOldId(e.target.value); setSwapNewId(''); setSwapError(null); setSwapNeedsOverride(false); }}
                className="flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
              >
                <option value="">Replace…</option>
                {player1Id && <option value={player1Id}>{player1Name ?? player1Id}</option>}
                {player2Id && <option value={player2Id}>{player2Name ?? player2Id}</option>}
              </select>
              <span className="text-stone-600 text-xs">→</span>
              <select
                value={swapNewId}
                onChange={(e) => { setSwapNewId(e.target.value); setSwapError(null); setSwapNeedsOverride(false); }}
                disabled={!swapOldId}
                className="flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-rizzotto-gold-500 disabled:opacity-40"
              >
                <option value="">With…</option>
                {participants
                  .filter((p) => p.user.id !== (swapOldId === player1Id ? player2Id : player1Id))
                  .filter((p) => p.user.id !== player1Id && p.user.id !== player2Id)
                  .map((p) => (
                    <option key={p.user.id} value={p.user.id}>{p.user.username}</option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!swapOldId || !swapNewId || swapMutation.isPending}
                onClick={() => swapMutation.mutate(false)}
                className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-400 hover:bg-amber-900/20 transition-colors disabled:opacity-40 shrink-0"
              >
                {swapMutation.isPending ? '…' : 'Swap'}
              </button>
            </div>
            {swapError && <p className="text-xs text-red-400">{swapError}</p>}
            {swapNeedsOverride && (
              <button
                type="button"
                disabled={swapMutation.isPending}
                onClick={() => swapMutation.mutate(true)}
                className="rounded border border-red-700 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30 transition-colors disabled:opacity-40"
              >
                {swapMutation.isPending ? '…' : 'Override and swap anyway'}
              </button>
            )}
          </div>
        )}

        {/* Delete Match — B19: BYE nodes are directly deletable too */}
        {canManage && (matchStatus === 'CANCELLED' || isPending || matchStatus === 'BYE') && (
          <div className="mb-4 rounded border border-red-900/50 bg-stone-800/50 p-3 space-y-2">
            <p className="text-xs text-stone-400">Danger zone:</p>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
              >
                🗑 Delete Match
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-red-300">Permanently delete this match?</span>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30 transition-colors disabled:opacity-40"
                >
                  {deleteMutation.isPending ? '…' : 'Confirm Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-stone-500 hover:text-stone-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        <fieldset className="mb-4">
          <legend className="text-xs text-stone-400 mb-2">{perGame ? 'Players' : 'Winner'}</legend>
          <div className="space-y-2">
            {player1Id && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-stone-200 cursor-pointer">
                  {!perGame && (
                    <input
                      type="radio"
                      name="winner"
                      value={player1Id}
                      checked={winnerId === player1Id && !isDraw}
                      onChange={() => { setWinnerId(player1Id); setIsDraw(false); }}
                      className="accent-rizzotto-gold-500"
                    />
                  )}
                  {player1Name ?? player1Id}
                </label>
                {tournamentSlug && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    onClick={() => dropMutation.mutate(player1Id)}
                    className="rounded border border-red-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40 shrink-0"
                    title="Forfeit this match — opponent wins"
                  >
                    Drop
                  </button>
                )}
              </div>
            )}
            {player2Id && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-stone-200 cursor-pointer">
                  {!perGame && (
                    <input
                      type="radio"
                      name="winner"
                      value={player2Id}
                      checked={winnerId === player2Id && !isDraw}
                      onChange={() => { setWinnerId(player2Id); setIsDraw(false); }}
                      className="accent-rizzotto-gold-500"
                    />
                  )}
                  {player2Name ?? player2Id}
                </label>
                {tournamentSlug && (
                  <button
                    type="button"
                    disabled={dropMutation.isPending}
                    onClick={() => dropMutation.mutate(player2Id)}
                    className="rounded border border-red-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40 shrink-0"
                    title="Forfeit this match — opponent wins"
                  >
                    Drop
                  </button>
                )}
              </div>
            )}
            {!perGame && (
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
            )}
            {dropError && (
              <p className="mt-2 text-xs text-amber-400 rounded border border-amber-800 bg-amber-950/30 px-2 py-1.5">
                {dropError}
              </p>
            )}
          </div>
        </fieldset>

        {!isBo1 && !perGame && (
          <fieldset className="mb-4">
            <legend className="text-xs text-stone-400 mb-2">Score</legend>
            <div className="flex items-center justify-center gap-6">
              <ScoreCounter label={player1Name ?? 'Player 1'} value={p1Score} onChange={setP1Score} />
              <span className="text-stone-600 text-lg font-bold">:</span>
              <ScoreCounter label={player2Name ?? 'Player 2'} value={p2Score} onChange={setP2Score} />
            </div>
          </fieldset>
        )}

        {perGame && (
          <fieldset className="mb-4">
            <legend className="text-xs text-stone-400 mb-2">Per-game detail</legend>
            <div className="space-y-2">
              {gameRows.map((row, idx) => (
                <div key={idx} className="rounded border border-stone-700 bg-stone-800/40 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-300">Game {row.gameNumber}</span>
                    {gameRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        − remove
                      </button>
                    )}
                  </div>
                  {maps.length > 0 && (
                    <select
                      value={row.mapId}
                      onChange={(e) => updateRow(idx, { mapId: e.target.value })}
                      className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                    >
                      <option value="">— map —</option>
                      {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <select
                      value={row.p1FactionId}
                      onChange={(e) => updateRow(idx, { p1FactionId: e.target.value })}
                      className="flex-1 min-w-0 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                    >
                      <option value="">{player1Name ?? 'P1'} faction</option>
                      {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <select
                      value={row.p2FactionId}
                      onChange={(e) => updateRow(idx, { p2FactionId: e.target.value })}
                      className="flex-1 min-w-0 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-rizzotto-gold-500"
                    >
                      <option value="">{player2Name ?? 'P2'} faction</option>
                      {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                  <select
                    value={row.winnerId}
                    onChange={(e) => updateRow(idx, { winnerId: e.target.value })}
                    className={`w-full rounded border px-2 py-1 text-xs text-stone-200 bg-stone-900 focus:outline-none focus:border-rizzotto-gold-500 ${row.winnerId === '' ? 'border-amber-600' : 'border-stone-700'}`}
                  >
                    <option value="">— winner —</option>
                    {player1Id && <option value={player1Id}>{player1Name ?? 'P1'} won</option>}
                    {player2Id && <option value={player2Id}>{player2Name ?? 'P2'} won</option>}
                    <option value={DRAW}>Draw</option>
                  </select>
                </div>
              ))}
            </div>
            {gameRows.length < maxGames && (
              <button
                type="button"
                onClick={addRow}
                className="mt-2 text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
              >
                + Add game
              </button>
            )}
            <p className="mt-2 text-[10px] text-stone-500">
              Match result: {perGameTally.p1}–{perGameTally.p2}
              {perGameTally.draw > 0 ? ` (+${perGameTally.draw} drawn game)` : ''} —{' '}
              {perGameTally.p1 > perGameTally.p2
                ? `${player1Name ?? 'Player 1'} wins`
                : perGameTally.p2 > perGameTally.p1
                  ? `${player2Name ?? 'Player 2'} wins`
                  : 'draw'}
              . Derived from the per-game winners; drives the bracket.
            </p>
          </fieldset>
        )}

        {maps.length > 0 && !perGame && (
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

        {factions.length > 0 && !perGame && (
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

        {(isOverride || isDraw) && (
          <div className="mb-4">
            <label className="text-xs text-stone-400 block mb-1" htmlFor="override-reason">
              Reason {isOverride && !isDraw && <span className="text-rizzotto-danger">*</span>}
            </label>
            <input
              id="override-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isDraw && !isCompleted ? 'e.g. Technical issues, disconnect' : 'e.g. Wrong result reported, dispute resolved'}
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
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-1.5 text-sm rounded bg-rizzotto-blood-500 text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {mutation.isPending ? 'Saving…' : isDisputed ? 'Resolve' : isCompleted ? 'Override' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
