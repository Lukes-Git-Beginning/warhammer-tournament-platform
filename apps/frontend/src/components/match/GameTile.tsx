import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useNavigate } from '@tanstack/react-router';
import type { FactionDto } from '@rizzotto/types';
import { FactionBadge } from '@/components/meta/FactionBadge';

declare module '@tanstack/react-router' {
  interface HistoryState {
    freshDecision?: boolean;
  }
}
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
  player1AvatarUrl?: string | null;
  player2AvatarUrl?: string | null;
  /** Faction IDs from the BracketNode (3-level fallback incl. TournamentParticipant) */
  matchPlayer1FactionId?: string | null;
  matchPlayer2FactionId?: string | null;
  /** Whether the current user is a participant in this match */
  isParticipant: boolean;
  /** Map pool for resolving picked map name */
  maps?: MapDto[];
  /** Faction id → full DTO lookup */
  factions?: Record<string, FactionDto>;
  /** Tournament mode — used to require blind pick for BPT */
  tournamentMode?: string;
}

export function GameTile({
  matchId,
  game,
  currentUserId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  player1AvatarUrl,
  player2AvatarUrl,
  matchPlayer1FactionId,
  matchPlayer2FactionId,
  isParticipant,
  maps = [],
  factions = {},
  tournamentMode,
}: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);
  const [replayFile, setReplayFile] = useState<File | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [mapLightbox, setMapLightbox] = useState(false);

  const pickedMap = maps.find((m) => m.id === game.decision?.pickedMapId) ?? null;

  useEffect(() => {
    if (!mapLightbox) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMapLightbox(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapLightbox]);

  const startDecisionMutation = useMutation({
    mutationFn: () => startMatchDecision(matchId, game.gameNumber),
    onSuccess: () => {
      void navigate({ to: '/matches/$matchId/decision', params: { matchId }, state: { freshDecision: true } });
    },
    onError: () => {
      // Decision already started by the other player — navigate there anyway
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

  // Resolve faction IDs — prefer MatchGame fields, then BlindPick reveal (BPT),
  // then BracketNode (which has TournamentParticipant as final fallback).
  const p1FactionId =
    game.player1FactionId ?? game.blindPick?.player1FactionId ?? matchPlayer1FactionId ?? null;
  const p2FactionId =
    game.player2FactionId ?? game.blindPick?.player2FactionId ?? matchPlayer2FactionId ?? null;
  const p1Faction = p1FactionId ? (factions[p1FactionId] ?? null) : null;
  const p2Faction = p2FactionId ? (factions[p2FactionId] ?? null) : null;
  const myId = isPlayer1 ? player1Id : isPlayer2 ? player2Id : null;
  const opponentId = isPlayer1 ? player2Id : isPlayer2 ? player1Id : null;

  // Blind pick is required for BPT tournaments and for any match that has a
  // MatchBlindPick row (Open Play matches always get one on creation).
  const needsBlindPick = tournamentMode === 'BPT' || !!game.blindPick;
  const decisionComplete = Boolean(
    game.decision?.pickedMapId &&
      (!needsBlindPick || game.blindPick?.revealedAt) &&
      (tournamentMode !== 'MATRIX' || (game.player1FactionId != null && game.player2FactionId != null)),
  );

  const _isReporter = game.reportedWinnerId !== null && game.reporterId === currentUserId;
  const _isOpponentReporter =
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
        <div className="flex items-start justify-between gap-3">
          <PlayerInfo
            name={player1Name}
            avatarUrl={player1AvatarUrl}
            faction={p1Faction}
            isWinner={game.winnerId === player1Id}
          />
          <div className="flex-1 flex flex-col items-center gap-2 pt-1 min-w-0">
            <div className="h-10 w-10 rounded-full border-2 border-rizzotto-gold-400 flex items-center justify-center text-rizzotto-gold-400 text-lg">
              ⚔
            </div>
            <p className="text-xs font-semibold text-rizzotto-gold-400 text-center">
              Winner:{' '}
              <span className="text-rizzotto-stone-100">
                {game.winnerId === player1Id ? player1Name : player2Name}
              </span>
            </p>
            {pickedMap && (
              <div className="flex flex-col items-center gap-1 w-full">
                <p className="text-xs text-rizzotto-stone-500 text-center">
                  Map: <span className="text-rizzotto-stone-300">{pickedMap.name}</span>
                </p>
                {pickedMap.image_url && (
                  <button
                    type="button"
                    onClick={() => setMapLightbox(true)}
                    className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                    title="View map"
                  >
                    <img
                      src={pickedMap.image_url}
                      alt={pickedMap.name}
                      className="w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                )}
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
          <PlayerInfo
            name={player2Name}
            avatarUrl={player2AvatarUrl}
            faction={p2Faction}
            isWinner={game.winnerId === player2Id}
          />
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
                      {startDecisionMutation.isPending
                        ? 'Rolling…'
                        : needsBlindPick
                          ? 'Choose Map & Faction'
                          : 'Choose Battlefield'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-rizzotto-stone-500 text-center">
                    Waiting for players to start map selection.
                  </p>
                )
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {/* Map is already decided — show it even before faction pick */}
                  {game.decision.pickedMapId && pickedMap ? (
                    <div className="flex flex-col items-center gap-1 w-full">
                      <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Battlefield</span>
                      <p className="text-sm font-semibold text-rizzotto-stone-100 text-center leading-tight">
                        {pickedMap.name}
                      </p>
                      {pickedMap.image_url && (
                        <button
                          type="button"
                          onClick={() => setMapLightbox(true)}
                          className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                          title="View map"
                        >
                          <img
                            src={pickedMap.image_url}
                            alt={pickedMap.name}
                            className="w-full object-contain"
                            loading="lazy"
                          />
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-rizzotto-stone-400 text-center">
                      {game.decision.mode === 'RANDOM' ? 'Drawing battlefield…' : 'Picking battlefield…'}
                    </p>
                  )}
                  <Button variant="forge" size="sm" asChild>
                    <Link to="/matches/$matchId/decision" params={{ matchId }}>
                      {game.decision?.pickedMapId && tournamentMode === 'MATRIX'
                        ? 'Continue Faction Picking'
                        : game.decision?.pickedMapId && needsBlindPick
                          ? 'Pick Your Faction'
                          : 'Go to Map Selection'}
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Decision complete — show map + lobby code + result reporting */}
          {decisionComplete && (
            <div className="flex flex-col gap-4">
              {/* Player info + Map (3-column layout) */}
              <div className="flex items-start justify-between gap-3">
                <PlayerInfo name={player1Name} avatarUrl={player1AvatarUrl} faction={p1Faction} />
                {pickedMap ? (
                  <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Battlefield</span>
                    <p className="text-sm font-semibold text-rizzotto-stone-100 text-center leading-tight">
                      {pickedMap.name}
                    </p>
                    {pickedMap.image_url && (
                      <button
                        type="button"
                        onClick={() => setMapLightbox(true)}
                        className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                        title="View map"
                      >
                        <img
                          src={pickedMap.image_url}
                          alt={pickedMap.name}
                          className="w-full object-contain"
                          loading="lazy"
                        />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                <PlayerInfo name={player2Name} avatarUrl={player2AvatarUrl} faction={p2Faction} />
              </div>

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

      {/* Map lightbox */}
      {mapLightbox && pickedMap?.image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setMapLightbox(false)}
        >
          <div
            className="relative flex flex-col items-center gap-2 w-full h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full px-1 shrink-0">
              <span className="text-white font-semibold">{pickedMap.name}</span>
              <button
                type="button"
                onClick={() => setMapLightbox(false)}
                className="text-white/60 hover:text-white text-xl leading-none transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <img
              src={pickedMap.image_url}
              alt={pickedMap.name}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlayerInfo({
  name,
  avatarUrl,
  faction,
  isWinner,
}: {
  name: string;
  avatarUrl?: string | null;
  faction?: FactionDto | null;
  isWinner?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 w-28 shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="rounded-full object-cover border border-rizzotto-iron-600"
          style={{ width: 60, height: 60 }}
        />
      ) : (
        <span
          className="rounded-full flex items-center justify-center bg-rizzotto-iron-700 text-rizzotto-stone-300 text-xl font-semibold select-none"
          style={{ width: 60, height: 60 }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span
        className={`text-xs text-center w-full leading-tight ${
          isWinner ? 'text-rizzotto-gold-400 font-semibold' : 'text-rizzotto-stone-300'
        }`}
        style={{ overflowWrap: 'break-word' }}
      >
        {name}
      </span>
      {faction && (
        <>
          <FactionBadge
            size="lg"
            colorHex={faction.color_hex}
            initials={faction.initials}
            name={faction.name}
            iconUrl={faction.icon_url}
          />
          <span
            className={`text-xs text-center w-full leading-tight ${
              isWinner ? 'text-rizzotto-gold-400' : 'text-rizzotto-stone-300'
            }`}
            style={{ overflowWrap: 'break-word' }}
          >
            {faction.name}
          </span>
        </>
      )}
    </div>
  );
}

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
  matchId: _matchId,
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
