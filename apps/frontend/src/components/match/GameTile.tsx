import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useNavigate } from '@tanstack/react-router';
import { reportGameResult, startMatchDecision } from '@/lib/api';
import type { GameDto, MapDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { LobbyCodeField } from './LobbyCodeField';

interface Props {
  matchId: string;
  game: GameDto;
  currentUserId: string;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string;
  player2Name: string;
  /** Whether the current user is a participant in this match */
  isParticipant: boolean;
  /** Map pool for resolving picked map name */
  maps?: MapDto[];
  /** Faction id → name lookup */
  factionNames?: Record<string, string>;
}

export function GameTile({
  matchId,
  game,
  currentUserId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  isParticipant,
  maps = [],
  factionNames = {},
}: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);
  const [replayFile, setReplayFile] = useState<File | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const startDecisionMutation = useMutation({
    mutationFn: () => startMatchDecision(matchId),
    onSuccess: () => {
      void navigate({ to: '/matches/$matchId/decision', params: { matchId } });
    },
  });

  const reportMutation = useMutation({
    mutationFn: ({ winnerId, file }: { winnerId: string; file: File | null }) =>
      reportGameResult(matchId, game.gameNumber, winnerId, file ?? undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      setSelectedWinnerId(null);
      setReplayFile(null);
      setReplayError(null);
    },
    onError: (err: Error) => {
      setReplayError(err.message);
    },
  });

  const isPlayer1 = currentUserId === player1Id;
  const isPlayer2 = currentUserId === player2Id;

  // Resolve faction IDs — prefer MatchGame fields (set after finalization),
  // fall back to BlindPick reveal (BPT, pre-finalization).
  const p1FactionId =
    game.player1FactionId ?? game.blindPick?.player1FactionId ?? null;
  const p2FactionId =
    game.player2FactionId ?? game.blindPick?.player2FactionId ?? null;
  const p1FactionName = p1FactionId ? (factionNames[p1FactionId] ?? null) : null;
  const p2FactionName = p2FactionId ? (factionNames[p2FactionId] ?? null) : null;
  const myId = isPlayer1 ? player1Id : isPlayer2 ? player2Id : null;
  const opponentId = isPlayer1 ? player2Id : isPlayer2 ? player1Id : null;

  const decisionComplete = Boolean(
    game.decision?.pickedMapId &&
      (game.decision.blindPick == null || game.decision.blindPick.revealedAt),
  );

  const isReporter = game.reportedWinnerId !== null && game.reporterId === currentUserId;
  const isOpponentReporter =
    game.reportedWinnerId !== null && game.reporterId !== null && game.reporterId !== currentUserId;

  function handleWinnerSelect(winnerId: string) {
    setSelectedWinnerId(winnerId);
    setReplayError(null);
  }

  function handleSubmit() {
    if (!selectedWinnerId) return;
    if (!game.reportedWinnerId && !replayFile) {
      setReplayError('Please attach the game replay file.');
      return;
    }
    reportMutation.mutate({ winnerId: selectedWinnerId, file: replayFile });
  }

  return (
    <div className="rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider font-semibold">
          Game {game.gameNumber}
        </span>
        <StatusBadge status={game.status} />
      </div>

      {/* COMPLETED */}
      {game.status === 'COMPLETED' && (
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full border-2 border-rizzotto-gold-400 flex items-center justify-center text-rizzotto-gold-400 text-xl">
            ⚔
          </div>
          <p className="text-sm font-semibold text-rizzotto-gold-400">
            Winner:{' '}
            <span className="text-rizzotto-stone-100">
              {game.winnerId === player1Id ? player1Name : player2Name}
            </span>
          </p>
          {game.decision?.pickedMapId && (
            <p className="text-xs text-rizzotto-stone-500">
              Map:{' '}
              <span className="text-rizzotto-stone-300">
                {maps.find((m) => m.id === game.decision!.pickedMapId)?.name
                  ?? game.decision.pickedMapId}
              </span>
            </p>
          )}
          {(p1FactionName || p2FactionName) && (
            <div className="flex items-center gap-3 text-xs text-rizzotto-stone-500">
              <span>{player1Name}: <span className="text-rizzotto-stone-300">{p1FactionName ?? '—'}</span></span>
              <span>·</span>
              <span>{player2Name}: <span className="text-rizzotto-stone-300">{p2FactionName ?? '—'}</span></span>
            </div>
          )}
          {game.replayUrl && (
            <a
              href={game.replayUrl}
              className="text-xs text-rizzotto-gold-400 hover:underline"
              download
            >
              Download Replay
            </a>
          )}
        </div>
      )}

      {/* DISPUTED */}
      {game.status === 'DISPUTED' && (
        <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/20 p-3 text-sm text-yellow-300 text-center">
          Result disputed — waiting for organizer to resolve.
        </div>
      )}

      {/* PENDING / ONGOING */}
      {(game.status === 'PENDING' || game.status === 'ONGOING') && (
        <>
          {/* Decision phase */}
          {!decisionComplete && (
            <div className="flex flex-col gap-3">
              {!game.decision ? (
                isParticipant ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-rizzotto-stone-400 text-center">
                      Map and faction selection not started yet.
                    </p>
                    <Button
                      variant="forge"
                      size="sm"
                      onClick={() => startDecisionMutation.mutate()}
                      disabled={startDecisionMutation.isPending}
                    >
                      {startDecisionMutation.isPending ? 'Rolling…' : 'Choose Battlefield'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-rizzotto-stone-500 text-center">
                    Waiting for players to start map selection.
                  </p>
                )
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-rizzotto-stone-400 text-center">
                    {game.decision.mode === 'RANDOM'
                      ? 'Drawing battlefield…'
                      : 'Picking battlefield…'}
                  </p>
                  <Link
                    to="/matches/$matchId/decision"
                    params={{ matchId }}
                    className="text-sm text-rizzotto-gold-400 hover:underline"
                  >
                    Go to map selection →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Decision complete — show map + lobby code + result reporting */}
          {decisionComplete && (
            <div className="flex flex-col gap-4">
              {/* Map info */}
              {game.decision?.pickedMapId && (
                <div className="text-center">
                  <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Battlefield</span>
                  <p className="text-sm font-semibold text-rizzotto-stone-100 mt-0.5">
                    {maps.find((m) => m.id === game.decision!.pickedMapId)?.name
                      ?? game.decision.pickedMapId}
                  </p>
                </div>
              )}

              {/* Factions */}
              {(p1FactionName || p2FactionName) && (
                <div className="flex items-center gap-3 text-xs text-rizzotto-stone-400">
                  <span>{player1Name}: <span className="text-rizzotto-stone-200 font-medium">{p1FactionName ?? '—'}</span></span>
                  <span>·</span>
                  <span>{player2Name}: <span className="text-rizzotto-stone-200 font-medium">{p2FactionName ?? '—'}</span></span>
                </div>
              )}

              {/* Lobby code */}
              <LobbyCodeField
                matchId={matchId}
                gameNumber={game.gameNumber}
                currentCode={game.lobbyCode}
                canEdit={isParticipant}
              />

              {/* Result reporting — only for participants */}
              {isParticipant && !game.reportedWinnerId && (
                <div className="flex flex-col gap-3 pt-2 border-t border-rizzotto-iron-700">
                  <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Report Result</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleWinnerSelect(myId!)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                        selectedWinnerId === myId
                          ? 'border-rizzotto-gold-400 bg-rizzotto-gold-400/10 text-rizzotto-gold-300'
                          : 'border-rizzotto-iron-600 text-rizzotto-stone-300 hover:border-rizzotto-stone-500'
                      }`}
                    >
                      I Won
                    </button>
                    <button
                      onClick={() => handleWinnerSelect(opponentId!)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                        selectedWinnerId === opponentId
                          ? 'border-rizzotto-gold-400 bg-rizzotto-gold-400/10 text-rizzotto-gold-300'
                          : 'border-rizzotto-iron-600 text-rizzotto-stone-300 hover:border-rizzotto-stone-500'
                      }`}
                    >
                      Opponent Won
                    </button>
                  </div>

                  {selectedWinnerId && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".rec,.replay,.wrep"
                          className="hidden"
                          onChange={(e) => {
                            setReplayFile(e.target.files?.[0] ?? null);
                            setReplayError(null);
                          }}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs text-rizzotto-stone-400 hover:text-rizzotto-gold-400 transition-colors border border-rizzotto-iron-600 rounded px-2 py-1"
                        >
                          {replayFile ? `✓ ${replayFile.name}` : 'Attach Replay (required)'}
                        </button>
                      </div>
                      {replayError && (
                        <p className="text-xs text-red-400">{replayError}</p>
                      )}
                      <Button
                        variant="forge"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={reportMutation.isPending}
                      >
                        {reportMutation.isPending ? 'Submitting…' : 'Submit Result'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Provisional — reporter sees countdown */}
              {game.reportedWinnerId && !game.confirmedAt && isParticipant && (
                <ProvisionalPanel
                  matchId={matchId}
                  game={game}
                  currentUserId={currentUserId}
                  player1Id={player1Id}
                  player2Id={player2Id}
                  player1Name={player1Name}
                  player2Name={player2Name}
                  onRespond={(winnerId, file) => reportMutation.mutate({ winnerId, file })}
                  isPending={reportMutation.isPending}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'text-rizzotto-stone-500 border-rizzotto-iron-600',
    ONGOING: 'text-blue-400 border-blue-800',
    COMPLETED: 'text-rizzotto-gold-400 border-rizzotto-gold-800',
    DISPUTED: 'text-yellow-400 border-yellow-800',
  };
  return (
    <span className={`text-xs border rounded px-1.5 py-0.5 ${colors[status] ?? colors['PENDING']}`}>
      {status}
    </span>
  );
}

function ProvisionalPanel({
  matchId,
  game,
  currentUserId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  onRespond,
  isPending,
}: {
  matchId: string;
  game: GameDto;
  currentUserId: string;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string;
  player2Name: string;
  onRespond: (winnerId: string, file: File | null) => void;
  isPending: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmFile, setConfirmFile] = useState<File | null>(null);
  const autoConfirmsAt = game.reportedAt
    ? new Date(new Date(game.reportedAt).getTime() + 30 * 60 * 1000)
    : null;
  const timeLeft = useCountdown(autoConfirmsAt);

  const reportedWinnerName =
    game.reportedWinnerId === player1Id ? player1Name : player2Name;
  const isReporter = game.reporterId === currentUserId;
  const isOpponent = !isReporter;

  return (
    <div className="flex flex-col gap-3 pt-2 border-t border-rizzotto-iron-700">
      <div className="rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-800/60 p-3 text-sm">
        <p className="text-rizzotto-stone-300">
          <span className="font-semibold text-rizzotto-gold-400">{reportedWinnerName}</span> reported
          as winner.
        </p>
        {timeLeft && (
          <p className="text-xs text-rizzotto-stone-500 mt-1">
            Auto-confirms in <span className="font-mono">{timeLeft}</span>
          </p>
        )}
      </div>

      {isOpponent && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-rizzotto-stone-500">Confirm or dispute:</p>
          <div className="flex gap-2">
            <Button
              variant="forge"
              size="sm"
              onClick={() => onRespond(game.reportedWinnerId!, confirmFile)}
              disabled={isPending}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const otherId =
                  game.reportedWinnerId === player1Id ? player2Id : player1Id;
                if (otherId) onRespond(otherId, confirmFile);
              }}
              disabled={isPending}
            >
              Dispute
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".rec,.replay,.wrep"
              className="hidden"
              onChange={(e) => setConfirmFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
            >
              {confirmFile ? `✓ ${confirmFile.name}` : 'Attach replay (optional)'}
            </button>
          </div>
        </div>
      )}

      {isReporter && (
        <p className="text-xs text-rizzotto-stone-500 italic">
          Waiting for your opponent to confirm or dispute.
        </p>
      )}
    </div>
  );
}

function useCountdown(target: Date | null): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    function update() {
      const diff = target!.getTime() - Date.now();
      if (diff <= 0) { setRemaining(null); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [target]);

  return remaining;
}
